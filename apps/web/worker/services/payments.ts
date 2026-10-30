import { INVOICE_TYPE_LABEL } from "@bawaan/shared";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { DB } from "../db";
import { isUniqueViolation, schema } from "../db";
import { conflict, notFound } from "../lib/http";
import { newId } from "../lib/ids";
import { auditInsert, eventInsert } from "./events";
import { createInvoice, remaining, statusAfterPayment } from "./invoices";
import { ledgerChange } from "./ledger";
import { onInvoicePaid } from "./orders";

type Invoice = typeof schema.invoices.$inferSelect;

export async function submitPayment(
  db: DB,
  input: { tenantId: string; customerId: string; invoiceId: string; amount: number; proofKey: string; proofHash: string; method: "transfer" | "qris" },
) {
  const inv = await payable(db, input.tenantId, input.invoiceId).catch(() => null);
  if (!inv || inv.customerId !== input.customerId || !["open", "partially_paid"].includes(inv.status)) throw conflict("Tagihan ini tidak sedang menunggu pembayaran");
  input = { ...input, invoiceId: inv.id };
  const dup = await db
    .select({ id: schema.payments.id })
    .from(schema.payments)
    .where(and(eq(schema.payments.tenantId, input.tenantId), eq(schema.payments.proofHash, input.proofHash), inArray(schema.payments.status, ["pending", "verified"])))
    .get();
  if (dup) throw conflict("Bukti transfer ini sudah pernah dikirim");
  const id = newId("pay");
  await db.batch([
    db.insert(schema.payments).values({ id, ...input, paidAt: Date.now() }),
    eventInsert(db, { tenantId: input.tenantId, entityType: "invoice", entityId: inv.id, status: "payment_submitted", message: "Bukti bayar dikirim, menunggu dicek seller" }),
  ]);
  return { id };
}

/** Children of a combined invoice are paid through it, so callers always deal with the parent. */
async function payable(db: DB, tenantId: string, invoiceId: string) {
  const inv = await db.select().from(schema.invoices).where(and(eq(schema.invoices.id, invoiceId), eq(schema.invoices.tenantId, tenantId))).get();
  if (!inv) throw notFound("Tagihan");
  if (!inv.combinedInto) return inv;
  return (await db.select().from(schema.invoices).where(eq(schema.invoices.id, inv.combinedInto)).get()) ?? inv;
}

/**
 * Spreads a verified amount over the customer's open invoices: the one they paid for first, then
 * oldest due. A combined invoice passes its share on to the invoices inside it. Whatever is left
 * becomes saldo.
 */
async function allocate(db: DB, tenantId: string, customerId: string, paymentId: string, amount: number, preferInvoiceId: string | null, actorId: string | null) {
  const all = await db
    .select()
    .from(schema.invoices)
    .where(and(eq(schema.invoices.tenantId, tenantId), eq(schema.invoices.customerId, customerId), inArray(schema.invoices.status, ["open", "partially_paid"])))
    .orderBy(asc(schema.invoices.createdAt))
    .all();
  const children = new Map<string, Invoice[]>();
  for (const inv of all) if (inv.combinedInto) children.set(inv.combinedInto, [...(children.get(inv.combinedInto) ?? []), inv]);
  const open = all.filter((i) => !i.combinedInto);
  open.sort((a, b) => (a.id === preferInvoiceId ? -1 : b.id === preferInvoiceId ? 1 : 0));

  let left = amount;
  const stmts = [];
  const paidNow: Invoice[] = [];
  const apply = (inv: Invoice, take: number) => {
    const paid = inv.paid + take;
    const status = statusAfterPayment(inv, paid);
    stmts.push(
      db.insert(schema.paymentAllocations).values({ paymentId, invoiceId: inv.id, amount: take }),
      db.update(schema.invoices).set({ paid, status }).where(eq(schema.invoices.id, inv.id)),
      eventInsert(db, { tenantId, entityType: "invoice", entityId: inv.id, status, message: status === "paid" ? "Lunas" : "Dibayar sebagian", actorId }),
    );
    if (status === "paid") paidNow.push(inv);
  };
  for (const inv of open) {
    if (left <= 0) break;
    const take = Math.min(left, remaining(inv));
    if (take <= 0) continue;
    left -= take;
    if (inv.type === "combined") {
      let share = take;
      for (const child of children.get(inv.id) ?? []) {
        const part = Math.min(share, remaining(child));
        if (part <= 0) continue;
        share -= part;
        apply(child, part);
      }
      // What's left of `share` is the combined invoice's own unique code; the seller keeps it like any other.
    }
    apply(inv, take);
  }
  if (left > 0) {
    stmts.push(...ledgerChange(db, { tenantId, customerId, delta: left, reason: "Kelebihan bayar", refType: "payment", refId: paymentId, actorId }));
  }
  if (stmts.length) await db.batch(stmts as [(typeof stmts)[number], ...(typeof stmts)[number][]]);
  for (const inv of paidNow) await onInvoicePaid(db, inv);
  return { credited: left, paidInvoices: paidNow.map((i) => i.id) };
}

/** Merges a customer's open invoices into one payable with a single unique code. */
export async function combineInvoices(db: DB, tenantId: string, invoiceIds: string[], actorId: string, unique: boolean) {
  const invs = await db.select().from(schema.invoices).where(and(eq(schema.invoices.tenantId, tenantId), inArray(schema.invoices.id, invoiceIds))).all();
  if (invs.length !== invoiceIds.length || invs.length < 2) throw conflict("Pilih minimal dua tagihan");
  const customerId = invs[0]!.customerId;
  if (invs.some((i) => i.customerId !== customerId)) throw conflict("Tagihan gabungan harus untuk satu pelanggan");
  if (invs.some((i) => i.combinedInto || i.type === "combined" || !["open", "partially_paid"].includes(i.status))) throw conflict("Ada tagihan yang sudah lunas, batal, atau sudah digabung");

  // The inner invoices lose their own unique codes; the combined one gets a fresh code for matching.
  const parts = invs
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((i) => ({ inv: i, code: i.paid <= i.amount ? 0 : i.uniqueCode }))
    .map(({ inv, code }) => ({ inv, code, left: Math.max(0, inv.amount + code - inv.paid) }));
  const lines = parts.map((p) => ({ label: `${p.inv.number} · ${INVOICE_TYPE_LABEL[p.inv.type]}`, amount: p.left }));
  const dueAt = Math.min(...invs.map((i) => i.dueAt ?? Number.MAX_SAFE_INTEGER));
  const combined = await createInvoice(db, {
    tenantId,
    customerId,
    orderId: parts[0]!.inv.orderId,
    type: "combined",
    lines,
    dueAt: dueAt === Number.MAX_SAFE_INTEGER ? null : dueAt,
    uniqueCode: unique,
  });
  await db.batch([
    eventInsert(db, { tenantId, entityType: "invoice", entityId: combined.id, status: "open", message: `Gabungan ${parts.length} tagihan`, actorId }),
    ...parts.map((p) => db.update(schema.invoices).set({ combinedInto: combined.id, uniqueCode: p.code }).where(eq(schema.invoices.id, p.inv.id))),
    auditInsert(db, { tenantId, actorId, action: "invoice.combine", entityType: "invoice", entityId: combined.id, data: { invoiceIds } }),
  ]);
  return combined;
}

export async function verifyPayment(db: DB, tenantId: string, paymentId: string, actorId: string, amount?: number) {
  const pay = await db.select().from(schema.payments).where(and(eq(schema.payments.id, paymentId), eq(schema.payments.tenantId, tenantId))).get();
  if (!pay) throw notFound("Pembayaran");
  // Conditional update so two admins tapping "Terima" at once can't allocate the money twice.
  const claimed = await db
    .update(schema.payments)
    .set({ status: "verified", verifiedBy: actorId, verifiedAt: Date.now(), amount: amount ?? pay.amount })
    .where(and(eq(schema.payments.id, paymentId), eq(schema.payments.status, "pending")))
    .returning({ id: schema.payments.id })
    .get();
  if (!claimed) throw conflict("Pembayaran ini sudah diproses");
  await auditInsert(db, { tenantId, actorId, action: "payment.verify", entityType: "payment", entityId: paymentId, data: { amount: amount ?? pay.amount } });
  return allocate(db, tenantId, pay.customerId, paymentId, amount ?? pay.amount, pay.invoiceId, actorId);
}

export async function rejectPayment(db: DB, tenantId: string, paymentId: string, reason: string, actorId: string) {
  const done = await db
    .update(schema.payments)
    .set({ status: "rejected", rejectReason: reason, verifiedBy: actorId, verifiedAt: Date.now() })
    .where(and(eq(schema.payments.id, paymentId), eq(schema.payments.tenantId, tenantId), eq(schema.payments.status, "pending")))
    .returning()
    .get();
  if (!done) throw conflict("Pembayaran ini sudah diproses");
  if (done.invoiceId) {
    await eventInsert(db, { tenantId, entityType: "invoice", entityId: done.invoiceId, status: "payment_rejected", message: `Bukti bayar ditolak: ${reason}` });
  }
}

export async function recordPayment(
  db: DB,
  input: { tenantId: string; invoiceId: string; amount: number; method: "transfer" | "qris" | "cash"; actorId: string },
) {
  const inv = await payable(db, input.tenantId, input.invoiceId);
  const id = newId("pay");
  await db.insert(schema.payments).values({
    id,
    tenantId: input.tenantId,
    customerId: inv.customerId,
    invoiceId: inv.id,
    amount: input.amount,
    method: input.method,
    status: "verified",
    paidAt: Date.now(),
    verifiedBy: input.actorId,
    verifiedAt: Date.now(),
  });
  return allocate(db, input.tenantId, inv.customerId, id, input.amount, inv.id, input.actorId);
}

export async function payWithSaldo(db: DB, tenantId: string, requestedId: string, actorId: string) {
  const inv = await payable(db, tenantId, requestedId);
  const invoiceId = inv.id;
  const cust = (await db.select({ balance: schema.customers.balance }).from(schema.customers).where(eq(schema.customers.id, inv.customerId)).get())!;
  const amount = Math.min(cust.balance, remaining(inv));
  if (amount <= 0) throw conflict("Saldo pelanggan kosong");
  const id = newId("pay");
  await db.batch([
    db.insert(schema.payments).values({
      id,
      tenantId,
      customerId: inv.customerId,
      invoiceId,
      amount,
      method: "saldo",
      status: "verified",
      paidAt: Date.now(),
      verifiedBy: actorId,
      verifiedAt: Date.now(),
    }),
    ...ledgerChange(db, { tenantId, customerId: inv.customerId, delta: -amount, reason: `Dipakai untuk ${inv.number}`, refType: "invoice", refId: invoiceId, actorId }),
  ]);
  return allocate(db, tenantId, inv.customerId, id, amount, invoiceId, actorId);
}

/** Seller accepts a short payment (usually the missing unique code) as full. */
export async function markInvoicePaid(db: DB, tenantId: string, requestedId: string, actorId: string) {
  const invoiceId = (await payable(db, tenantId, requestedId)).id;
  const inv = await db
    .update(schema.invoices)
    .set({ status: "paid" })
    .where(and(eq(schema.invoices.id, invoiceId), eq(schema.invoices.tenantId, tenantId), inArray(schema.invoices.status, ["open", "partially_paid"])))
    .returning()
    .get();
  if (!inv) throw conflict("Tagihan ini tidak sedang terbuka");
  await db.batch([
    eventInsert(db, { tenantId, entityType: "invoice", entityId: invoiceId, status: "paid", message: "Ditandai lunas oleh seller", actorId }),
    auditInsert(db, { tenantId, actorId, action: "invoice.mark_paid", entityType: "invoice", entityId: invoiceId, data: { paid: inv.paid, due: inv.amount + inv.uniqueCode } }),
  ]);
  await onInvoicePaid(db, inv);
  if (inv.type === "combined") {
    const kids = await db
      .update(schema.invoices)
      .set({ status: "paid" })
      .where(and(eq(schema.invoices.combinedInto, inv.id), inArray(schema.invoices.status, ["open", "partially_paid"])))
      .returning()
      .all();
    for (const k of kids) await onInvoicePaid(db, k);
  }
}

export async function voidInvoice(db: DB, tenantId: string, invoiceId: string, reason: string, actorId: string) {
  const inv = await db.select().from(schema.invoices).where(and(eq(schema.invoices.id, invoiceId), eq(schema.invoices.tenantId, tenantId))).get();
  if (!inv) throw notFound("Tagihan");
  if (inv.status === "void") throw conflict("Tagihan ini sudah dibatalkan");
  if (inv.combinedInto) throw conflict("Tagihan ini bagian dari tagihan gabungan. Batalkan gabungannya dulu.");
  // Money paid on a combined invoice already sits on the invoices inside it, so un-combining refunds nothing.
  const combined = inv.type === "combined";
  await db.batch([
    db.update(schema.invoices).set({ status: "void", note: reason }).where(eq(schema.invoices.id, invoiceId)),
    ...(combined ? [db.update(schema.invoices).set({ combinedInto: null }).where(eq(schema.invoices.combinedInto, invoiceId))] : []),
    ...(inv.paid > 0 && !combined
      ? ledgerChange(db, { tenantId, customerId: inv.customerId, delta: inv.paid, reason: `Pembatalan ${inv.number}`, refType: "invoice", refId: invoiceId, actorId })
      : []),
    eventInsert(db, { tenantId, entityType: "invoice", entityId: invoiceId, status: "void", message: reason, actorId }),
    auditInsert(db, { tenantId, actorId, action: "invoice.void", entityType: "invoice", entityId: invoiceId, data: { reason } }),
  ]);
}

/** Money confirmed by the payment gateway: no human check needed. Safe to call twice for one gateway event. */
export async function recordGatewayPayment(db: DB, input: { tenantId: string; invoiceId: string; amount: number; method: "qris" | "transfer"; gatewayRef: string }) {
  const inv = await payable(db, input.tenantId, input.invoiceId);
  const id = newId("pay");
  try {
    await db.insert(schema.payments).values({
      id,
      tenantId: input.tenantId,
      customerId: inv.customerId,
      invoiceId: inv.id,
      amount: input.amount,
      method: input.method,
      status: "verified",
      paidAt: Date.now(),
      verifiedAt: Date.now(),
      gatewayRef: input.gatewayRef,
    });
  } catch (e) {
    if (isUniqueViolation(e)) return null;
    throw e;
  }
  return { invoice: inv, ...(await allocate(db, input.tenantId, inv.customerId, id, input.amount, inv.id, null)) };
}

export { payable };
