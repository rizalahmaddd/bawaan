import { DECIDED_WITH_GOODS, parsePolicy, SHIPMENT_LABEL, type ShipmentStatus } from "@bawaan/shared";
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { DB } from "../db";
import { schema } from "../db";
import { conflict, notFound } from "../lib/http";
import { newId } from "../lib/ids";
import { eventInsert } from "./events";
import { createInvoice } from "./invoices";

export async function createShipment(db: DB, tenantId: string, input: { tripId: string; name: string; forwarder?: string | null; awb?: string | null; etaAt?: number | null }) {
  const trip = await db.select({ id: schema.trips.id }).from(schema.trips).where(and(eq(schema.trips.id, input.tripId), eq(schema.trips.tenantId, tenantId))).get();
  if (!trip) throw notFound("Trip");
  const id = newId("shp");
  await db.batch([
    db.insert(schema.shipments).values({ id, tenantId, ...input }),
    eventInsert(db, { tenantId, entityType: "shipment", entityId: id, status: "preparing", message: SHIPMENT_LABEL.preparing.label }),
  ]);
  return { id };
}

export async function addToShipment(db: DB, tenantId: string, shipmentId: string, itemIds: string[]) {
  const shp = await db.select().from(schema.shipments).where(and(eq(schema.shipments.id, shipmentId), eq(schema.shipments.tenantId, tenantId))).get();
  if (!shp) throw notFound("Pengiriman");
  const updated = await db
    .update(schema.orderItems)
    .set({ shipmentId })
    .where(
      and(
        eq(schema.orderItems.tenantId, tenantId),
        inArray(schema.orderItems.id, itemIds),
        inArray(schema.orderItems.status, DECIDED_WITH_GOODS),
        isNull(schema.orderItems.deliveryId),
      ),
    )
    .returning({ id: schema.orderItems.id })
    .all();
  return { added: updated.length };
}

export async function removeFromShipment(db: DB, tenantId: string, shipmentId: string, itemId: string) {
  await db
    .update(schema.orderItems)
    .set({ shipmentId: null })
    .where(and(eq(schema.orderItems.id, itemId), eq(schema.orderItems.tenantId, tenantId), eq(schema.orderItems.shipmentId, shipmentId)));
}

/** One write for the batch; every customer's tracking page derives its cargo status from it. */
export async function setShipmentStatus(db: DB, tenantId: string, shipmentId: string, input: { status: ShipmentStatus; message?: string; etaAt?: number | null }, actorId: string) {
  const shp = await db
    .update(schema.shipments)
    .set({ status: input.status, updatedAt: Date.now(), ...(input.etaAt !== undefined ? { etaAt: input.etaAt } : {}) })
    .where(and(eq(schema.shipments.id, shipmentId), eq(schema.shipments.tenantId, tenantId)))
    .returning()
    .get();
  if (!shp) throw notFound("Pengiriman");
  await eventInsert(db, {
    tenantId,
    entityType: "shipment",
    entityId: shipmentId,
    status: input.status,
    message: input.message || SHIPMENT_LABEL[input.status].label,
    actorId,
  });
  const customers = await db
    .selectDistinct({ customerId: schema.orders.customerId, code: schema.orders.code })
    .from(schema.orderItems)
    .innerJoin(schema.orders, eq(schema.orders.id, schema.orderItems.orderId))
    .where(eq(schema.orderItems.shipmentId, shipmentId))
    .all();
  return { shipment: shp, customers };
}

export async function createDelivery(
  db: DB,
  tenantId: string,
  input: { customerId: string; itemIds: string[]; courier?: string | null; resi?: string | null; cost: number; status: "packed" | "shipped" | "picked_up" },
  actorId: string,
) {
  const items = await db
    .select({ id: schema.orderItems.id, orderId: schema.orderItems.orderId, status: schema.orderItems.status, deliveryId: schema.orderItems.deliveryId })
    .from(schema.orderItems)
    .innerJoin(schema.orders, eq(schema.orders.id, schema.orderItems.orderId))
    .where(and(eq(schema.orderItems.tenantId, tenantId), eq(schema.orders.customerId, input.customerId), inArray(schema.orderItems.id, input.itemIds)))
    .all();
  if (items.length !== input.itemIds.length) throw notFound("Barang");
  if (items.some((i) => i.deliveryId || !DECIDED_WITH_GOODS.includes(i.status))) throw conflict("Ada barang yang sudah dikirim atau belum didapat");

  const addr = await db.select().from(schema.addresses).where(and(eq(schema.addresses.customerId, input.customerId), eq(schema.addresses.isDefault, true))).get();
  const id = newId("dlv");
  const now = Date.now();
  await db.batch([
    db.insert(schema.deliveries).values({
      id,
      tenantId,
      customerId: input.customerId,
      addressSnapshot: addr ? JSON.stringify(addr) : null,
      courier: input.courier ?? null,
      resi: input.resi ?? null,
      cost: input.cost,
      status: input.status,
      shippedAt: input.status === "packed" ? null : now,
      deliveredAt: input.status === "picked_up" ? now : null,
    }),
    db.update(schema.orderItems).set({ deliveryId: id }).where(inArray(schema.orderItems.id, input.itemIds)),
    eventInsert(db, { tenantId, entityType: "delivery", entityId: id, status: input.status, message: input.resi ? `${input.courier ?? "Kurir"} · ${input.resi}` : null, actorId }),
  ]);
  if (input.cost > 0) {
    const orderId = items[0]!.orderId;
    const policy = parsePolicy((await db.select({ p: schema.tenants.policyJson }).from(schema.tenants).where(eq(schema.tenants.id, tenantId)).get())?.p);
    await createInvoice(db, {
      tenantId,
      customerId: input.customerId,
      orderId,
      type: "domestic",
      lines: [{ label: `Ongkir ${input.courier ?? "domestik"}`, amount: input.cost }],
      dueAt: now + 3 * 86_400_000,
      uniqueCode: policy.uniqueCode,
    });
  }
  await completeOrdersIfDone(db, [...new Set(items.map((i) => i.orderId))]);
  return { id };
}

export async function updateDelivery(
  db: DB,
  tenantId: string,
  deliveryId: string,
  input: { status?: "packed" | "shipped" | "delivered" | "picked_up"; courier?: string | null; resi?: string | null },
  actorId: string,
) {
  const now = Date.now();
  const dlv = await db
    .update(schema.deliveries)
    .set({
      ...input,
      ...(input.status === "shipped" ? { shippedAt: now } : {}),
      ...(input.status === "delivered" || input.status === "picked_up" ? { deliveredAt: now } : {}),
    })
    .where(and(eq(schema.deliveries.id, deliveryId), eq(schema.deliveries.tenantId, tenantId)))
    .returning()
    .get();
  if (!dlv) throw notFound("Pengiriman lokal");
  await eventInsert(db, { tenantId, entityType: "delivery", entityId: deliveryId, status: dlv.status, message: dlv.resi ? `${dlv.courier ?? "Kurir"} · ${dlv.resi}` : null, actorId });
  const orderIds = (await db.selectDistinct({ id: schema.orderItems.orderId }).from(schema.orderItems).where(eq(schema.orderItems.deliveryId, deliveryId)).all()).map((r) => r.id);
  await completeOrdersIfDone(db, orderIds);
  return dlv;
}

/** An order is done when every item with goods has reached the customer. */
async function completeOrdersIfDone(db: DB, orderIds: string[]) {
  for (const orderId of orderIds) {
    const rows = await db
      .select({ status: schema.orderItems.status, dStatus: schema.deliveries.status })
      .from(schema.orderItems)
      .leftJoin(schema.deliveries, eq(schema.deliveries.id, schema.orderItems.deliveryId))
      .where(eq(schema.orderItems.orderId, orderId))
      .all();
    const goods = rows.filter((r) => DECIDED_WITH_GOODS.includes(r.status));
    if (goods.length && goods.every((r) => r.dStatus === "delivered" || r.dStatus === "picked_up") && !rows.some((r) => ["hunting", "needs_approval", "awaiting_dp"].includes(r.status))) {
      await db
        .update(schema.orders)
        .set({ status: "completed", closedAt: Date.now() })
        .where(and(eq(schema.orders.id, orderId), eq(schema.orders.status, "active")));
    }
  }
}
