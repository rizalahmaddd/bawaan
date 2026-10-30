import { allocateProportionally, cargoCharge, formatKg, parsePolicy, type ParcelInput } from "@bawaan/shared";
import { and, asc, eq, ne } from "drizzle-orm";
import type { DB } from "../db";
import { schema } from "../db";
import { conflict, notFound } from "../lib/http";
import { newId } from "../lib/ids";
import { auditInsert, eventInsert } from "./events";
import { createInvoice } from "./invoices";

const DAY = 86_400_000;

async function loadShipment(db: DB, tenantId: string, shipmentId: string) {
  const shp = await db.select().from(schema.shipments).where(and(eq(schema.shipments.id, shipmentId), eq(schema.shipments.tenantId, tenantId))).get();
  if (!shp) throw notFound("Pengiriman");
  const trip = (await db.select().from(schema.trips).where(eq(schema.trips.id, shp.tripId)).get())!;
  return { shp, trip };
}

/** Customers in the batch with their goods value, which is what duty is split by. */
async function customersInShipment(db: DB, shipmentId: string) {
  const items = await db
    .select({
      id: schema.orderItems.id,
      orderId: schema.orderItems.orderId,
      unitPrice: schema.orderItems.unitPrice,
      qty: schema.orderItems.qty,
      qtyObtained: schema.orderItems.qtyObtained,
      customerId: schema.orders.customerId,
      customer: schema.customers.name,
      code: schema.orders.code,
    })
    .from(schema.orderItems)
    .innerJoin(schema.orders, eq(schema.orders.id, schema.orderItems.orderId))
    .innerJoin(schema.customers, eq(schema.customers.id, schema.orders.customerId))
    .where(eq(schema.orderItems.shipmentId, shipmentId))
    .orderBy(asc(schema.customers.name))
    .all();
  const by = new Map<string, { customerId: string; customer: string; orderId: string; codes: Set<string>; itemCount: number; value: number }>();
  for (const i of items) {
    const g = by.get(i.customerId) ?? { customerId: i.customerId, customer: i.customer, orderId: i.orderId, codes: new Set(), itemCount: 0, value: 0 };
    g.codes.add(i.code);
    g.itemCount += i.qtyObtained ?? i.qty;
    g.value += (i.unitPrice ?? 0) * (i.qtyObtained ?? i.qty);
    by.set(i.customerId, g);
  }
  return [...by.values()];
}

export async function saveParcels(db: DB, tenantId: string, shipmentId: string, parcels: ParcelInput[], actorId: string) {
  await loadShipment(db, tenantId, shipmentId);
  const inBatch = new Set((await customersInShipment(db, shipmentId)).map((c) => c.customerId));
  if (parcels.some((p) => !inBatch.has(p.customerId))) throw conflict("Ada pelanggan yang tidak punya barang di batch ini");
  const locked = new Set(
    (
      await db
        .select({ customerId: schema.parcels.customerId })
        .from(schema.parcels)
        .innerJoin(schema.invoices, eq(schema.invoices.id, schema.parcels.invoiceId))
        .where(and(eq(schema.parcels.shipmentId, shipmentId), ne(schema.invoices.status, "void")))
        .all()
    ).map((r) => r.customerId),
  );
  const editable = parcels.filter((p) => !locked.has(p.customerId));
  if (!editable.length) return { saved: 0, locked: locked.size };
  await db.batch([
    auditInsert(db, { tenantId, actorId, action: "shipment.parcels", entityType: "shipment", entityId: shipmentId, data: editable }),
    ...editable.map((p) =>
      db
        .insert(schema.parcels)
        .values({ id: newId("pcl"), tenantId, shipmentId, customerId: p.customerId, weightG: p.weightG, lengthCm: p.lengthCm ?? null, widthCm: p.widthCm ?? null, heightCm: p.heightCm ?? null })
        .onConflictDoUpdate({
          target: [schema.parcels.shipmentId, schema.parcels.customerId],
          set: { weightG: p.weightG, lengthCm: p.lengthCm ?? null, widthCm: p.widthCm ?? null, heightCm: p.heightCm ?? null, invoiceId: null },
        }),
    ),
  ]);
  return { saved: editable.length, locked: locked.size };
}

/** What each customer would be billed for cargo, so the seller can check before sending. */
export async function cargoPreview(db: DB, tenantId: string, shipmentId: string) {
  const { shp, trip } = await loadShipment(db, tenantId, shipmentId);
  const [customers, parcels] = await Promise.all([
    customersInShipment(db, shipmentId),
    db
      .select({ parcel: schema.parcels, invoiceStatus: schema.invoices.status, invoiceNumber: schema.invoices.number })
      .from(schema.parcels)
      .leftJoin(schema.invoices, eq(schema.invoices.id, schema.parcels.invoiceId))
      .where(eq(schema.parcels.shipmentId, shipmentId))
      .all(),
  ]);
  const rule = trip.cargoRatePerKg ? { ratePerKg: trip.cargoRatePerKg, roundG: trip.cargoRoundG, minIdr: trip.cargoMinIdr } : null;
  const byCustomer = new Map(parcels.map((p) => [p.parcel.customerId, p]));
  const rows = customers.map((c) => {
    const p = byCustomer.get(c.customerId);
    const charge = rule && p ? cargoCharge(rule, p.parcel.weightG, p.parcel) : null;
    const billed = !!p?.parcel.invoiceId && p.invoiceStatus !== "void";
    return {
      customerId: c.customerId,
      customer: c.customer,
      orderCodes: [...c.codes],
      itemCount: c.itemCount,
      value: c.value,
      weightG: p?.parcel.weightG ?? null,
      lengthCm: p?.parcel.lengthCm ?? null,
      widthCm: p?.parcel.widthCm ?? null,
      heightCm: p?.parcel.heightCm ?? null,
      billedG: charge?.billedG ?? null,
      volumetric: charge?.volumetric ?? false,
      amount: charge?.amount ?? null,
      invoiceNumber: billed ? p!.invoiceNumber : null,
    };
  });
  const dutyBilled = await db
    .select({ id: schema.invoices.id })
    .from(schema.invoices)
    .where(and(eq(schema.invoices.shipmentId, shipmentId), eq(schema.invoices.type, "adjustment"), ne(schema.invoices.status, "void")))
    .get();
  return {
    rule,
    costIdr: shp.costIdr,
    dutyIdr: shp.dutyIdr,
    dutyMode: shp.dutyMode,
    dutyBilled: !!dutyBilled,
    rows,
    totalBilled: rows.reduce((s, r) => s + (r.invoiceNumber ? (r.amount ?? 0) : 0), 0),
    totalPreview: rows.reduce((s, r) => s + (r.amount ?? 0), 0),
  };
}

/** Issues a cargo invoice for every weighed parcel that doesn't have a live one yet. */
export async function billCargo(db: DB, tenantId: string, shipmentId: string, actorId: string) {
  const { shp, trip } = await loadShipment(db, tenantId, shipmentId);
  if (!trip.cargoRatePerKg) throw conflict("Isi tarif kargo per kg di pengaturan trip dulu");
  const preview = await cargoPreview(db, tenantId, shipmentId);
  const customers = await customersInShipment(db, shipmentId);
  const policy = parsePolicy((await db.select({ p: schema.tenants.policyJson }).from(schema.tenants).where(eq(schema.tenants.id, tenantId)).get())?.p);
  const issued: Array<{ customerId: string; code: string; invoiceId: string; amount: number }> = [];
  for (const row of preview.rows) {
    if (row.invoiceNumber || !row.amount || row.weightG === null) continue;
    const c = customers.find((x) => x.customerId === row.customerId)!;
    const inv = await createInvoice(db, {
      tenantId,
      customerId: row.customerId,
      orderId: c.orderId,
      type: "cargo",
      lines: [
        {
          label: `Kargo ${shp.name} · ${formatKg(row.billedG!)}${row.volumetric ? " (volume)" : ""} × ${trip.cargoRatePerKg.toLocaleString("id-ID")}/kg`,
          amount: row.amount,
        },
      ],
      dueAt: Date.now() + policy.settleDays * DAY,
      uniqueCode: policy.uniqueCode,
      shipmentId,
    });
    await db.batch([
      db.update(schema.parcels).set({ invoiceId: inv.id }).where(and(eq(schema.parcels.shipmentId, shipmentId), eq(schema.parcels.customerId, row.customerId))),
      eventInsert(db, { tenantId, entityType: "invoice", entityId: inv.id, status: "open", message: "Tagihan ongkir kargo terbit", actorId }),
    ]);
    issued.push({ customerId: row.customerId, code: [...c.codes][0]!, invoiceId: inv.id, amount: row.amount });
  }
  return { issued };
}

/**
 * Records the batch's real cost and duty. With pass-through, duty is split by goods value and billed
 * as adjustment invoices; with absorb it only shows up in the seller's reports.
 */
export async function setShipmentCosts(
  db: DB,
  tenantId: string,
  shipmentId: string,
  input: { costIdr?: number; dutyIdr?: number; dutyMode?: "pass" | "absorb"; bill?: boolean },
  actorId: string,
) {
  const { shp } = await loadShipment(db, tenantId, shipmentId);
  const dutyIdr = input.dutyIdr ?? shp.dutyIdr;
  const dutyMode = input.dutyMode ?? shp.dutyMode;
  const already = await db
    .select({ id: schema.invoices.id })
    .from(schema.invoices)
    .where(and(eq(schema.invoices.shipmentId, shipmentId), eq(schema.invoices.type, "adjustment"), ne(schema.invoices.status, "void")))
    .all();
  if (already.length && (dutyIdr !== shp.dutyIdr || dutyMode !== shp.dutyMode)) throw conflict("Tagihan bea masuk sudah terbit. Batalkan tagihannya dulu untuk mengubah.");
  await db.batch([
    db.update(schema.shipments).set({ costIdr: input.costIdr ?? shp.costIdr, dutyIdr, dutyMode }).where(eq(schema.shipments.id, shipmentId)),
    auditInsert(db, { tenantId, actorId, action: "shipment.costs", entityType: "shipment", entityId: shipmentId, data: input }),
  ]);
  if (!input.bill || dutyMode !== "pass" || dutyIdr <= 0 || already.length) return { issued: [] };

  const customers = (await customersInShipment(db, shipmentId)).filter((c) => c.value > 0);
  if (!customers.length) throw conflict("Belum ada barang bernilai di batch ini");
  const shares = allocateProportionally(dutyIdr, customers.map((c) => c.value));
  const policy = parsePolicy((await db.select({ p: schema.tenants.policyJson }).from(schema.tenants).where(eq(schema.tenants.id, tenantId)).get())?.p);
  const issued: Array<{ customerId: string; code: string; invoiceId: string; amount: number }> = [];
  for (const [i, c] of customers.entries()) {
    const amount = shares[i]!;
    if (amount <= 0) continue;
    const inv = await createInvoice(db, {
      tenantId,
      customerId: c.customerId,
      orderId: c.orderId,
      type: "adjustment",
      lines: [{ label: `Bea masuk ${shp.name} (porsi ${Math.round((c.value / customers.reduce((s, x) => s + x.value, 0)) * 100)}% dari nilai barang)`, amount }],
      dueAt: Date.now() + policy.settleDays * DAY,
      uniqueCode: policy.uniqueCode,
      shipmentId,
    });
    issued.push({ customerId: c.customerId, code: [...c.codes][0]!, invoiceId: inv.id, amount });
  }
  return { issued };
}
