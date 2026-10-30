import { DECIDED_WITH_GOODS, toRupiah } from "@bawaan/shared";
import { and, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import type { createRouter } from "../app";
import { requirePerm } from "../auth/session";
import { schema, type DB } from "../db";
import { notFound } from "../lib/http";
import { remaining } from "../services/invoices";
import { csvCell } from "../lib/csv";

const GOODS_TYPES = ["dp", "full", "settlement"] as const;

/**
 * Money for one trip. Billed and collected come from invoices; cost of goods from what was really
 * paid at the shop, converted at the kurs the seller actually got (falling back to the trip kurs).
 */
export async function tripReport(db: DB, tenantId: string, tripId: string) {
  const trip = await db.select().from(schema.trips).where(and(eq(schema.trips.id, tripId), eq(schema.trips.tenantId, tenantId))).get();
  if (!trip) throw notFound("Trip");
  const orders = await db
    .select({ id: schema.orders.id, code: schema.orders.code, status: schema.orders.status, closeReason: schema.orders.closeReason, customer: schema.customers.name, phone: schema.customers.phone })
    .from(schema.orders)
    .innerJoin(schema.customers, eq(schema.customers.id, schema.orders.customerId))
    .where(and(eq(schema.orders.tripId, tripId), eq(schema.orders.tenantId, tenantId)))
    .all();
  const orderIds = orders.map((o) => o.id);
  const [items, invoices, shipments, refunds] = orderIds.length
    ? await Promise.all([
        db.select().from(schema.orderItems).where(inArray(schema.orderItems.orderId, orderIds)).all(),
        db.select().from(schema.invoices).where(and(inArray(schema.invoices.orderId, orderIds), ne(schema.invoices.status, "void"), ne(schema.invoices.type, "combined"))).all(),
        db.select().from(schema.shipments).where(eq(schema.shipments.tripId, tripId)).all(),
        db
          .select({ total: sql<number>`coalesce(sum(${schema.ledgerEntries.delta}), 0)` })
          .from(schema.ledgerEntries)
          .where(and(eq(schema.ledgerEntries.refType, "order"), inArray(schema.ledgerEntries.refId, orderIds), sql`${schema.ledgerEntries.delta} > 0`))
          .get(),
      ])
    : [[], [], await db.select().from(schema.shipments).where(eq(schema.shipments.tripId, tripId)).all(), { total: 0 }];

  const goods = items.filter((i) => DECIDED_WITH_GOODS.includes(i.status));
  const actualKurs = BigInt(trip.actualKursMicro ?? trip.kursMicro);
  let cogs = 0;
  let foreignSpent = 0;
  let kursDiff = 0;
  let fees = 0;
  for (const i of goods) {
    const qty = i.qtyObtained ?? i.qty;
    const unitForeign = i.actualPriceMinor ?? i.priceMinor ?? 0;
    foreignSpent += unitForeign * qty;
    const cost = trip.currency === "IDR" ? unitForeign * qty : toRupiah(unitForeign * qty, trip.currency, actualKurs);
    cogs += cost;
    fees += i.fee * qty;
    if (trip.actualKursMicro && trip.currency !== "IDR") {
      const billedAt = toRupiah(unitForeign * qty, trip.currency, BigInt(i.kursMicro ?? trip.kursMicro));
      kursDiff += billedAt - cost;
    }
  }

  const sum = (types: readonly string[], f: (i: (typeof invoices)[number]) => number) => invoices.filter((i) => types.includes(i.type)).reduce((s, i) => s + f(i), 0);
  // Forfeited orders keep only what was actually paid, so bill = paid for expired invoices.
  const billedOf = (i: (typeof invoices)[number]) => (i.status === "expired" ? i.paid : i.amount + i.uniqueCode);
  // Revenue is what the obtained goods are worth to customers, plus DP kept on forfeited orders. Open DP
  // invoices for goods not bought yet aren't revenue, and refunds are already outside this number.
  const goodsRevenue = goods.reduce((s, i) => s + (i.unitPrice ?? 0) * (i.qtyObtained ?? i.qty), 0);
  const forfeitKept = invoices.filter((i) => GOODS_TYPES.includes(i.type as (typeof GOODS_TYPES)[number]) && i.status === "expired").reduce((s, i) => s + i.paid, 0);
  const cargoBilled = sum(["cargo"], billedOf);
  const dutyBilled = invoices.filter((i) => i.type === "adjustment" && i.shipmentId).reduce((s, i) => s + billedOf(i), 0);
  const domesticBilled = sum(["domestic"], billedOf);
  const collected = invoices.reduce((s, i) => s + i.paid, 0);
  const unpaid = invoices.filter((i) => i.status === "open" || i.status === "partially_paid").reduce((s, i) => s + remaining(i), 0);
  const cargoCost = shipments.reduce((s, x) => s + x.costIdr, 0);
  const dutyCost = shipments.reduce((s, x) => s + x.dutyIdr, 0);
  const refunded = refunds?.total ?? 0;
  const grossProfit = goodsRevenue + forfeitKept - cogs + (cargoBilled - cargoCost) + (dutyBilled - dutyCost);

  const perOrder = orders.map((o) => {
    const inv = invoices.filter((i) => i.orderId === o.id);
    const its = items.filter((i) => i.orderId === o.id);
    return {
      code: o.code,
      customer: o.customer,
      status: o.status,
      items: its.filter((i) => i.status !== "cancelled").length,
      obtained: its.filter((i) => DECIDED_WITH_GOODS.includes(i.status)).length,
      billed: inv.reduce((s, i) => s + billedOf(i), 0),
      paid: inv.reduce((s, i) => s + i.paid, 0),
      unpaid: inv.filter((i) => i.status === "open" || i.status === "partially_paid").reduce((s, i) => s + remaining(i), 0),
    };
  });

  return {
    trip: { id: trip.id, title: trip.title, currency: trip.currency, kursMicro: trip.kursMicro, actualKursMicro: trip.actualKursMicro, status: trip.status },
    counts: {
      orders: orders.filter((o) => o.status !== "rejected").length,
      items: items.filter((i) => i.status !== "cancelled").length,
      obtained: goods.length,
      unavailable: items.filter((i) => i.status === "unavailable").length,
      forfeited: items.filter((i) => i.status === "forfeited").length,
    },
    money: { goodsRevenue, forfeitKept, fees, cogs, foreignSpent, kursDiff: trip.actualKursMicro ? kursDiff : null, cargoBilled, cargoCost, dutyBilled, dutyCost, domesticBilled, collected, unpaid, refunded, grossProfit },
    orders: perOrder,
  };
}

export function registerReportRoutes(r: ReturnType<typeof createRouter>) {
  r.get("/:tenantId/reports", requirePerm("reports"), async (c) => {
    const db = c.var.db;
    const t = c.var.tenant.id;
    const [trips, liability] = await Promise.all([
      db.select({ id: schema.trips.id, title: schema.trips.title, status: schema.trips.status, closesAt: schema.trips.closesAt }).from(schema.trips).where(eq(schema.trips.tenantId, t)).orderBy(desc(schema.trips.createdAt)).all(),
      db
        .select({ total: sql<number>`coalesce(sum(${schema.customers.balance}), 0)`, customers: sql<number>`count(*)` })
        .from(schema.customers)
        .where(and(eq(schema.customers.tenantId, t), isNull(schema.customers.mergedInto), sql`${schema.customers.balance} > 0`))
        .get(),
    ]);
    return c.json({ trips, saldoLiability: liability?.total ?? 0, saldoCustomers: liability?.customers ?? 0 });
  });

  r.get("/:tenantId/reports/trips/:id", requirePerm("reports"), async (c) => c.json(await tripReport(c.var.db, c.var.tenant.id, c.req.param("id"))));

  r.get("/:tenantId/reports/trips/:id/export.csv", requirePerm("reports"), async (c) => {
    const rep = await tripReport(c.var.db, c.var.tenant.id, c.req.param("id"));
    const csv = [
      "kode,pelanggan,status,jumlah_barang,dapat,ditagih,dibayar,belum_dibayar",
      ...rep.orders.map((o) => [o.code, o.customer, o.status, o.items, o.obtained, o.billed, o.paid, o.unpaid].map(csvCell).join(",")),
    ].join("\n");
    const name = rep.trip.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    return c.body("﻿" + csv, 200, { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="laporan-${name || "trip"}.csv"` });
  });
}
