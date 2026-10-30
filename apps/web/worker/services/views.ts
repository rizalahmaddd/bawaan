import { and, desc, eq, inArray, ne } from "drizzle-orm";
import type { DB } from "../db";
import { schema } from "../db";
import { notFound } from "../lib/http";
import { remaining } from "./invoices";

/**
 * Everything one order page needs, in one shape for both the seller and the customer.
 * `audience: "customer"` strips internal notes and events.
 */
export async function orderView(db: DB, tenantId: string, orderId: string, audience: "seller" | "customer") {
  const order = await db.select().from(schema.orders).where(and(eq(schema.orders.id, orderId), eq(schema.orders.tenantId, tenantId))).get();
  if (!order) throw notFound("Pesanan");
  const [trip, customer, items, invoices, payments] = await Promise.all([
    db.select().from(schema.trips).where(eq(schema.trips.id, order.tripId)).get(),
    db.select().from(schema.customers).where(eq(schema.customers.id, order.customerId)).get(),
    db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, orderId)).all(),
    db
      .select()
      .from(schema.invoices)
      .where(and(eq(schema.invoices.orderId, orderId), audience === "customer" ? ne(schema.invoices.status, "void") : undefined))
      .orderBy(schema.invoices.createdAt)
      .all(),
    db
      .select()
      .from(schema.payments)
      .where(and(eq(schema.payments.tenantId, tenantId), eq(schema.payments.customerId, order.customerId)))
      .orderBy(desc(schema.payments.createdAt))
      .limit(20)
      .all(),
  ]);

  // A combined invoice lives on one order but pays for invoices on others; show it wherever its parts are.
  const parentIds = [...new Set(invoices.map((i) => i.combinedInto).filter((x): x is string => !!x && !invoices.some((v) => v.id === x)))];
  if (parentIds.length) invoices.push(...(await db.select().from(schema.invoices).where(and(inArray(schema.invoices.id, parentIds), ne(schema.invoices.status, "void"))).all()));

  const shipmentIds = [...new Set(items.map((i) => i.shipmentId).filter((x): x is string => !!x))];
  const deliveryIds = [...new Set(items.map((i) => i.deliveryId).filter((x): x is string => !!x))];
  const [shipments, deliveries] = await Promise.all([
    shipmentIds.length ? db.select().from(schema.shipments).where(inArray(schema.shipments.id, shipmentIds)).all() : [],
    deliveryIds.length ? db.select().from(schema.deliveries).where(inArray(schema.deliveries.id, deliveryIds)).all() : [],
  ]);

  const entityIds = [order.id, ...items.map((i) => i.id), ...shipmentIds, ...deliveryIds, ...invoices.map((i) => i.id)];
  const events = await db
    .select()
    .from(schema.statusEvents)
    .where(
      and(
        inArray(schema.statusEvents.entityId, entityIds),
        audience === "customer" ? eq(schema.statusEvents.visibility, "public") : undefined,
      ),
    )
    .orderBy(desc(schema.statusEvents.createdAt))
    .limit(100)
    .all();

  const address = order.addressId ? await db.select().from(schema.addresses).where(eq(schema.addresses.id, order.addressId)).get() : null;
  const invoiceIds = new Set(invoices.map((i) => i.id));

  return {
    order: {
      id: order.id,
      code: order.code,
      status: order.status,
      notes: audience === "seller" ? order.notes : null,
      createdAt: order.createdAt,
      confirmedAt: order.confirmedAt,
      closeReason: order.closeReason,
      holdForCombine: order.holdForCombine,
    },
    trip: trip && {
      id: trip.id,
      title: trip.title,
      country: trip.country,
      currency: trip.currency,
      kursMicro: trip.kursMicro,
      closesAt: trip.closesAt,
      etaAt: trip.etaAt,
      dpPercent: trip.dpPercent,
    },
    customer: customer && { id: customer.id, name: customer.name, phone: customer.phone, balance: customer.balance, notes: audience === "seller" ? customer.notes : null, linked: !!customer.userId },
    address,
    items: items.map((i) => ({
      id: i.id,
      title: i.title,
      variant: i.variant,
      link: i.link,
      note: i.note,
      qty: i.qty,
      qtyObtained: i.qtyObtained,
      priceMinor: i.priceMinor,
      actualPriceMinor: i.actualPriceMinor,
      maxPriceMinor: i.maxPriceMinor,
      currency: i.currency,
      unitPrice: i.unitPrice,
      fee: i.fee,
      onUnavailable: i.onUnavailable,
      status: i.status,
      approvalNote: i.approvalNote,
      approvalDeadline: i.approvalDeadline,
      photoKey: i.photoKey,
      receiptKey: i.receiptKey,
      shipmentId: i.shipmentId,
      deliveryId: i.deliveryId,
      decidedAt: i.decidedAt,
    })),
    invoices: invoices.map((i) => ({
      id: i.id,
      number: i.number,
      type: i.type,
      amount: i.amount,
      uniqueCode: i.uniqueCode,
      paid: i.paid,
      remaining: remaining(i),
      status: i.status,
      dueAt: i.dueAt,
      lines: JSON.parse(i.lines) as Array<{ label: string; qty?: number; unit?: number; amount: number }>,
      note: i.note,
      combinedInto: i.combinedInto,
      createdAt: i.createdAt,
    })),
    payments: payments
      .filter((p) => audience === "seller" || (p.invoiceId && invoiceIds.has(p.invoiceId)))
      .map((p) => ({
        id: p.id,
        invoiceId: p.invoiceId,
        amount: p.amount,
        method: p.method,
        status: p.status,
        rejectReason: p.rejectReason,
        proofKey: audience === "seller" ? p.proofKey : null,
        createdAt: p.createdAt,
      })),
    shipments: shipments.map((s) => ({ id: s.id, name: s.name, status: s.status, etaAt: s.etaAt, forwarder: s.forwarder, awb: audience === "seller" ? s.awb : null, updatedAt: s.updatedAt })),
    deliveries: deliveries.map((d) => ({ id: d.id, courier: d.courier, resi: d.resi, cost: d.cost, status: d.status, shippedAt: d.shippedAt, deliveredAt: d.deliveredAt })),
    events: events.map((e) => ({ id: e.id, entityType: e.entityType, entityId: e.entityId, status: e.status, message: e.message, photoKey: e.photoKey, createdAt: e.createdAt })),
  };
}

export type OrderView = Awaited<ReturnType<typeof orderView>>;

export async function findOrderByCode(db: DB, tenantId: string, code: string) {
  return db
    .select()
    .from(schema.orders)
    .where(and(eq(schema.orders.tenantId, tenantId), eq(schema.orders.code, code.toUpperCase())))
    .get();
}
