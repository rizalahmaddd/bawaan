import { DECIDED_WITH_GOODS, decideItemSchema, effectivePlan, formatRupiah, maskPhone, normalizePhone, parcelSchema, parsePolicy, policySchema, productPatchSchema, productSchema, pushEndpointSchema, SHIPMENT_LABEL, type ShipmentStatus, shipmentStatusSchema, tripPatchSchema, tripSchema } from "@bawaan/shared";
import { and, asc, desc, eq, inArray, isNull, like, lt, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { Context } from "hono";
import { createRouter, type AppEnv } from "../app";
import { requirePerm, requireRole, requireTenant, requireUser } from "../auth/session";
import { schema } from "../db";
import { HttpError, body, conflict, notFound } from "../lib/http";
import { newId } from "../lib/ids";
import { origins } from "../lib/origins";
import { auditInsert } from "../services/events";
import { ledgerChange } from "../services/ledger";
import { addToShipment, createDelivery, createShipment, removeFromShipment, setShipmentStatus, updateDelivery } from "../services/logistics";
import { notify } from "../services/notify";
import { cancelOrder, confirmOrder, decideItem, orderToken, quoteItem, rejectOrder } from "../services/orders";
import { billCargo, cargoPreview, saveParcels, setShipmentCosts } from "../services/cargo";
import { mergeCustomers } from "../services/customers";
import { remaining } from "../services/invoices";
import { assertCanOpenTrip } from "../services/plan";
import { waitlistAlert } from "../services/stock";
import { combineInvoices, markInvoicePaid, payWithSaldo, recordPayment, rejectPayment, verifyPayment, voidInvoice } from "../services/payments";
import { orderView } from "../services/views";
import { registerBillingRoutes } from "../platform/billing";
import { registerReportRoutes } from "./reports";
import { registerStoreAdminRoutes } from "./store-admin";
import { registerTeamRoutes } from "./team";
import { storeUpload } from "./uploads";
import { csvCell } from "../lib/csv";

export const sellerRoutes = createRouter();
sellerRoutes.use(requireUser);
sellerRoutes.use("/:tenantId/*", requireTenant());
registerTeamRoutes(sellerRoutes);
registerReportRoutes(sellerRoutes);
registerBillingRoutes(sellerRoutes);
registerStoreAdminRoutes(sellerRoutes);

const money = z.number().int().min(0);
const reason = z.object({ reason: z.string().trim().min(3, "Tulis alasannya").max(300) });

async function trackingLink(c: Context<AppEnv>, order: { id: string; code: string; tokenVersion: number }) {
  const url = new URL(origins(c.env, c.req.url).store(c.var.tenant.slug, `/o/${order.code}`));
  url.searchParams.set("t", await orderToken(c.env, order));
  return url.toString();
}

async function alertWaitlist(c: Context<AppEnv>, orderId: string) {
  const rows = await c.var.db.selectDistinct({ id: schema.orderItems.productId }).from(schema.orderItems).where(eq(schema.orderItems.orderId, orderId)).all();
  await waitlistAlert(c.env, c.var.db, c.var.tenant.id, rows.map((r) => r.id).filter((x): x is string => !!x));
}

// Today: everything that needs the seller, counted cheaply.
sellerRoutes.get("/:tenantId/today", async (c) => {
  const db = c.var.db;
  const t = c.var.tenant.id;
  const now = Date.now();
  const [newOrders, pendingPayments, toDecide, approvals, overdue, stale, readyToShip, cargoToBill] = await Promise.all([
    db
      .select({ id: schema.orders.id, code: schema.orders.code, createdAt: schema.orders.createdAt, customer: schema.customers.name })
      .from(schema.orders)
      .innerJoin(schema.customers, eq(schema.customers.id, schema.orders.customerId))
      .where(and(eq(schema.orders.tenantId, t), eq(schema.orders.status, "requested")))
      .orderBy(asc(schema.orders.createdAt))
      .limit(20)
      .all(),
    db
      .select({
        id: schema.payments.id,
        amount: schema.payments.amount,
        createdAt: schema.payments.createdAt,
        customer: schema.customers.name,
        expected: sql<number | null>`${schema.invoices.amount} + ${schema.invoices.uniqueCode} - ${schema.invoices.paid}`,
      })
      .from(schema.payments)
      .innerJoin(schema.customers, eq(schema.customers.id, schema.payments.customerId))
      .leftJoin(schema.invoices, eq(schema.invoices.id, schema.payments.invoiceId))
      .where(and(eq(schema.payments.tenantId, t), eq(schema.payments.status, "pending")))
      .orderBy(asc(schema.payments.createdAt))
      .limit(20)
      .all(),
    db.select({ n: sql<number>`count(*)` }).from(schema.orderItems).where(and(eq(schema.orderItems.tenantId, t), eq(schema.orderItems.status, "hunting"))).get(),
    db
      .select({ id: schema.orderItems.id, title: schema.orderItems.title, deadline: schema.orderItems.approvalDeadline, orderId: schema.orderItems.orderId })
      .from(schema.orderItems)
      .where(and(eq(schema.orderItems.tenantId, t), eq(schema.orderItems.status, "needs_approval")))
      .orderBy(asc(schema.orderItems.approvalDeadline))
      .limit(20)
      .all(),
    db
      .select({ id: schema.invoices.id, number: schema.invoices.number, dueAt: schema.invoices.dueAt, orderId: schema.invoices.orderId, customer: schema.customers.name, amount: schema.invoices.amount, paid: schema.invoices.paid, uniqueCode: schema.invoices.uniqueCode })
      .from(schema.invoices)
      .innerJoin(schema.customers, eq(schema.customers.id, schema.invoices.customerId))
      .where(and(eq(schema.invoices.tenantId, t), inArray(schema.invoices.status, ["open", "partially_paid"]), lt(schema.invoices.dueAt, now)))
      .orderBy(asc(schema.invoices.dueAt))
      .limit(20)
      .all(),
    db
      .select({ id: schema.shipments.id, name: schema.shipments.name, status: schema.shipments.status, updatedAt: schema.shipments.updatedAt })
      .from(schema.shipments)
      .where(and(eq(schema.shipments.tenantId, t), lt(schema.shipments.updatedAt, now - 5 * 86_400_000), sql`${schema.shipments.status} != 'at_seller'`))
      .limit(10)
      .all(),
    db
      .select({ n: sql<number>`count(distinct ${schema.orders.customerId})` })
      .from(schema.orderItems)
      .innerJoin(schema.orders, eq(schema.orders.id, schema.orderItems.orderId))
      .leftJoin(schema.shipments, eq(schema.shipments.id, schema.orderItems.shipmentId))
      .where(
        and(
          eq(schema.orderItems.tenantId, t),
          inArray(schema.orderItems.status, DECIDED_WITH_GOODS),
          isNull(schema.orderItems.deliveryId),
          eq(schema.orders.holdForCombine, false),
          or(isNull(schema.orderItems.shipmentId), eq(schema.shipments.status, "at_seller")),
        ),
      )
      .get(),
    // Batches that arrived on a trip with a cargo rate but whose parcels aren't billed yet.
    db
      .select({ id: schema.shipments.id, name: schema.shipments.name })
      .from(schema.shipments)
      .innerJoin(schema.trips, eq(schema.trips.id, schema.shipments.tripId))
      .where(
        and(
          eq(schema.shipments.tenantId, t),
          inArray(schema.shipments.status, ["arrived_id", "customs", "customs_cleared", "at_seller"]),
          sql`${schema.trips.cargoRatePerKg} is not null`,
          sql`not exists (select 1 from invoices v where v.shipment_id = ${schema.shipments.id} and v.type = 'cargo' and v.status != 'void')`,
        ),
      )
      .limit(10)
      .all(),
  ]);
  return c.json({ newOrders, pendingPayments, toDecide: toDecide?.n ?? 0, approvals, overdue, staleShipments: stale, readyToShip: readyToShip?.n ?? 0, cargoToBill });
});

// Settings
sellerRoutes.get("/:tenantId/settings", async (c) => {
  const db = c.var.db;
  const tenant = (await db.select().from(schema.tenants).where(eq(schema.tenants.id, c.var.tenant.id)).get())!;
  const banks = await db.select().from(schema.bankAccounts).where(eq(schema.bankAccounts.tenantId, tenant.id)).orderBy(asc(schema.bankAccounts.sort)).all();
  const members = await db
    .select({ userId: schema.users.id, name: schema.users.name, email: schema.users.email, role: schema.memberships.role })
    .from(schema.memberships)
    .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
    .where(eq(schema.memberships.tenantId, tenant.id))
    .all();
  return c.json({
    tenant: {
      id: tenant.id,
      slug: tenant.slug,
      name: tenant.name,
      waNumber: tenant.waNumber,
      tintColor: tenant.tintColor,
      logoKey: tenant.logoKey,
      plan: effectivePlan(tenant.plan, tenant.planUntil),
      planUntil: tenant.planUntil,
      status: tenant.status,
      statusReason: tenant.status === "suspended" ? tenant.statusReason : null,
      deletedAt: tenant.deletedAt,
      slugChangedAt: tenant.slugChangedAt,
      customDomain: tenant.customDomain,
    },
    policy: parsePolicy(tenant.policyJson),
    banks,
    members,
    storeUrl: origins(c.env, c.req.url).store(tenant.slug),
    vapidPublicKey: c.env.VAPID_PUBLIC_KEY || null,
  });
});

sellerRoutes.patch("/:tenantId/settings", requireRole("owner", "admin"), async (c) => {
  const input = await body(
    c,
    z.object({
      name: z.string().trim().min(3).max(60).optional(),
      waNumber: z.string().optional(),
      tintColor: z.string().regex(/^#[0-9a-f]{6}$/i).nullable().optional(),
      logoKey: z.string().max(200).nullable().optional(),
      policy: policySchema.partial().optional(),
    }),
  );
  const db = c.var.db;
  const current = (await db.select().from(schema.tenants).where(eq(schema.tenants.id, c.var.tenant.id)).get())!;
  const patch: Partial<typeof schema.tenants.$inferInsert> = {};
  if (input.name) patch.name = input.name;
  if (input.waNumber !== undefined) {
    const p = normalizePhone(input.waNumber);
    if (!p) throw new HttpError(422, "invalid", "Nomor WhatsApp tidak valid");
    patch.waNumber = p;
  }
  if (input.tintColor !== undefined) patch.tintColor = input.tintColor;
  if (input.logoKey !== undefined) patch.logoKey = input.logoKey;
  if (input.policy) patch.policyJson = JSON.stringify(policySchema.parse({ ...parsePolicy(current.policyJson), ...input.policy }));
  await db.batch([
    db.update(schema.tenants).set(patch).where(eq(schema.tenants.id, c.var.tenant.id)),
    auditInsert(db, { tenantId: c.var.tenant.id, actorId: c.var.user.id, action: "settings.update", entityType: "tenant", entityId: c.var.tenant.id, data: Object.keys(patch) }),
  ]);
  return c.json({ ok: true });
});

sellerRoutes.put("/:tenantId/settings/banks", requireRole("owner", "admin"), async (c) => {
  const input = await body(
    c,
    z.array(z.object({ bank: z.string().trim().min(2).max(40), number: z.string().trim().min(3).max(30), holder: z.string().trim().min(2).max(80), qrisKey: z.string().max(200).nullable().optional() })).max(10),
  );
  const db = c.var.db;
  const t = c.var.tenant.id;
  await db.batch([
    db.delete(schema.bankAccounts).where(eq(schema.bankAccounts.tenantId, t)),
    ...input.map((b, i) => db.insert(schema.bankAccounts).values({ id: newId("bnk"), tenantId: t, ...b, qrisKey: b.qrisKey ?? null, sort: i })),
  ]);
  return c.json({ ok: true });
});

// Trips & catalog
// Without a join Drizzle renders ${table.id} unqualified, which the subquery resolves to its own id; name the outer table.
sellerRoutes.get("/:tenantId/trips", async (c) => {
  const db = c.var.db;
  const rows = await db
    .select({
      trip: schema.trips,
      orders: sql<number>`(select count(*) from orders o where o.trip_id = "trips"."id" and o.status in ('requested','active','completed'))`,
      products: sql<number>`(select count(*) from products p where p.trip_id = "trips"."id")`,
    })
    .from(schema.trips)
    .where(eq(schema.trips.tenantId, c.var.tenant.id))
    .orderBy(desc(schema.trips.createdAt))
    .all();
  return c.json(rows.map((r) => ({ ...r.trip, orderCount: r.orders, productCount: r.products })));
});

sellerRoutes.post("/:tenantId/trips", async (c) => {
  const input = await body(c, tripSchema);
  const id = newId("trp");
  await c.var.db.insert(schema.trips).values({ id, tenantId: c.var.tenant.id, ...input, etaAt: input.etaAt ?? null, note: input.note ?? null, status: "draft" });
  return c.json({ id }, 201);
});

sellerRoutes.get("/:tenantId/trips/:id", async (c) => {
  const db = c.var.db;
  const trip = await db.select().from(schema.trips).where(and(eq(schema.trips.id, c.req.param("id")), eq(schema.trips.tenantId, c.var.tenant.id))).get();
  if (!trip) throw notFound("Trip");
  const products = await db.select().from(schema.products).where(eq(schema.products.tripId, trip.id)).orderBy(asc(schema.products.sort), asc(schema.products.createdAt)).all();
  return c.json({ trip, products: products.map((p) => ({ ...p, variants: p.variants ? (JSON.parse(p.variants) as string[]) : [] })) });
});

sellerRoutes.patch("/:tenantId/trips/:id", async (c) => {
  const input = await body(c, tripPatchSchema);
  if (input.status === "open") await assertCanOpenTrip(c.var.db, c.var.tenant.id, c.req.param("id"));
  const updated = await c.var.db
    .update(schema.trips)
    .set(input)
    .where(and(eq(schema.trips.id, c.req.param("id")), eq(schema.trips.tenantId, c.var.tenant.id)))
    .returning({ id: schema.trips.id })
    .get();
  if (!updated) throw notFound("Trip");
  return c.json({ ok: true });
});

sellerRoutes.post("/:tenantId/trips/:id/products", async (c) => {
  const input = await body(c, productSchema);
  const trip = await c.var.db.select({ id: schema.trips.id }).from(schema.trips).where(and(eq(schema.trips.id, c.req.param("id")), eq(schema.trips.tenantId, c.var.tenant.id))).get();
  if (!trip) throw notFound("Trip");
  const id = newId("prd");
  await c.var.db.insert(schema.products).values({ id, tenantId: c.var.tenant.id, tripId: trip.id, ...input, variants: JSON.stringify(input.variants) });
  return c.json({ id }, 201);
});

sellerRoutes.patch("/:tenantId/products/:id", async (c) => {
  const input = await body(c, productPatchSchema);
  const { variants, ...rest } = input;
  const updated = await c.var.db
    .update(schema.products)
    .set({ ...rest, ...(variants ? { variants: JSON.stringify(variants) } : {}) })
    .where(and(eq(schema.products.id, c.req.param("id")), eq(schema.products.tenantId, c.var.tenant.id)))
    .returning({ id: schema.products.id })
    .get();
  if (!updated) throw notFound("Barang");
  return c.json({ ok: true });
});

// Shopping list: what's still being hunted, grouped by product so the seller works store by store.
sellerRoutes.get("/:tenantId/shopping", async (c) => {
  const rows = await c.var.db
    .select({
      id: schema.orderItems.id,
      title: schema.orderItems.title,
      variant: schema.orderItems.variant,
      qty: schema.orderItems.qty,
      link: schema.orderItems.link,
      note: schema.orderItems.note,
      priceMinor: schema.orderItems.priceMinor,
      maxPriceMinor: schema.orderItems.maxPriceMinor,
      currency: schema.orderItems.currency,
      productId: schema.orderItems.productId,
      photoKey: schema.orderItems.photoKey,
      status: schema.orderItems.status,
      orderCode: schema.orders.code,
      orderId: schema.orders.id,
      customer: schema.customers.name,
      tripId: schema.orders.tripId,
      tripTitle: schema.trips.title,
    })
    .from(schema.orderItems)
    .innerJoin(schema.orders, eq(schema.orders.id, schema.orderItems.orderId))
    .innerJoin(schema.customers, eq(schema.customers.id, schema.orders.customerId))
    .innerJoin(schema.trips, eq(schema.trips.id, schema.orders.tripId))
    .where(and(eq(schema.orderItems.tenantId, c.var.tenant.id), inArray(schema.orderItems.status, ["hunting", "needs_approval"])))
    .orderBy(asc(schema.orderItems.title))
    .all();
  return c.json(rows);
});

// Orders
sellerRoutes.get("/:tenantId/orders", async (c) => {
  const { status, trip, q } = c.req.query();
  const db = c.var.db;
  const filters = [eq(schema.orders.tenantId, c.var.tenant.id)];
  if (status === "needs_action") {
    filters.push(
      or(
        eq(schema.orders.status, "requested"),
        sql`exists (select 1 from order_items i where i.order_id = ${schema.orders.id} and i.status in ('hunting','needs_approval'))`,
      )!,
    );
  } else if (status) filters.push(eq(schema.orders.status, status as "requested"));
  if (trip) filters.push(eq(schema.orders.tripId, trip));
  if (q) {
    const term = `%${q.trim()}%`;
    const phone = normalizePhone(q);
    filters.push(or(like(schema.customers.name, term), like(schema.orders.code, term.toUpperCase()), phone ? eq(schema.customers.phone, phone) : undefined)!);
  }
  const rows = await db
    .select({
      id: schema.orders.id,
      code: schema.orders.code,
      status: schema.orders.status,
      createdAt: schema.orders.createdAt,
      customer: schema.customers.name,
      tripTitle: schema.trips.title,
      itemCount: sql<number>`(select count(*) from order_items i where i.order_id = ${schema.orders.id})`,
      total: sql<number>`(select coalesce(sum(coalesce(i.unit_price_idr, 0) * coalesce(i.qty_obtained, i.qty)), 0) from order_items i where i.order_id = ${schema.orders.id} and i.status not in ('cancelled','unavailable','forfeited'))`,
      due: sql<number>`(select coalesce(sum(v.amount_idr + v.unique_code - v.paid_idr), 0) from invoices v where v.order_id = ${schema.orders.id} and v.status in ('open','partially_paid'))`,
      attention: sql<number>`(select count(*) from order_items i where i.order_id = ${schema.orders.id} and i.status in ('hunting','needs_approval'))`,
    })
    .from(schema.orders)
    .innerJoin(schema.customers, eq(schema.customers.id, schema.orders.customerId))
    .innerJoin(schema.trips, eq(schema.trips.id, schema.orders.tripId))
    .where(and(...filters))
    .orderBy(desc(schema.orders.createdAt))
    .limit(200)
    .all();
  return c.json(rows);
});

sellerRoutes.get("/:tenantId/orders/:id", async (c) => {
  const view = await orderView(c.var.db, c.var.tenant.id, c.req.param("id"), "seller");
  const order = (await c.var.db.select().from(schema.orders).where(eq(schema.orders.id, view.order.id)).get())!;
  return c.json({ ...view, trackingUrl: await trackingLink(c, order) });
});

sellerRoutes.post("/:tenantId/orders/:id/confirm", async (c) => {
  const res = await confirmOrder(c.var.db, c.var.tenant, c.req.param("id"), c.var.user.id);
  const order = (await c.var.db.select().from(schema.orders).where(eq(schema.orders.id, c.req.param("id"))).get())!;
  c.executionCtx.waitUntil(
    notify(c.env, c.var.db, [{ audience: "customer", targetId: order.customerId }], {
      title: c.var.tenant.name,
      body: res.invoice ? `Pesanan ${order.code} dikonfirmasi. Tagihan DP sudah bisa dibayar.` : `Pesanan ${order.code} dikonfirmasi.`,
      url: `/o/${order.code}`,
    }),
  );
  return c.json(res);
});

sellerRoutes.post("/:tenantId/orders/:id/reject", async (c) => {
  const { reason: r } = await body(c, reason);
  await rejectOrder(c.var.db, c.var.tenant.id, c.req.param("id"), r, c.var.user.id);
  c.executionCtx.waitUntil(alertWaitlist(c, c.req.param("id")));
  return c.json({ ok: true });
});

sellerRoutes.post("/:tenantId/orders/:id/cancel", requireRole("owner", "admin"), async (c) => {
  const { reason: r } = await body(c, reason);
  await cancelOrder(c.var.db, c.var.tenant.id, c.req.param("id"), r, c.var.user.id);
  c.executionCtx.waitUntil(alertWaitlist(c, c.req.param("id")));
  return c.json({ ok: true });
});

sellerRoutes.post("/:tenantId/items/:id/quote", async (c) => {
  const input = await body(c, z.object({ priceMinor: money, fee: money.default(0) }));
  await quoteItem(c.var.db, c.var.tenant.id, c.req.param("id"), input, c.var.user.id);
  return c.json({ ok: true });
});

/**
 * Shopping Mode replays decisions made offline, so a retried request must not apply twice. Two
 * staff deciding the same item is resolved last-writer-wins; the overwrite is audited and the
 * seller is told.
 */
sellerRoutes.post("/:tenantId/items/:id/decide", async (c) => {
  const input = await body(c, decideItemSchema);
  const db = c.var.db;
  const idem = c.req.header("idempotency-key");
  const idemKey = idem ? `decide:${c.var.tenant.id}:${idem}` : null;
  if (idemKey) {
    const seen = await db.select().from(schema.idempotency).where(eq(schema.idempotency.key, idemKey)).get();
    if (seen) return c.json(JSON.parse(seen.response));
  }
  const clientAt = Number(c.req.header("x-client-at")) || null;
  const before = await db.select({ decidedAt: schema.orderItems.decidedAt, decidedBy: schema.orderItems.decidedBy }).from(schema.orderItems).where(eq(schema.orderItems.id, c.req.param("id"))).get();
  const overwrote = !!(clientAt && before?.decidedAt && before.decidedAt > clientAt && before.decidedBy && before.decidedBy !== c.var.user.id);

  const res = await decideItem(db, c.env, c.var.tenant.id, c.req.param("id"), input, c.var.user.id);
  const item = (await db
    .select({ customerId: schema.orders.customerId, code: schema.orders.code, orderId: schema.orders.id, title: schema.orderItems.title })
    .from(schema.orderItems)
    .innerJoin(schema.orders, eq(schema.orders.id, schema.orderItems.orderId))
    .where(eq(schema.orderItems.id, c.req.param("id")))
    .get())!;
  const body_ =
    res.status === "needs_approval"
      ? `Ada barang di pesanan ${item.code} yang butuh persetujuanmu.`
      : res.settlement
        ? `Semua barang pesanan ${item.code} sudah ada hasilnya. Tagihan pelunasan sudah terbit.`
        : `Ada kabar baru untuk barang di pesanan ${item.code}.`;
  c.executionCtx.waitUntil(notify(c.env, db, [{ audience: "customer", targetId: item.customerId }], { title: c.var.tenant.name, body: body_, url: `/o/${item.code}` }));
  if (overwrote) {
    await auditInsert(db, { tenantId: c.var.tenant.id, actorId: c.var.user.id, action: "item.decide_conflict", entityType: "item", entityId: c.req.param("id"), data: { previousBy: before!.decidedBy, previousAt: before!.decidedAt, clientAt } });
    c.executionCtx.waitUntil(
      notify(c.env, db, [{ audience: "seller", targetId: c.var.tenant.id }], {
        title: "Keputusan belanja ditimpa",
        body: `${item.title} (${item.code}) sudah diputuskan staf lain sebelumnya. Yang tersimpan sekarang keputusan dari ${c.var.user.name}.`,
        url: `/pesanan/${item.orderId}`,
      }),
    );
  }
  const out = { ...res, overwrote };
  if (idemKey) await db.insert(schema.idempotency).values({ key: idemKey, response: JSON.stringify(out) }).onConflictDoNothing();
  return c.json(out);
});

/** Customer asked to hold delivery until their other orders arrive ("gabung kirim"). */
sellerRoutes.post("/:tenantId/orders/:id/hold", async (c) => {
  const { hold } = await body(c, z.object({ hold: z.boolean() }));
  const done = await c.var.db
    .update(schema.orders)
    .set({ holdForCombine: hold })
    .where(and(eq(schema.orders.id, c.req.param("id")), eq(schema.orders.tenantId, c.var.tenant.id)))
    .returning({ id: schema.orders.id })
    .get();
  if (!done) throw notFound("Pesanan");
  return c.json({ ok: true });
});

// Payments & invoices
sellerRoutes.get("/:tenantId/payments", async (c) => {
  const status = (c.req.query("status") ?? "pending") as "pending";
  const rows = await c.var.db
    .select({
      payment: schema.payments,
      customer: schema.customers.name,
      invoiceNumber: schema.invoices.number,
      invoiceDue: sql<number>`${schema.invoices.amount} + ${schema.invoices.uniqueCode} - ${schema.invoices.paid}`,
      orderId: schema.invoices.orderId,
    })
    .from(schema.payments)
    .innerJoin(schema.customers, eq(schema.customers.id, schema.payments.customerId))
    .leftJoin(schema.invoices, eq(schema.invoices.id, schema.payments.invoiceId))
    .where(and(eq(schema.payments.tenantId, c.var.tenant.id), eq(schema.payments.status, status)))
    .orderBy(status === "pending" ? asc(schema.payments.createdAt) : desc(schema.payments.createdAt))
    .limit(100)
    .all();
  return c.json(rows.map((r) => ({ ...r.payment, customer: r.customer, invoiceNumber: r.invoiceNumber, invoiceDue: r.invoiceDue, orderId: r.orderId })));
});

const moneyPerms = requirePerm("money");

sellerRoutes.post("/:tenantId/payments/:id/verify", moneyPerms, async (c) => {
  const input = await body(c, z.object({ amount: money.optional() }));
  const res = await verifyPayment(c.var.db, c.var.tenant.id, c.req.param("id"), c.var.user.id, input.amount);
  const pay = (await c.var.db
    .select({ customerId: schema.payments.customerId, code: schema.orders.code })
    .from(schema.payments)
    .leftJoin(schema.invoices, eq(schema.invoices.id, schema.payments.invoiceId))
    .leftJoin(schema.orders, eq(schema.orders.id, schema.invoices.orderId))
    .where(eq(schema.payments.id, c.req.param("id")))
    .get())!;
  c.executionCtx.waitUntil(
    notify(c.env, c.var.db, [{ audience: "customer", targetId: pay.customerId }], {
      title: c.var.tenant.name,
      body: "Pembayaranmu sudah kami terima. Terima kasih!",
      url: pay.code ? `/o/${pay.code}` : "/",
    }),
  );
  return c.json(res);
});

sellerRoutes.post("/:tenantId/payments/:id/reject", moneyPerms, async (c) => {
  const { reason: r } = await body(c, reason);
  await rejectPayment(c.var.db, c.var.tenant.id, c.req.param("id"), r, c.var.user.id);
  return c.json({ ok: true });
});

sellerRoutes.post("/:tenantId/invoices/:id/payments", moneyPerms, async (c) => {
  const input = await body(c, z.object({ amount: money.min(1), method: z.enum(["transfer", "qris", "cash"]) }));
  return c.json(await recordPayment(c.var.db, { tenantId: c.var.tenant.id, invoiceId: c.req.param("id"), ...input, actorId: c.var.user.id }));
});

sellerRoutes.post("/:tenantId/invoices/:id/saldo", moneyPerms, async (c) => c.json(await payWithSaldo(c.var.db, c.var.tenant.id, c.req.param("id"), c.var.user.id)));
sellerRoutes.post("/:tenantId/invoices/:id/mark-paid", moneyPerms, async (c) => {
  await markInvoicePaid(c.var.db, c.var.tenant.id, c.req.param("id"), c.var.user.id);
  return c.json({ ok: true });
});
sellerRoutes.post("/:tenantId/invoices/:id/void", moneyPerms, async (c) => {
  const { reason: r } = await body(c, reason);
  await voidInvoice(c.var.db, c.var.tenant.id, c.req.param("id"), r, c.var.user.id);
  return c.json({ ok: true });
});

sellerRoutes.get("/:tenantId/customers/:id/invoices", async (c) => {
  const rows = await c.var.db
    .select({ invoice: schema.invoices, code: schema.orders.code })
    .from(schema.invoices)
    .leftJoin(schema.orders, eq(schema.orders.id, schema.invoices.orderId))
    .where(and(eq(schema.invoices.tenantId, c.var.tenant.id), eq(schema.invoices.customerId, c.req.param("id")), ne(schema.invoices.status, "void")))
    .orderBy(desc(schema.invoices.createdAt))
    .limit(100)
    .all();
  return c.json(rows.map((r) => ({ ...r.invoice, lines: JSON.parse(r.invoice.lines), remaining: remaining(r.invoice), orderCode: r.code })));
});

sellerRoutes.post("/:tenantId/invoices/combine", moneyPerms, async (c) => {
  const { invoiceIds } = await body(c, z.object({ invoiceIds: z.array(z.string()).min(2).max(30) }));
  const policy = parsePolicy((await c.var.db.select({ p: schema.tenants.policyJson }).from(schema.tenants).where(eq(schema.tenants.id, c.var.tenant.id)).get())?.p);
  const inv = await combineInvoices(c.var.db, c.var.tenant.id, invoiceIds, c.var.user.id, policy.uniqueCode);
  const code = inv.orderId ? (await c.var.db.select({ code: schema.orders.code }).from(schema.orders).where(eq(schema.orders.id, inv.orderId)).get())?.code : null;
  c.executionCtx.waitUntil(
    notify(c.env, c.var.db, [{ audience: "customer", targetId: inv.customerId }], {
      title: c.var.tenant.name,
      body: `Tagihanmu digabung jadi satu: ${formatRupiah(inv.amount + inv.uniqueCode)}. Cukup sekali transfer.`,
      url: code ? `/o/${code}` : "/akun",
    }),
  );
  return c.json(inv, 201);
});

// Customers
sellerRoutes.get("/:tenantId/customers", async (c) => {
  const q = c.req.query("q")?.trim();
  const filters = [eq(schema.customers.tenantId, c.var.tenant.id), isNull(schema.customers.mergedInto)];
  if (q) {
    const phone = normalizePhone(q);
    filters.push(or(like(schema.customers.name, `%${q}%`), phone ? eq(schema.customers.phone, phone) : undefined)!);
  }
  const rows = await c.var.db
    .select({
      id: schema.customers.id,
      name: schema.customers.name,
      phone: schema.customers.phone,
      balance: schema.customers.balance,
      tags: schema.customers.tags,
      createdAt: schema.customers.createdAt,
      orderCount: sql<number>`(select count(*) from orders o where o.customer_id = "customers"."id")`,
    })
    .from(schema.customers)
    .where(and(...filters))
    .orderBy(asc(schema.customers.name))
    .limit(500)
    .all();
  const mask = c.var.tenant.role === "staff";
  return c.json(mask ? rows.map((r) => ({ ...r, phone: maskPhone(r.phone) })) : rows);
});

sellerRoutes.get("/:tenantId/customers/export.csv", async (c) => {
  const rows = await c.var.db.select().from(schema.customers).where(eq(schema.customers.tenantId, c.var.tenant.id)).orderBy(asc(schema.customers.name)).all();
  const csv = ["nama,whatsapp,email,saldo,catatan,tag", ...rows.map((r) => [r.name, r.phone, r.email, r.balance, r.notes, r.tags].map(csvCell).join(","))].join("\n");
  return c.body("﻿" + csv, 200, { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="pelanggan-${c.var.tenant.slug}.csv"` });
});

sellerRoutes.post("/:tenantId/customers/import", async (c) => {
  const rows = await body(
    c,
    z.array(z.object({ name: z.string().trim().min(1).max(80), phone: z.string(), email: z.string().max(120).optional(), notes: z.string().max(500).optional(), tags: z.string().max(200).optional() })).max(2000),
  );
  const db = c.var.db;
  const errors: Array<{ row: number; message: string }> = [];
  const valid = new Map<string, (typeof rows)[number] & { phone: string }>();
  rows.forEach((r, i) => {
    const phone = normalizePhone(r.phone);
    if (!phone) errors.push({ row: i + 1, message: `Nomor "${r.phone}" tidak valid` });
    else valid.set(phone, { ...r, phone });
  });
  const list = [...valid.values()];
  for (let i = 0; i < list.length; i += 25) {
    const chunk = list.slice(i, i + 25);
    await db
      .insert(schema.customers)
      .values(chunk.map((r) => ({ id: newId("cus"), tenantId: c.var.tenant.id, phone: r.phone, name: r.name, email: r.email || null, notes: r.notes || null, tags: r.tags || null })))
      .onConflictDoUpdate({
        target: [schema.customers.tenantId, schema.customers.phone],
        set: { name: sql`excluded.name`, email: sql`coalesce(excluded.email, ${schema.customers.email})`, notes: sql`coalesce(excluded.notes, ${schema.customers.notes})`, tags: sql`coalesce(excluded.tags, ${schema.customers.tags})` },
      });
  }
  return c.json({ imported: list.length, duplicates: rows.length - list.length - errors.length, errors });
});

sellerRoutes.get("/:tenantId/customers/:id", async (c) => {
  const db = c.var.db;
  const cust = await db.select().from(schema.customers).where(and(eq(schema.customers.id, c.req.param("id")), eq(schema.customers.tenantId, c.var.tenant.id))).get();
  if (!cust) throw notFound("Pelanggan");
  const [orders, ledger, addresses] = await Promise.all([
    db
      .select({ id: schema.orders.id, code: schema.orders.code, status: schema.orders.status, createdAt: schema.orders.createdAt, tripTitle: schema.trips.title })
      .from(schema.orders)
      .innerJoin(schema.trips, eq(schema.trips.id, schema.orders.tripId))
      .where(eq(schema.orders.customerId, cust.id))
      .orderBy(desc(schema.orders.createdAt))
      .all(),
    db.select().from(schema.ledgerEntries).where(eq(schema.ledgerEntries.customerId, cust.id)).orderBy(desc(schema.ledgerEntries.createdAt)).limit(50).all(),
    db.select().from(schema.addresses).where(eq(schema.addresses.customerId, cust.id)).all(),
  ]);
  return c.json({ customer: cust, orders, ledger, addresses });
});

sellerRoutes.patch("/:tenantId/customers/:id", async (c) => {
  const input = await body(c, z.object({ name: z.string().trim().min(1).max(80).optional(), notes: z.string().max(1000).nullable().optional(), tags: z.string().max(200).nullable().optional() }));
  const done = await c.var.db
    .update(schema.customers)
    .set(input)
    .where(and(eq(schema.customers.id, c.req.param("id")), eq(schema.customers.tenantId, c.var.tenant.id)))
    .returning({ id: schema.customers.id })
    .get();
  if (!done) throw notFound("Pelanggan");
  return c.json({ ok: true });
});

/** Saldo paid out by bank transfer, or a manual correction. */
sellerRoutes.post("/:tenantId/customers/:id/ledger", moneyPerms, async (c) => {
  const input = await body(c, z.object({ delta: z.number().int().refine((n) => n !== 0), reason: z.string().trim().min(3).max(200) }));
  const db = c.var.db;
  const cust = await db.select().from(schema.customers).where(and(eq(schema.customers.id, c.req.param("id")), eq(schema.customers.tenantId, c.var.tenant.id))).get();
  if (!cust) throw notFound("Pelanggan");
  if (cust.balance + input.delta < 0) throw conflict("Saldo pelanggan tidak cukup");
  await db.batch([
    ...ledgerChange(db, { tenantId: c.var.tenant.id, customerId: cust.id, delta: input.delta, reason: input.reason, actorId: c.var.user.id }),
    auditInsert(db, { tenantId: c.var.tenant.id, actorId: c.var.user.id, action: "ledger.manual", entityType: "customer", entityId: cust.id, data: input }),
  ]);
  return c.json({ ok: true });
});

sellerRoutes.post("/:tenantId/customers/:id/merge", requireRole("owner", "admin"), async (c) => {
  const { intoId } = await body(c, z.object({ intoId: z.string() }));
  await mergeCustomers(c.var.db, c.var.tenant.id, c.req.param("id"), intoId, c.var.user.id);
  return c.json({ ok: true });
});

// Shipments & deliveries
sellerRoutes.get("/:tenantId/shipments", async (c) => {
  const rows = await c.var.db
    .select({
      shipment: schema.shipments,
      tripTitle: schema.trips.title,
      itemCount: sql<number>`(select count(*) from order_items i where i.shipment_id = ${schema.shipments.id})`,
    })
    .from(schema.shipments)
    .innerJoin(schema.trips, eq(schema.trips.id, schema.shipments.tripId))
    .where(eq(schema.shipments.tenantId, c.var.tenant.id))
    .orderBy(desc(schema.shipments.updatedAt))
    .all();
  return c.json(rows.map((r) => ({ ...r.shipment, tripTitle: r.tripTitle, itemCount: r.itemCount })));
});

sellerRoutes.post("/:tenantId/shipments", async (c) => {
  const input = await body(c, z.object({ tripId: z.string(), name: z.string().trim().min(2).max(80), forwarder: z.string().max(80).nullable().optional(), awb: z.string().max(80).nullable().optional(), etaAt: z.number().int().nullable().optional() }));
  return c.json(await createShipment(c.var.db, c.var.tenant.id, input), 201);
});

sellerRoutes.get("/:tenantId/shipments/:id", async (c) => {
  const db = c.var.db;
  const shp = await db.select().from(schema.shipments).where(and(eq(schema.shipments.id, c.req.param("id")), eq(schema.shipments.tenantId, c.var.tenant.id))).get();
  if (!shp) throw notFound("Pengiriman");
  const itemCols = {
    id: schema.orderItems.id,
    title: schema.orderItems.title,
    variant: schema.orderItems.variant,
    qty: schema.orderItems.qty,
    qtyObtained: schema.orderItems.qtyObtained,
    status: schema.orderItems.status,
    orderCode: schema.orders.code,
    customer: schema.customers.name,
  };
  const [items, candidates, events] = await Promise.all([
    db
      .select(itemCols)
      .from(schema.orderItems)
      .innerJoin(schema.orders, eq(schema.orders.id, schema.orderItems.orderId))
      .innerJoin(schema.customers, eq(schema.customers.id, schema.orders.customerId))
      .where(eq(schema.orderItems.shipmentId, shp.id))
      .orderBy(asc(schema.customers.name))
      .all(),
    db
      .select(itemCols)
      .from(schema.orderItems)
      .innerJoin(schema.orders, eq(schema.orders.id, schema.orderItems.orderId))
      .innerJoin(schema.customers, eq(schema.customers.id, schema.orders.customerId))
      .where(and(eq(schema.orders.tripId, shp.tripId), inArray(schema.orderItems.status, DECIDED_WITH_GOODS), isNull(schema.orderItems.shipmentId), isNull(schema.orderItems.deliveryId)))
      .orderBy(asc(schema.customers.name))
      .all(),
    db.select().from(schema.statusEvents).where(and(eq(schema.statusEvents.entityType, "shipment"), eq(schema.statusEvents.entityId, shp.id))).orderBy(desc(schema.statusEvents.createdAt)).all(),
  ]);
  return c.json({ shipment: shp, items, candidates, events });
});

sellerRoutes.post("/:tenantId/shipments/:id/items", async (c) => {
  const { itemIds } = await body(c, z.object({ itemIds: z.array(z.string()).min(1).max(500) }));
  return c.json(await addToShipment(c.var.db, c.var.tenant.id, c.req.param("id"), itemIds));
});

sellerRoutes.delete("/:tenantId/shipments/:id/items/:itemId", async (c) => {
  await removeFromShipment(c.var.db, c.var.tenant.id, c.req.param("id"), c.req.param("itemId"));
  return c.json({ ok: true });
});

sellerRoutes.post("/:tenantId/shipments/:id/status", async (c) => {
  const input = await body(c, shipmentStatusSchema);
  const res = await setShipmentStatus(c.var.db, c.var.tenant.id, c.req.param("id"), { ...input, status: input.status as ShipmentStatus }, c.var.user.id);
  const codeFor = new Map(res.customers.map((cu) => [cu.customerId, cu.code]));
  c.executionCtx.waitUntil(
    notify(
      c.env,
      c.var.db,
      [...codeFor.keys()].map((id) => ({ audience: "customer" as const, targetId: id })),
      (t) => ({ title: c.var.tenant.name, body: `Update kargo: ${input.message || SHIPMENT_LABEL[input.status as ShipmentStatus].label}`, url: `/o/${codeFor.get(t.targetId)}` }),
    ),
  );
  return c.json({ ok: true, notified: res.customers.length });
});

sellerRoutes.get("/:tenantId/shipments/:id/cargo", async (c) => c.json(await cargoPreview(c.var.db, c.var.tenant.id, c.req.param("id"))));

sellerRoutes.put("/:tenantId/shipments/:id/parcels", async (c) => {
  const parcels = await body(c, z.array(parcelSchema).max(500));
  return c.json(await saveParcels(c.var.db, c.var.tenant.id, c.req.param("id"), parcels, c.var.user.id));
});

async function tellIssued(c: Context<AppEnv>, issued: Array<{ customerId: string; code: string; amount: number }>, what: string) {
  if (!issued.length) return;
  const byCustomer = new Map(issued.map((i) => [i.customerId, i]));
  c.executionCtx.waitUntil(
    notify(
      c.env,
      c.var.db,
      [...byCustomer.keys()].map((id) => ({ audience: "customer" as const, targetId: id })),
      (t) => ({ title: c.var.tenant.name, body: `Tagihan ${what} ${formatRupiah(byCustomer.get(t.targetId)!.amount)} sudah terbit.`, url: `/o/${byCustomer.get(t.targetId)!.code}` }),
    ),
  );
}

sellerRoutes.post("/:tenantId/shipments/:id/bill-cargo", moneyPerms, async (c) => {
  const res = await billCargo(c.var.db, c.var.tenant.id, c.req.param("id"), c.var.user.id);
  await tellIssued(c, res.issued, "ongkir kargo");
  return c.json({ issued: res.issued.length, total: res.issued.reduce((s, i) => s + i.amount, 0) });
});

sellerRoutes.post("/:tenantId/shipments/:id/costs", moneyPerms, async (c) => {
  const input = await body(c, z.object({ costIdr: money.optional(), dutyIdr: money.optional(), dutyMode: z.enum(["pass", "absorb"]).optional(), bill: z.boolean().default(false) }));
  const res = await setShipmentCosts(c.var.db, c.var.tenant.id, c.req.param("id"), input, c.var.user.id);
  await tellIssued(c, res.issued, "bea masuk");
  return c.json({ issued: res.issued.length, total: res.issued.reduce((s, i) => s + i.amount, 0) });
});

sellerRoutes.get("/:tenantId/deliveries/candidates", async (c) => {
  // Items that reached the seller (or never needed cargo) but aren't on a delivery yet.
  const rows = await c.var.db
    .select({
      id: schema.orderItems.id,
      title: schema.orderItems.title,
      variant: schema.orderItems.variant,
      qty: schema.orderItems.qty,
      qtyObtained: schema.orderItems.qtyObtained,
      orderCode: schema.orders.code,
      customerId: schema.customers.id,
      customer: schema.customers.name,
      shipmentStatus: schema.shipments.status,
      hold: schema.orders.holdForCombine,
      // Goods of this customer that are still being bought or still on their way: worth waiting for when they asked to combine.
      waiting: sql<number>`(select count(*) from order_items i2 join orders o2 on o2.id = i2.order_id left join shipments s2 on s2.id = i2.shipment_id
        where o2.customer_id = ${schema.customers.id} and o2.status = 'active' and i2.delivery_id is null
        and (i2.status in ('awaiting_dp','hunting','needs_approval') or (i2.shipment_id is not null and s2.status != 'at_seller')))`,
    })
    .from(schema.orderItems)
    .innerJoin(schema.orders, eq(schema.orders.id, schema.orderItems.orderId))
    .innerJoin(schema.customers, eq(schema.customers.id, schema.orders.customerId))
    .leftJoin(schema.shipments, eq(schema.shipments.id, schema.orderItems.shipmentId))
    .where(and(eq(schema.orderItems.tenantId, c.var.tenant.id), inArray(schema.orderItems.status, DECIDED_WITH_GOODS), isNull(schema.orderItems.deliveryId)))
    .orderBy(asc(schema.customers.name))
    .all();
  return c.json(rows);
});

sellerRoutes.get("/:tenantId/deliveries", async (c) => {
  const mask = c.var.tenant.role === "staff";
  const rows = await c.var.db
    .select({ delivery: schema.deliveries, customer: schema.customers.name, phone: schema.customers.phone })
    .from(schema.deliveries)
    .innerJoin(schema.customers, eq(schema.customers.id, schema.deliveries.customerId))
    .where(eq(schema.deliveries.tenantId, c.var.tenant.id))
    .orderBy(desc(schema.deliveries.createdAt))
    .limit(100)
    .all();
  return c.json(rows.map((r) => ({ ...r.delivery, customer: r.customer, phone: mask ? maskPhone(r.phone) : r.phone })));
});

sellerRoutes.post("/:tenantId/deliveries", async (c) => {
  const input = await body(
    c,
    z.object({
      customerId: z.string(),
      itemIds: z.array(z.string()).min(1),
      courier: z.string().max(40).nullable().optional(),
      resi: z.string().max(60).nullable().optional(),
      cost: money.default(0),
      status: z.enum(["packed", "shipped", "picked_up"]).default("shipped"),
    }),
  );
  const res = await createDelivery(c.var.db, c.var.tenant.id, input, c.var.user.id);
  if (input.status === "shipped" && input.resi) {
    const order = await c.var.db
      .select({ code: schema.orders.code })
      .from(schema.orderItems)
      .innerJoin(schema.orders, eq(schema.orders.id, schema.orderItems.orderId))
      .where(eq(schema.orderItems.id, input.itemIds[0]!))
      .get();
    c.executionCtx.waitUntil(
      notify(c.env, c.var.db, [{ audience: "customer", targetId: input.customerId }], {
        title: c.var.tenant.name,
        body: `Pesananmu dikirim via ${input.courier ?? "kurir"}, resi ${input.resi}.`,
        url: order ? `/o/${order.code}` : "/",
      }),
    );
  }
  return c.json(res, 201);
});

sellerRoutes.patch("/:tenantId/deliveries/:id", async (c) => {
  const input = await body(c, z.object({ status: z.enum(["packed", "shipped", "delivered", "picked_up"]).optional(), courier: z.string().max(40).nullable().optional(), resi: z.string().max(60).nullable().optional() }));
  return c.json(await updateDelivery(c.var.db, c.var.tenant.id, c.req.param("id"), input, c.var.user.id));
});

// Files
sellerRoutes.post("/:tenantId/uploads", async (c) => c.json(await storeUpload(c.env, c.req.raw, c.var.tenant.id, "seller"), 201));

sellerRoutes.get("/:tenantId/files/*", async (c) => {
  const key = c.req.path.split("/files/")[1] ?? "";
  if (!key.startsWith(`t/${c.var.tenant.id}/`)) throw notFound("File");
  const obj = await c.env.PRIVATE_BUCKET.get(key);
  if (!obj) throw notFound("File");
  return new Response(obj.body, { headers: { "Content-Type": obj.httpMetadata?.contentType ?? "application/octet-stream", "Cache-Control": "private, max-age=3600" } });
});

// Push
sellerRoutes.post("/:tenantId/push", async (c) => {
  const { endpoint } = await body(c, z.object({ endpoint: pushEndpointSchema }));
  await c.var.db
    .insert(schema.pushSubscriptions)
    .values({ id: newId("psh"), tenantId: c.var.tenant.id, audience: "seller", targetId: c.var.tenant.id, endpoint })
    .onConflictDoUpdate({ target: schema.pushSubscriptions.endpoint, set: { audience: "seller", targetId: c.var.tenant.id, tenantId: c.var.tenant.id } });
  return c.json({ ok: true });
});

