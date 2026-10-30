import { checkoutSchema, effectivePlan, parsePolicy, phoneLast4, phoneSchema, PLAN_LIMITS, pushEndpointSchema } from "@bawaan/shared";
import { and, asc, desc, eq, gt, inArray, isNull, ne } from "drizzle-orm";
import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { z } from "zod";
import { Hono } from "hono";
import type { AppEnv } from "../app";
import { schema } from "../db";
import { HttpError, body, notFound } from "../lib/http";
import { newId } from "../lib/ids";
import { clientIp, limit, safeEqual, verifyTurnstile } from "../lib/ratelimit";
import { notify } from "../services/notify";
import { checkout, orderToken, respondApproval } from "../services/orders";
import { submitPayment } from "../services/payments";
import { findOrderByCode, orderView } from "../services/views";
import { storeUpload } from "../seller/uploads";
import { appleEnabled, safeReturn, startApple, startGoogle, takeHandoffHash, upsertUser } from "../auth/routes";
import { courierTracking } from "../services/courier";
import { createQris } from "../services/gateway";
import { loadIntegrations } from "../services/integrations";
import { endSession, readSession, startSession } from "../auth/session";
import { sha256 } from "../lib/crypto";

type StoreEnv = AppEnv & { Variables: { store: typeof schema.tenants.$inferSelect } };

/** The platform's sample store linked from the landing page: browsable, but it never takes orders. */
export const DEMO_SLUG = "demo";

export const storeRoutes = new Hono<StoreEnv>();

export const loadStore = createMiddleware<StoreEnv>(async (c, next) => {
  const surface = c.var.surface;
  if (surface.kind !== "store") throw notFound("Toko");
  const db = c.var.db;
  const tenant = await db.select().from(schema.tenants).where(eq(schema.tenants.slug, surface.slug)).get();
  // A paused store ("readonly") stops taking orders but its tracking and invoice links keep working.
  if (!tenant || (tenant.status !== "active" && tenant.status !== "readonly")) {
    const moved = await db
      .select({ tenantId: schema.slugHistory.tenantId })
      .from(schema.slugHistory)
      .where(and(eq(schema.slugHistory.slug, surface.slug), gt(schema.slugHistory.redirectUntil, Date.now())))
      .get();
    const to = moved ? await db.select({ slug: schema.tenants.slug }).from(schema.tenants).where(eq(schema.tenants.id, moved.tenantId)).get() : null;
    throw new HttpError(404, "store_not_found", "Toko tidak ditemukan", to ? { movedTo: to.slug } : undefined);
  }
  c.set("store", tenant);
  await next();
});

storeRoutes.use(loadStore);

storeRoutes.get("/", async (c) => {
  const db = c.var.db;
  const t = c.var.store;
  const [trips, banks] = await Promise.all([
    db.select().from(schema.trips).where(and(eq(schema.trips.tenantId, t.id), eq(schema.trips.status, "open"))).orderBy(asc(schema.trips.closesAt)).all(),
    db.select().from(schema.bankAccounts).where(and(eq(schema.bankAccounts.tenantId, t.id), eq(schema.bankAccounts.active, true))).orderBy(asc(schema.bankAccounts.sort)).all(),
  ]);
  const products = trips.length
    ? await db
        .select()
        .from(schema.products)
        .where(and(inArray(schema.products.tripId, trips.map((x) => x.id)), inArray(schema.products.status, ["active", "sold_out"])))
        .orderBy(asc(schema.products.sort), asc(schema.products.createdAt))
        .all()
    : [];
  const policy = parsePolicy(t.policyJson);
  const plan = effectivePlan(t.plan, t.planUntil);
  return c.json({
    store: {
      name: t.name,
      slug: t.slug,
      waNumber: t.waNumber,
      tintColor: t.tintColor,
      logoKey: t.logoKey,
      policyText: policy.policyText,
      paused: t.status !== "active",
      demo: t.slug === DEMO_SLUG,
      isNew: Date.now() - t.createdAt < 30 * 86_400_000,
      branding: PLAN_LIMITS[plan].branding,
    },
    banks: banks.map((b) => ({ id: b.id, bank: b.bank, number: b.number, holder: b.holder, qrisKey: b.qrisKey })),
    trips: trips.map((tr) => ({
      id: tr.id,
      title: tr.title,
      country: tr.country,
      currency: tr.currency,
      kursMicro: tr.kursMicro,
      rounding: tr.rounding,
      dpPercent: tr.dpPercent,
      kind: tr.kind,
      closesAt: tr.closesAt,
      etaAt: tr.etaAt,
      note: tr.note,
      products: products
        .filter((p) => p.tripId === tr.id)
        .map((p) => ({
          id: p.id,
          title: p.title,
          description: p.description,
          priceMinor: p.priceMinor,
          fee: p.fee,
          photoKey: p.photoKey,
          variants: p.variants ? (JSON.parse(p.variants) as string[]) : [],
          left: p.quota === null ? null : Math.max(0, p.quota - p.reserved),
          status: p.status === "sold_out" || (p.quota !== null && p.reserved >= p.quota) ? "sold_out" : "active",
        })),
    })),
    vapidPublicKey: c.env.VAPID_PUBLIC_KEY || null,
    turnstileSiteKey: c.env.TURNSTILE_SITE_KEY || null,
  });
});

storeRoutes.post("/checkout", async (c) => {
  await limit(c.env.WRITE_LIMITER, `checkout:${clientIp(c.req.raw)}`);
  if (c.var.store.status !== "active") throw new HttpError(409, "conflict", "Toko sedang tutup sementara");
  if (c.var.store.slug === DEMO_SLUG) throw new HttpError(409, "conflict", "Ini toko contoh, pesanan tidak diproses. Buat tokomu sendiri di bawaan.my.id.");
  const input = await body(c, checkoutSchema);
  await verifyTurnstile(c.env, input.turnstileToken, clientIp(c.req.raw));
  const res = await checkout(c.var.db, c.env, c.var.store, input);
  c.executionCtx.waitUntil(
    notify(c.env, c.var.db, [{ audience: "seller", targetId: c.var.store.id }], {
      title: "Pesanan baru",
      body: `${input.customer.name} memesan ${input.items.length + input.requests.length} barang (${res.code})`,
      url: `/pesanan/${res.orderId}`,
    }),
  );
  return c.json({ code: res.code, token: res.token }, 201);
});

storeRoutes.post("/track", async (c) => {
  const input = await body(c, z.object({ code: z.string().trim().min(6).max(20), last4: z.string().regex(/^\d{4}$/, "Isi 4 digit terakhir") }));
  await limit(c.env.TRACK_LIMITER, `track:${clientIp(c.req.raw)}`);
  const order = await findOrderByCode(c.var.db, c.var.store.id, input.code);
  const cust = order && (await c.var.db.select({ phone: schema.customers.phone }).from(schema.customers).where(eq(schema.customers.id, order.customerId)).get());
  if (!order || !cust || phoneLast4(cust.phone) !== input.last4) throw new HttpError(404, "not_found", "Kode pesanan atau nomor tidak cocok");
  return c.json({ code: order.code, token: await orderToken(c.env, order) });
});

/** Resolves :code and checks the order token from the X-Order-Token header or ?t=. */
async function authorizedOrder(c: Context<StoreEnv>) {
  const order = await findOrderByCode(c.var.db, c.var.store.id, c.req.param("code") ?? "");
  const token = c.req.header("x-order-token") ?? c.req.query("t") ?? "";
  if (!order || !safeEqual(token, await orderToken(c.env, order))) throw new HttpError(404, "not_found", "Pesanan tidak ditemukan atau link sudah tidak berlaku");
  return order;
}

storeRoutes.get("/orders/:code", async (c) => {
  const order = await authorizedOrder(c);
  const view = await orderView(c.var.db, c.var.store.id, order.id, "customer");
  const banks = await c.var.db.select().from(schema.bankAccounts).where(and(eq(schema.bankAccounts.tenantId, c.var.store.id), eq(schema.bankAccounts.active, true))).orderBy(asc(schema.bankAccounts.sort)).all();
  const notes = await c.var.db
    .select({ title: schema.notifications.title, body: schema.notifications.body, createdAt: schema.notifications.createdAt })
    .from(schema.notifications)
    .where(and(eq(schema.notifications.audience, "customer"), eq(schema.notifications.targetId, order.customerId)))
    .orderBy(desc(schema.notifications.createdAt))
    .limit(5)
    .all();
  return c.json({
    ...view,
    customer: view.customer && { name: view.customer.name, balance: view.customer.balance, linked: view.customer.linked },
    store: { name: c.var.store.name, waNumber: c.var.store.waNumber, policyText: parsePolicy(c.var.store.policyJson).policyText },
    banks: banks.map((b) => ({ bank: b.bank, number: b.number, holder: b.holder, qrisKey: b.qrisKey })),
    notifications: notes,
    vapidPublicKey: c.env.VAPID_PUBLIC_KEY || null,
    qris: !!(await loadIntegrations(c.env, c.var.db, c.var.store.id)).xendit,
  });
});

storeRoutes.post("/orders/:code/invoices/:id/qris", async (c) => {
  const order = await authorizedOrder(c);
  await limit(c.env.WRITE_LIMITER, `qris:${clientIp(c.req.raw)}`);
  return c.json(await createQris(c.env, c.var.db, c.var.store.id, order.customerId, c.req.param("id")));
});

/** Shows whether a QRIS has been paid yet, so the pay sheet can close itself. */
storeRoutes.get("/orders/:code/invoices/:id/status", async (c) => {
  const order = await authorizedOrder(c);
  const inv = await c.var.db
    .select({ status: schema.invoices.status, paid: schema.invoices.paid })
    .from(schema.invoices)
    .where(and(eq(schema.invoices.id, c.req.param("id")), eq(schema.invoices.customerId, order.customerId)))
    .get();
  if (!inv) throw notFound("Tagihan");
  return c.json(inv);
});

storeRoutes.get("/orders/:code/deliveries/:id/tracking", async (c) => {
  const order = await authorizedOrder(c);
  const dlv = await c.var.db
    .select()
    .from(schema.deliveries)
    .where(and(eq(schema.deliveries.id, c.req.param("id")), eq(schema.deliveries.customerId, order.customerId)))
    .get();
  if (!dlv?.resi || !dlv.courier) return c.json({ tracking: null });
  return c.json({ tracking: await courierTracking(c.env, dlv.courier, dlv.resi) });
});

storeRoutes.post("/waitlist", async (c) => {
  await limit(c.env.WRITE_LIMITER, `waitlist:${clientIp(c.req.raw)}`);
  const input = await body(c, z.object({ productId: z.string(), name: z.string().trim().min(2).max(80), phone: phoneSchema, turnstileToken: z.string().optional() }));
  await verifyTurnstile(c.env, input.turnstileToken, clientIp(c.req.raw));
  const p = await c.var.db.select({ id: schema.products.id }).from(schema.products).where(and(eq(schema.products.id, input.productId), eq(schema.products.tenantId, c.var.store.id))).get();
  if (!p) throw notFound("Barang");
  await c.var.db.insert(schema.waitlist).values({ id: newId("wtl"), tenantId: c.var.store.id, productId: p.id, name: input.name, phone: input.phone }).onConflictDoNothing();
  return c.json({ ok: true }, 201);
});

storeRoutes.post("/report", async (c) => {
  await limit(c.env.WRITE_LIMITER, `report:${clientIp(c.req.raw)}`);
  const input = await body(c, z.object({ reason: z.string().trim().min(10, "Ceritakan sedikit lebih detail").max(1000), contact: z.string().trim().max(120).optional() }));
  await c.var.db.insert(schema.abuseReports).values({ id: newId("rpt"), tenantId: c.var.store.id, reason: input.reason, contact: input.contact || null });
  return c.json({ ok: true }, 201);
});

storeRoutes.post("/orders/:code/items/:itemId/approval", async (c) => {
  const order = await authorizedOrder(c);
  const { approve } = await body(c, z.object({ approve: z.boolean() }));
  await respondApproval(c.var.db, c.env, c.var.store.id, order.id, c.req.param("itemId"), approve);
  c.executionCtx.waitUntil(
    notify(c.env, c.var.db, [{ audience: "seller", targetId: c.var.store.id }], {
      title: approve ? "Persetujuan diterima" : "Pelanggan menolak",
      body: `Pesanan ${order.code}: pelanggan ${approve ? "setuju" : "tidak setuju"} dengan perubahan barang.`,
      url: `/pesanan/${order.id}`,
    }),
  );
  return c.json({ ok: true });
});

storeRoutes.post("/orders/:code/uploads", async (c) => {
  await authorizedOrder(c);
  await limit(c.env.WRITE_LIMITER, `upload:${clientIp(c.req.raw)}`);
  const res = await storeUpload(c.env, c.req.raw, c.var.store.id, "customer");
  return c.json({ key: res.key }, 201);
});

storeRoutes.post("/orders/:code/payments", async (c) => {
  const order = await authorizedOrder(c);
  const input = await body(c, z.object({ invoiceId: z.string(), amount: z.number().int().min(1), proofKey: z.string(), method: z.enum(["transfer", "qris"]).default("transfer") }));
  if (!input.proofKey.startsWith(`t/${c.var.store.id}/proof/`)) throw new HttpError(422, "invalid", "Bukti transfer tidak valid");
  const head = await c.env.PRIVATE_BUCKET.head(input.proofKey);
  if (!head) throw new HttpError(422, "invalid", "Upload bukti transfer dulu");
  const res = await submitPayment(c.var.db, {
    tenantId: c.var.store.id,
    customerId: order.customerId,
    invoiceId: input.invoiceId,
    amount: input.amount,
    proofKey: input.proofKey,
    proofHash: head.customMetadata?.hash ?? input.proofKey,
    method: input.method,
  });
  c.executionCtx.waitUntil(
    notify(c.env, c.var.db, [{ audience: "seller", targetId: c.var.store.id }], {
      title: "Bukti bayar baru",
      body: `Pesanan ${order.code} mengirim bukti bayar. Cek mutasi sebelum diterima.`,
      url: "/pembayaran",
    }),
  );
  return c.json(res, 201);
});

storeRoutes.post("/orders/:code/push", async (c) => {
  const order = await authorizedOrder(c);
  const { endpoint } = await body(c, z.object({ endpoint: pushEndpointSchema }));
  await c.var.db
    .insert(schema.pushSubscriptions)
    .values({ id: newId("psh"), tenantId: c.var.store.id, audience: "customer", targetId: order.customerId, endpoint })
    .onConflictDoUpdate({ target: schema.pushSubscriptions.endpoint, set: { audience: "customer", targetId: order.customerId, tenantId: c.var.store.id } });
  return c.json({ ok: true });
});

// Customer accounts (optional Google sign-in on the store's own subdomain)
storeRoutes.get("/auth/google/start", async (c) => startGoogle(c, safeReturn(c.req.query("return") ?? "/akun"), c.var.store.slug));

storeRoutes.get("/auth/finish", async (c) => {
  const code = c.req.query("code");
  if (!code) throw new HttpError(400, "bad_request", "Kode login tidak ada");
  const hash = await takeHandoffHash(c, code);
  if (!hash) return c.redirect("/akun?login=gagal");
  const row = await c.var.db
    .delete(schema.authHandoffs)
    .where(and(eq(schema.authHandoffs.codeHash, hash), eq(schema.authHandoffs.target, c.var.store.slug)))
    .returning()
    .get();
  if (!row || row.expiresAt < Date.now()) return c.redirect("/akun?login=kedaluwarsa");
  await startSession(c, row.userId);
  return c.redirect(row.returnTo);
});

storeRoutes.post("/auth/dev-login", async (c) => {
  if (c.env.ENVIRONMENT !== "development") throw notFound("Halaman");
  const input = await body(c, z.object({ email: z.email(), name: z.string().min(1).default("Pelanggan") }));
  await startSession(c, await upsertUser(c.var.db, `dev:${input.email}`, input.email, input.name, null));
  return c.json({ ok: true });
});

storeRoutes.post("/auth/logout", async (c) => {
  await endSession(c);
  return c.json({ ok: true });
});

/** Orders of every customer record this Google account has been linked to at this store. */
storeRoutes.get("/me", async (c) => {
  const user = await readSession(c);
  if (!user) return c.json({ user: null, googleEnabled: !!c.env.GOOGLE_CLIENT_ID, appleEnabled: appleEnabled(c.env), devLogin: c.env.ENVIRONMENT === "development" });
  const db = c.var.db;
  const customers = await db
    .select()
    .from(schema.customers)
    .where(and(eq(schema.customers.tenantId, c.var.store.id), eq(schema.customers.userId, user.id), isNull(schema.customers.mergedInto)))
    .all();
  const ids = customers.map((x) => x.id);
  const [orders, addresses] = ids.length
    ? await Promise.all([
        db
          .select({ order: schema.orders, tripTitle: schema.trips.title })
          .from(schema.orders)
          .innerJoin(schema.trips, eq(schema.trips.id, schema.orders.tripId))
          .where(and(inArray(schema.orders.customerId, ids), ne(schema.orders.status, "rejected")))
          .orderBy(desc(schema.orders.createdAt))
          .limit(100)
          .all(),
        db.select().from(schema.addresses).where(inArray(schema.addresses.customerId, ids)).orderBy(desc(schema.addresses.createdAt)).limit(10).all(),
      ])
    : [[], []];
  return c.json({
    user: { name: user.name, email: user.email, avatarUrl: user.avatarUrl },
    balance: customers.reduce((s, x) => s + x.balance, 0),
    orders: await Promise.all(
      orders.map(async ({ order, tripTitle }) => ({ code: order.code, status: order.status, createdAt: order.createdAt, tripTitle, token: await orderToken(c.env, order) })),
    ),
    addresses: addresses.map((a) => ({ id: a.id, recipient: a.recipient, line: a.line, city: a.city })),
    googleEnabled: !!c.env.GOOGLE_CLIENT_ID,
    appleEnabled: appleEnabled(c.env),
    devLogin: c.env.ENVIRONMENT === "development",
  });
});

storeRoutes.get("/auth/apple/start", async (c) => startApple(c, safeReturn(c.req.query("return") ?? "/akun"), c.var.store.slug));

/** Holding the order link (sent over WhatsApp) is the proof that this account may see the customer's orders. */
storeRoutes.post("/orders/:code/link", async (c) => {
  const order = await authorizedOrder(c);
  const user = await readSession(c);
  if (!user) throw new HttpError(401, "unauthenticated", "Masuk dengan Google dulu");
  const cust = (await c.var.db.select().from(schema.customers).where(eq(schema.customers.id, order.customerId)).get())!;
  if (cust.userId && cust.userId !== user.id) throw new HttpError(409, "conflict", "Pesanan ini sudah tersambung ke akun Google lain");
  await c.var.db.update(schema.customers).set({ userId: user.id }).where(eq(schema.customers.id, cust.id));
  return c.json({ ok: true });
});

storeRoutes.post("/orders/:code/hold", async (c) => {
  const order = await authorizedOrder(c);
  const { hold } = await body(c, z.object({ hold: z.boolean() }));
  await c.var.db.update(schema.orders).set({ holdForCombine: hold }).where(eq(schema.orders.id, order.id));
  return c.json({ ok: true });
});
