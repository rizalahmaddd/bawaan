import {
  DECIDED_WITH_GOODS,
  UNDECIDED,
  itemPriceRupiah,
  parsePolicy,
  type CheckoutInput,
  type DecideItemInput,
  type ItemStatus,
  type Rounding,
  checkoutSchema,
  formatForeign,
  formatRupiah,
} from "@bawaan/shared";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import type { z } from "zod";
import type { DB } from "../db";
import { schema } from "../db";
import { appSecret, hmac } from "../lib/crypto";
import { HttpError, conflict, notFound } from "../lib/http";
import { newId, orderCode } from "../lib/ids";
import { auditInsert, eventInsert } from "./events";
import { createInvoice, type InvoiceLine } from "./invoices";
import { ledgerChange } from "./ledger";
import { assertCanTakeItems } from "./plan";
import { markReadyStockObtained } from "./stock";

const CLOSE_GRACE = 2 * 60_000;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

type Trip = typeof schema.trips.$inferSelect;
type Item = typeof schema.orderItems.$inferSelect;
type Order = typeof schema.orders.$inferSelect;

export async function orderToken(env: Env, order: Pick<Order, "id" | "tokenVersion">) {
  return (await hmac(appSecret(env), `order:${order.id}:${order.tokenVersion}`)).slice(0, 22);
}

export function unitPrice(item: Pick<Item, "priceMinor" | "currency" | "fee">, kursMicro: number, rounding: number, actualMinor?: number | null) {
  const price = actualMinor ?? item.priceMinor;
  if (price === null || price === undefined) return null;
  return itemPriceRupiah({ priceMinor: price, currency: item.currency, kursMicro: BigInt(kursMicro), feeRupiah: item.fee, rounding: rounding as Rounding });
}

function roundUp(n: number, step: number) {
  return Math.ceil(n / step) * step;
}

async function loadOrder(db: DB, tenantId: string, orderId: string) {
  const order = await db.select().from(schema.orders).where(and(eq(schema.orders.id, orderId), eq(schema.orders.tenantId, tenantId))).get();
  if (!order) throw notFound("Pesanan");
  const trip = (await db.select().from(schema.trips).where(eq(schema.trips.id, order.tripId)).get())!;
  const items = await db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, order.id)).all();
  return { order, trip, items };
}

async function releaseQuota(db: DB, items: Item[]) {
  const stmts = items
    .filter((i) => i.productId)
    .map((i) =>
      db
        .update(schema.products)
        .set({ reserved: sql`max(0, ${schema.products.reserved} - ${i.qty})` })
        .where(eq(schema.products.id, i.productId!)),
    );
  if (stmts.length) await db.batch(stmts as [ (typeof stmts)[number], ...(typeof stmts)[number][]]);
}

export async function checkout(db: DB, env: Env, tenant: { id: string }, input: z.output<typeof checkoutSchema>) {
  const idemKey = `checkout:${tenant.id}:${input.idempotencyKey}`;
  const seen = await db.select().from(schema.idempotency).where(eq(schema.idempotency.key, idemKey)).get();
  if (seen) return JSON.parse(seen.response) as { code: string; token: string; orderId: string };

  const trip = await db.select().from(schema.trips).where(and(eq(schema.trips.id, input.tripId), eq(schema.trips.tenantId, tenant.id))).get();
  if (!trip || trip.status !== "open") throw conflict("Trip ini sedang tidak menerima pesanan");
  await assertCanTakeItems(db, tenant.id, input.items.reduce((s, i) => s + i.qty, 0) + input.requests.reduce((s, r) => s + r.qty, 0));
  if (trip.closesAt + CLOSE_GRACE < Date.now()) throw conflict("PO trip ini sudah ditutup");

  const productIds = [...new Set(input.items.map((i) => i.productId))];
  const products = productIds.length
    ? await db.select().from(schema.products).where(and(eq(schema.products.tripId, trip.id), inArray(schema.products.id, productIds))).all()
    : [];
  const byId = new Map(products.map((p) => [p.id, p]));
  for (const line of input.items) {
    const p = byId.get(line.productId);
    if (!p || p.status !== "active") throw conflict("Ada barang yang sudah tidak tersedia, muat ulang halaman ya");
    const variants: string[] = p.variants ? JSON.parse(p.variants) : [];
    if (variants.length && (!line.variant || !variants.includes(line.variant))) throw new HttpError(422, "invalid", `Pilih varian untuk ${p.title}`);
  }

  // Reserve quota one product at a time; the WHERE makes each reservation atomic, and we undo on failure.
  const reserved: Array<{ id: string; qty: number }> = [];
  const qtyByProduct = new Map<string, number>();
  for (const line of input.items) qtyByProduct.set(line.productId, (qtyByProduct.get(line.productId) ?? 0) + line.qty);
  for (const [productId, qty] of qtyByProduct) {
    const p = byId.get(productId)!;
    if (p.quota === null) continue;
    const ok = await db
      .update(schema.products)
      .set({ reserved: sql`${schema.products.reserved} + ${qty}` })
      .where(and(eq(schema.products.id, productId), sql`${schema.products.reserved} + ${qty} <= ${schema.products.quota}`))
      .returning({ id: schema.products.id })
      .get();
    if (!ok) {
      for (const r of reserved) {
        await db.update(schema.products).set({ reserved: sql`${schema.products.reserved} - ${r.qty}` }).where(eq(schema.products.id, r.id));
      }
      const fresh = await db.select({ quota: schema.products.quota, reserved: schema.products.reserved }).from(schema.products).where(eq(schema.products.id, productId)).get();
      const left = Math.max(0, (fresh?.quota ?? 0) - (fresh?.reserved ?? 0));
      throw conflict(left ? `Kuota ${p.title} tinggal ${left}` : `Kuota ${p.title} sudah habis`);
    }
    reserved.push({ id: productId, qty });
  }

  const customer = await db
    .insert(schema.customers)
    .values({ id: newId("cus"), tenantId: tenant.id, phone: input.customer.phone, name: input.customer.name, email: input.customer.email || null })
    .onConflictDoUpdate({
      target: [schema.customers.tenantId, schema.customers.phone],
      set: { name: input.customer.name, email: sql`coalesce(${input.customer.email || null}, ${schema.customers.email})` },
    })
    .returning({ id: schema.customers.id, mergedInto: schema.customers.mergedInto })
    .get()
    .then((c) => ({ id: c.mergedInto ?? c.id }));

  let addressId: string | null = null;
  if (input.address) {
    addressId = newId("adr");
    await db.insert(schema.addresses).values({ id: addressId, tenantId: tenant.id, customerId: customer.id, ...input.address, isDefault: true });
  }

  const order = { id: newId("ord"), tenantId: tenant.id, code: orderCode(trip.country), tripId: trip.id, customerId: customer.id, addressId, notes: input.notes ?? null, holdForCombine: input.holdForCombine };
  const itemRows = [
    ...input.items.map((l) => {
      const p = byId.get(l.productId)!;
      return {
        id: newId("itm"),
        tenantId: tenant.id,
        orderId: order.id,
        productId: p.id,
        title: p.title,
        variant: l.variant ?? null,
        note: l.note ?? null,
        qty: l.qty,
        priceMinor: p.priceMinor,
        currency: trip.currency,
        fee: p.fee,
        maxPriceMinor: l.maxPriceMinor ?? null,
        onUnavailable: l.onUnavailable,
        photoKey: p.photoKey,
      };
    }),
    ...input.requests.map((r) => ({
      id: newId("itm"),
      tenantId: tenant.id,
      orderId: order.id,
      productId: null,
      title: r.title,
      variant: null,
      link: r.link || null,
      note: r.note ?? null,
      qty: r.qty,
      priceMinor: null,
      currency: trip.currency,
      fee: trip.defaultFee,
      maxPriceMinor: r.maxPriceMinor ?? null,
      onUnavailable: "refund" as const,
      photoKey: null,
    })),
  ];

  await db.batch([
    db.insert(schema.orders).values(order),
    db.insert(schema.orderItems).values(itemRows),
    eventInsert(db, { tenantId: tenant.id, entityType: "order", entityId: order.id, status: "requested", message: "Pesanan dibuat" }),
  ]);

  const result = { code: order.code, token: await orderToken(env, { id: order.id, tokenVersion: 1 }), orderId: order.id };
  await db.insert(schema.idempotency).values({ key: idemKey, response: JSON.stringify(result) }).onConflictDoNothing();
  return result;
}

export async function quoteItem(db: DB, tenantId: string, itemId: string, input: { priceMinor: number; fee: number }, actorId: string) {
  const item = await db.select().from(schema.orderItems).where(and(eq(schema.orderItems.id, itemId), eq(schema.orderItems.tenantId, tenantId))).get();
  if (!item) throw notFound("Barang");
  if (item.status !== "requested") throw conflict("Harga hanya bisa diisi sebelum pesanan dikonfirmasi");
  await db.batch([
    db.update(schema.orderItems).set({ priceMinor: input.priceMinor, fee: input.fee }).where(eq(schema.orderItems.id, itemId)),
    auditInsert(db, { tenantId, actorId, action: "item.quote", entityType: "item", entityId: itemId, data: input }),
  ]);
}

export async function confirmOrder(db: DB, tenant: { id: string }, orderId: string, actorId: string) {
  const { order, trip, items } = await loadOrder(db, tenant.id, orderId);
  if (order.status !== "requested") throw conflict("Pesanan ini sudah diproses");
  const unpriced = items.filter((i) => i.priceMinor === null);
  if (unpriced.length) throw conflict(`Isi harga dulu untuk: ${unpriced.map((i) => i.title).join(", ")}`);

  const priced = items.map((i) => ({ ...i, unitPrice: unitPrice(i, trip.kursMicro, trip.rounding)! }));
  const total = priced.reduce((s, i) => s + i.unitPrice * i.qty, 0);
  const tenantRow = (await db.select({ policy: schema.tenants.policyJson }).from(schema.tenants).where(eq(schema.tenants.id, tenant.id)).get())!;
  const policy = parsePolicy(tenantRow.policy);
  const dp = trip.dpPercent;
  const itemStatus: ItemStatus = dp > 0 ? "awaiting_dp" : "hunting";

  await db.batch([
    db.update(schema.orders).set({ status: "active", confirmedAt: Date.now() }).where(eq(schema.orders.id, order.id)),
    ...priced.map((i) =>
      db.update(schema.orderItems).set({ status: itemStatus, kursMicro: trip.kursMicro, unitPrice: i.unitPrice }).where(eq(schema.orderItems.id, i.id)),
    ),
    eventInsert(db, { tenantId: tenant.id, entityType: "order", entityId: order.id, status: "confirmed", message: "Pesanan dikonfirmasi seller", actorId }),
  ]);

  let invoice = null;
  if (dp > 0) {
    const lines: InvoiceLine[] = priced.map((i) => ({
      label: `${i.title}${i.variant ? ` · ${i.variant}` : ""}`,
      qty: i.qty,
      unit: i.unitPrice,
      amount: i.unitPrice * i.qty,
    }));
    const dpAmount = dp === 100 ? total : roundUp((total * dp) / 100, Math.min(trip.rounding, 1000));
    invoice = await createInvoice(db, {
      tenantId: tenant.id,
      customerId: order.customerId,
      orderId: order.id,
      type: dp === 100 ? "full" : "dp",
      lines: dp === 100 ? lines : [...lines, { label: `Sisa ${100 - dp}% ditagih saat pelunasan`, amount: dpAmount - total }],
      dueAt: Date.now() + 2 * DAY,
      uniqueCode: policy.uniqueCode,
    });
  }
  return { total, invoice };
}

export async function rejectOrder(db: DB, tenantId: string, orderId: string, reason: string, actorId: string) {
  const { order, items } = await loadOrder(db, tenantId, orderId);
  if (order.status !== "requested") throw conflict("Hanya pesanan baru yang bisa ditolak");
  await db.batch([
    db.update(schema.orders).set({ status: "rejected", closedAt: Date.now(), closeReason: reason }).where(eq(schema.orders.id, orderId)),
    db.update(schema.orderItems).set({ status: "cancelled" }).where(eq(schema.orderItems.orderId, orderId)),
    eventInsert(db, { tenantId, entityType: "order", entityId: orderId, status: "rejected", message: reason, actorId }),
  ]);
  await releaseQuota(db, items);
}

/** Seller cancels an active order. Anything already paid goes back to the customer's saldo. */
export async function cancelOrder(db: DB, tenantId: string, orderId: string, reason: string, actorId: string) {
  const { order, items } = await loadOrder(db, tenantId, orderId);
  if (order.status !== "active") throw conflict("Pesanan ini tidak aktif");
  if (items.some((i) => i.shipmentId || i.deliveryId)) throw conflict("Ada barang yang sudah masuk pengiriman");
  const invs = await db.select().from(schema.invoices).where(and(eq(schema.invoices.orderId, orderId), ne(schema.invoices.status, "void"))).all();
  if (invs.some((i) => i.combinedInto || i.type === "combined")) throw conflict("Pesanan ini punya tagihan gabungan. Batalkan gabungannya dulu.");
  const paid = invs.reduce((s, i) => s + i.paid, 0);
  await db.batch([
    db.update(schema.orders).set({ status: "cancelled", closedAt: Date.now(), closeReason: reason }).where(eq(schema.orders.id, orderId)),
    db.update(schema.orderItems).set({ status: "cancelled" }).where(eq(schema.orderItems.orderId, orderId)),
    db.update(schema.invoices).set({ status: "void" }).where(and(eq(schema.invoices.orderId, orderId), inArray(schema.invoices.status, ["open", "partially_paid"]))),
    eventInsert(db, { tenantId, entityType: "order", entityId: orderId, status: "cancelled", message: reason, actorId }),
    ...(paid > 0
      ? ledgerChange(db, { tenantId, customerId: order.customerId, delta: paid, reason: `Pembatalan pesanan ${order.code}`, refType: "order", refId: orderId, actorId })
      : []),
  ]);
  await releaseQuota(db, items);
}

/** DP or full payment settled: start hunting. */
export async function onInvoicePaid(db: DB, invoice: { orderId: string | null; type: string; tenantId: string }) {
  if (!invoice.orderId || (invoice.type !== "dp" && invoice.type !== "full")) return;
  if (await markReadyStockObtained(db, invoice.orderId)) return;
  const updated = await db
    .update(schema.orderItems)
    .set({ status: "hunting" })
    .where(and(eq(schema.orderItems.orderId, invoice.orderId), eq(schema.orderItems.status, "awaiting_dp")))
    .returning({ id: schema.orderItems.id })
    .all();
  if (updated.length) {
    await eventInsert(db, { tenantId: invoice.tenantId, entityType: "order", entityId: invoice.orderId, status: "hunting", message: "Pembayaran diterima, barang mulai dicarikan" });
  }
}

export async function decideItem(db: DB, env: Env, tenantId: string, itemId: string, input: DecideItemInput, actorId: string) {
  const item = await db.select().from(schema.orderItems).where(and(eq(schema.orderItems.id, itemId), eq(schema.orderItems.tenantId, tenantId))).get();
  if (!item) throw notFound("Barang");
  const editable: ItemStatus[] = ["hunting", "needs_approval", "obtained", "partial", "unavailable"];
  if (!editable.includes(item.status)) throw conflict(item.status === "awaiting_dp" ? "DP pesanan ini belum lunas" : "Status barang ini tidak bisa diubah");
  const settled = await db
    .select({ id: schema.invoices.id })
    .from(schema.invoices)
    .where(and(eq(schema.invoices.orderId, item.orderId), eq(schema.invoices.type, "settlement"), ne(schema.invoices.status, "void")))
    .get();
  if (settled && item.status !== "hunting" && item.status !== "needs_approval") throw conflict("Tagihan pelunasan sudah dibuat. Batalkan tagihannya dulu untuk mengoreksi.");

  const { trip } = await loadOrder(db, tenantId, item.orderId);
  const policy = parsePolicy((await db.select({ p: schema.tenants.policyJson }).from(schema.tenants).where(eq(schema.tenants.id, tenantId)).get())?.p);
  const kurs = item.kursMicro ?? trip.kursMicro;
  const limit = item.maxPriceMinor ?? item.priceMinor ?? 0;

  let patch: Partial<Item> = { decidedAt: Date.now(), decidedBy: actorId };
  let message: string;

  const priceCheck = (actual: number | undefined) => actual !== undefined && actual > limit;

  if ((input.result === "obtained" || input.result === "partial") && priceCheck(input.actualPriceMinor)) {
    // Over the customer's ceiling: never charge silently, ask first.
    patch = {
      ...patch,
      status: "needs_approval",
      actualPriceMinor: input.actualPriceMinor!,
      qtyObtained: input.result === "partial" ? input.qtyObtained : item.qty,
      approvalNote: item.maxPriceMinor !== null ? `Lebih mahal dari batas maksimalmu ${formatForeign(item.maxPriceMinor, item.currency)}.` : "Harganya naik dari perkiraan.",
      approvalDeadline: Date.now() + policy.approvalHours * HOUR,
      photoKey: input.photoKey ?? item.photoKey,
      receiptKey: input.receiptKey ?? item.receiptKey,
    };
    message = "Harga naik, menunggu persetujuan pelanggan";
  } else if (input.result === "obtained") {
    patch = {
      ...patch,
      status: "obtained",
      qtyObtained: item.qty,
      actualPriceMinor: input.actualPriceMinor ?? null,
      unitPrice: unitPrice(item, kurs, trip.rounding, input.actualPriceMinor),
      photoKey: input.photoKey ?? item.photoKey,
      receiptKey: input.receiptKey ?? item.receiptKey,
    };
    message = "Barang didapat";
  } else if (input.result === "partial") {
    if (input.qtyObtained >= item.qty) throw new HttpError(422, "invalid", "Jumlah sebagian harus kurang dari jumlah pesanan");
    patch = {
      ...patch,
      status: "partial",
      qtyObtained: input.qtyObtained,
      actualPriceMinor: input.actualPriceMinor ?? null,
      unitPrice: unitPrice(item, kurs, trip.rounding, input.actualPriceMinor),
      photoKey: input.photoKey ?? item.photoKey,
      receiptKey: input.receiptKey ?? item.receiptKey,
    };
    message = `Didapat ${input.qtyObtained} dari ${item.qty}`;
  } else if (input.result === "unavailable") {
    patch = { ...patch, status: "unavailable", qtyObtained: 0 };
    message = input.note || "Barang tidak didapat";
  } else {
    patch = {
      ...patch,
      status: "needs_approval",
      actualPriceMinor: input.actualPriceMinor ?? item.actualPriceMinor,
      approvalNote: input.note,
      approvalDeadline: Date.now() + policy.approvalHours * HOUR,
      photoKey: input.photoKey ?? item.photoKey,
    };
    message = input.note;
  }

  await db.batch([
    db.update(schema.orderItems).set(patch).where(eq(schema.orderItems.id, itemId)),
    eventInsert(db, { tenantId, entityType: "item", entityId: itemId, status: patch.status!, message, photoKey: patch.photoKey ?? null, actorId }),
    auditInsert(db, { tenantId, actorId, action: "item.decide", entityType: "item", entityId: itemId, data: { from: item.status, ...input } }),
  ]);
  const settlement = await maybeSettle(db, env, tenantId, item.orderId);
  return { status: patch.status!, settlement };
}

export async function respondApproval(db: DB, env: Env, tenantId: string, orderId: string, itemId: string, approve: boolean) {
  const item = await db
    .select()
    .from(schema.orderItems)
    .where(and(eq(schema.orderItems.id, itemId), eq(schema.orderItems.orderId, orderId), eq(schema.orderItems.tenantId, tenantId)))
    .get();
  if (!item) throw notFound("Barang");
  if (item.status !== "needs_approval") throw conflict("Barang ini tidak sedang menunggu persetujuan");
  const { trip } = await loadOrder(db, tenantId, orderId);
  const qtyObtained = item.qtyObtained ?? item.qty;
  const status: ItemStatus = !approve ? "unavailable" : qtyObtained < item.qty ? "partial" : "obtained";
  await db.batch([
    db
      .update(schema.orderItems)
      .set(
        approve
          ? { status, qtyObtained, unitPrice: unitPrice(item, item.kursMicro ?? trip.kursMicro, trip.rounding, item.actualPriceMinor), decidedAt: Date.now() }
          : { status, qtyObtained: 0, decidedAt: Date.now() },
      )
      .where(eq(schema.orderItems.id, itemId)),
    eventInsert(db, { tenantId, entityType: "item", entityId: itemId, status, message: approve ? "Disetujui pelanggan" : "Ditolak pelanggan" }),
  ]);
  return maybeSettle(db, env, tenantId, orderId);
}

/**
 * Once every item is decided, bill what was obtained minus what's been paid,
 * or credit the difference to saldo when the DP was more than the goods.
 */
export async function maybeSettle(db: DB, _env: Env, tenantId: string, orderId: string) {
  const { order, trip, items } = await loadOrder(db, tenantId, orderId);
  if (order.status !== "active") return null;
  const live = items.filter((i) => i.status !== "cancelled" && i.status !== "forfeited");
  if (!live.length || live.some((i) => UNDECIDED.includes(i.status))) return null;

  const invs = await db.select().from(schema.invoices).where(and(eq(schema.invoices.orderId, orderId), ne(schema.invoices.status, "void"))).all();
  if (invs.some((i) => i.type === "settlement")) return null;
  // Only money that actually arrived counts; an unpaid DP must not be "credited" back.
  const upfront = invs.filter((i) => i.type === "dp" || i.type === "full");
  const paidUpfront = upfront.reduce((s, i) => s + Math.min(i.paid, i.amount), 0);
  const policy = parsePolicy((await db.select({ p: schema.tenants.policyJson }).from(schema.tenants).where(eq(schema.tenants.id, tenantId)).get())?.p);

  const goods = live.filter((i) => DECIDED_WITH_GOODS.includes(i.status));
  const settleKurs = trip.kursLock === "settle";
  const lines: InvoiceLine[] = goods.map((i) => {
    const unit = settleKurs ? unitPrice(i, trip.kursMicro, trip.rounding, i.actualPriceMinor)! : i.unitPrice!;
    const qty = i.qtyObtained ?? i.qty;
    return { label: `${i.title}${i.variant ? ` · ${i.variant}` : ""}`, qty, unit, amount: unit * qty };
  });
  const goodsTotal = lines.reduce((s, l) => s + l.amount, 0);
  const diff = goodsTotal - paidUpfront;

  if (diff > 0) {
    return createInvoice(db, {
      tenantId,
      customerId: order.customerId,
      orderId,
      type: "settlement",
      lines: paidUpfront > 0 ? [...lines, { label: "Sudah dibayar (DP)", amount: -paidUpfront }] : lines,
      dueAt: Date.now() + policy.settleDays * DAY,
      uniqueCode: policy.uniqueCode,
    });
  }

  // Nothing (more) to bill. Close the unpaid upfront invoice if goods are zero, and refund any excess.
  const stmts = [];
  if (diff < 0) {
    stmts.push(
      ...ledgerChange(db, {
        tenantId,
        customerId: order.customerId,
        delta: -diff,
        reason: `Kelebihan bayar pesanan ${order.code} (barang tidak dapat/sebagian)`,
        refType: "order",
        refId: orderId,
      }),
    );
  }
  for (const inv of upfront.filter((i) => i.status === "open" || i.status === "partially_paid")) {
    stmts.push(db.update(schema.invoices).set({ status: "void", note: "Ditutup: semua barang sudah ada hasilnya" }).where(eq(schema.invoices.id, inv.id)));
  }
  if (!goods.length) stmts.push(db.update(schema.orders).set({ status: "completed", closedAt: Date.now(), closeReason: "Semua barang tidak dapat" }).where(eq(schema.orders.id, orderId)));
  if (stmts.length) await db.batch(stmts as [ (typeof stmts)[number], ...(typeof stmts)[number][]]);
  return null;
}
