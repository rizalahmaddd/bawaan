import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { DB } from "../db";
import { schema } from "../db";
import { conflict, notFound } from "../lib/http";
import { newId } from "../lib/ids";
import { auditInsert, eventInsert } from "./events";
import { notify } from "./notify";

const FOREVER = Date.UTC(2099, 11, 31);

/** Every store has at most one ready-stock shelf, created the first time it's needed. */
export async function ensureReadyTrip(db: DB, tenantId: string) {
  const found = await db.select().from(schema.trips).where(and(eq(schema.trips.tenantId, tenantId), eq(schema.trips.kind, "ready"))).get();
  if (found) return found;
  const row = {
    id: newId("trp"),
    tenantId,
    title: "Ready stock",
    country: "Indonesia",
    currency: "IDR",
    kursMicro: 1_000_000,
    rounding: 1,
    dpPercent: 100,
    closesAt: FOREVER,
    mode: "hand_carry" as const,
    kind: "ready" as const,
    status: "open" as const,
    note: "Barang sudah ada di Indonesia, langsung dikirim setelah lunas.",
  };
  await db.insert(schema.trips).values(row);
  return (await db.select().from(schema.trips).where(eq(schema.trips.id, row.id)).get())!;
}

/** Goods left over from a forfeited order go back on sale instead of sitting in the warehouse. */
export async function relistAsReadyStock(db: DB, tenantId: string, itemId: string, input: { price?: number }, actorId: string) {
  const item = await db.select().from(schema.orderItems).where(and(eq(schema.orderItems.id, itemId), eq(schema.orderItems.tenantId, tenantId))).get();
  if (!item) throw notFound("Barang");
  if (item.status !== "forfeited") throw conflict("Hanya barang yang hangus yang bisa dijual ulang");
  const key = `ready:${itemId}`;
  if (await db.select().from(schema.idempotency).where(eq(schema.idempotency.key, key)).get()) throw conflict("Barang ini sudah dijual ulang sebagai ready stock");
  const trip = await ensureReadyTrip(db, tenantId);
  const id = newId("prd");
  const qty = item.qtyObtained ?? item.qty;
  await db.batch([
    db.insert(schema.products).values({
      id,
      tenantId,
      tripId: trip.id,
      title: `${item.title}${item.variant ? ` · ${item.variant}` : ""}`,
      priceMinor: input.price ?? item.unitPrice ?? 0,
      fee: 0,
      quota: qty,
      photoKey: item.photoKey,
    }),
    db.insert(schema.idempotency).values({ key, response: JSON.stringify({ productId: id }) }),
    eventInsert(db, { tenantId, entityType: "item", entityId: itemId, status: "relisted", message: "Dijual ulang sebagai ready stock", visibility: "internal", actorId }),
    auditInsert(db, { tenantId, actorId, action: "item.relist", entityType: "item", entityId: itemId, data: { productId: id, qty } }),
  ]);
  return { productId: id, tripId: trip.id };
}

/** Paid ready-stock orders skip the hunt: the goods are already on the shelf. */
export async function markReadyStockObtained(db: DB, orderId: string) {
  const order = await db.select({ tripId: schema.orders.tripId, tenantId: schema.orders.tenantId }).from(schema.orders).where(eq(schema.orders.id, orderId)).get();
  if (!order) return false;
  const trip = await db.select({ kind: schema.trips.kind }).from(schema.trips).where(eq(schema.trips.id, order.tripId)).get();
  if (trip?.kind !== "ready") return false;
  const updated = await db
    .update(schema.orderItems)
    .set({ status: "obtained", qtyObtained: sql`${schema.orderItems.qty}`, decidedAt: Date.now() })
    .where(and(eq(schema.orderItems.orderId, orderId), inArray(schema.orderItems.status, ["awaiting_dp", "hunting"])))
    .returning({ id: schema.orderItems.id })
    .all();
  if (updated.length) await eventInsert(db, { tenantId: order.tenantId, entityType: "order", entityId: orderId, status: "obtained", message: "Lunas, barang ready stock disiapkan untuk dikirim" });
  return true;
}

/** A slot opened up on products people were waiting for: tell the seller once per batch of waiters. */
export async function waitlistAlert(env: Env, db: DB, tenantId: string, productIds: string[]) {
  if (!productIds.length) return;
  const rows = await db
    .select({ productId: schema.waitlist.productId, title: schema.products.title, n: sql<number>`count(*)` })
    .from(schema.waitlist)
    .innerJoin(schema.products, eq(schema.products.id, schema.waitlist.productId))
    .where(and(eq(schema.waitlist.tenantId, tenantId), inArray(schema.waitlist.productId, productIds), isNull(schema.waitlist.notifiedAt), sql`${schema.products.reserved} < coalesce(${schema.products.quota}, 0)`))
    .groupBy(schema.waitlist.productId, schema.products.title)
    .all();
  if (!rows.length) return;
  await db
    .update(schema.waitlist)
    .set({ notifiedAt: Date.now() })
    .where(and(inArray(schema.waitlist.productId, rows.map((r) => r.productId)), isNull(schema.waitlist.notifiedAt)));
  await notify(
    env,
    db,
    [{ audience: "seller", targetId: tenantId }],
    { title: "Slot PO kosong lagi", body: rows.map((r) => `${r.title}: ${r.n} orang menunggu`).join(" · "), url: "/trip" },
  );
}
