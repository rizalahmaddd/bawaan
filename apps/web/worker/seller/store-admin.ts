import { PLAN_LIMITS, parsePolicy } from "@bawaan/shared";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import type { createRouter } from "../app";
import { requirePerm, requireRole } from "../auth/session";
import { schema } from "../db";
import { HttpError, body, conflict } from "../lib/http";
import { zip, toCsv } from "../lib/zip";
import { courierEnabled, courierRates } from "../services/courier";
import { addDomain, domainStatus, domainsEnabled, hostKey, removeDomain } from "../services/domains";
import { auditInsert } from "../services/events";
import { describeIntegrations, integrationFeatures, integrationsSchema, loadIntegrations, saveIntegrations } from "../services/integrations";
import { planOf } from "../services/plan";
import { ensureReadyTrip, relistAsReadyStock } from "../services/stock";
import { slugAvailability } from "./tenants";

const DAY = 86_400_000;
export const DELETE_GRACE_DAYS = 7;

export function registerStoreAdminRoutes(r: ReturnType<typeof createRouter>) {
  /** Rename once per 30 days; the old name redirects for 90 days and can't be claimed for 180. */
  r.post("/:tenantId/settings/slug", requireRole("owner"), async (c) => {
    const { slug } = await body(c, z.object({ slug: z.string() }));
    const db = c.var.db;
    const t = (await db.select().from(schema.tenants).where(eq(schema.tenants.id, c.var.tenant.id)).get())!;
    if (t.slugChangedAt && Date.now() - t.slugChangedAt < 30 * DAY) throw conflict("Alamat toko baru bisa diganti lagi 30 hari setelah penggantian terakhir");
    const avail = await slugAvailability(db, slug);
    if (!avail.ok) throw new HttpError(422, "invalid", avail.reason);
    if (avail.slug === t.slug) return c.json({ slug: t.slug });
    const now = Date.now();
    await db.batch([
      db
        .insert(schema.slugHistory)
        .values({ slug: t.slug, tenantId: t.id, releasedAt: now, redirectUntil: now + 90 * DAY, quarantineUntil: now + 180 * DAY })
        .onConflictDoUpdate({ target: schema.slugHistory.slug, set: { tenantId: t.id, releasedAt: now, redirectUntil: now + 90 * DAY, quarantineUntil: now + 180 * DAY } }),
      db.update(schema.tenants).set({ slug: avail.slug, slugChangedAt: now }).where(eq(schema.tenants.id, t.id)),
      auditInsert(db, { tenantId: t.id, actorId: c.var.user.id, action: "tenant.rename", entityType: "tenant", entityId: t.id, data: { from: t.slug, to: avail.slug } }),
    ]);
    if (t.customDomain) await c.env.HOSTS.put(hostKey(t.customDomain), avail.slug);
    return c.json({ slug: avail.slug });
  });

  /** Pausing closes the store to new orders but keeps every tracking and invoice link working. */
  r.post("/:tenantId/settings/pause", requireRole("owner", "admin"), async (c) => {
    const { paused } = await body(c, z.object({ paused: z.boolean() }));
    const db = c.var.db;
    const t = (await db.select({ status: schema.tenants.status, deletedAt: schema.tenants.deletedAt }).from(schema.tenants).where(eq(schema.tenants.id, c.var.tenant.id)).get())!;
    if (t.status === "suspended") throw conflict("Toko ini sedang dibekukan oleh Bawaan");
    if (t.deletedAt) throw conflict("Toko ini dijadwalkan dihapus. Batalkan penghapusan dulu.");
    await db.update(schema.tenants).set({ status: paused ? "readonly" : "active" }).where(eq(schema.tenants.id, c.var.tenant.id));
    return c.json({ ok: true });
  });

  r.post("/:tenantId/settings/delete", requireRole("owner"), async (c) => {
    const { confirmSlug } = await body(c, z.object({ confirmSlug: z.string() }));
    if (confirmSlug.trim().toLowerCase() !== c.var.tenant.slug) throw new HttpError(422, "invalid", "Ketik alamat toko persis untuk konfirmasi");
    const db = c.var.db;
    await db.batch([
      db.update(schema.tenants).set({ status: "readonly", deletedAt: Date.now() }).where(eq(schema.tenants.id, c.var.tenant.id)),
      auditInsert(db, { tenantId: c.var.tenant.id, actorId: c.var.user.id, action: "tenant.delete_requested", entityType: "tenant", entityId: c.var.tenant.id }),
    ]);
    return c.json({ deleteAt: Date.now() + DELETE_GRACE_DAYS * DAY });
  });

  r.post("/:tenantId/settings/restore", requireRole("owner"), async (c) => {
    const db = c.var.db;
    await db.batch([
      db.update(schema.tenants).set({ status: "active", deletedAt: null }).where(and(eq(schema.tenants.id, c.var.tenant.id), eq(schema.tenants.status, "readonly"))),
      auditInsert(db, { tenantId: c.var.tenant.id, actorId: c.var.user.id, action: "tenant.delete_cancelled", entityType: "tenant", entityId: c.var.tenant.id }),
    ]);
    return c.json({ ok: true });
  });

  /** Everything the store owns, as CSVs in one zip. No lock-in, and the basis for UU PDP data requests. */
  r.get("/:tenantId/export.zip", requireRole("owner", "admin"), async (c) => {
    const db = c.var.db;
    const t = c.var.tenant.id;
    const [customers, addresses, trips, products, orders, items, invoices, payments, ledger, shipments, parcels, deliveries] = await Promise.all([
      db.select().from(schema.customers).where(eq(schema.customers.tenantId, t)).all(),
      db.select().from(schema.addresses).where(eq(schema.addresses.tenantId, t)).all(),
      db.select().from(schema.trips).where(eq(schema.trips.tenantId, t)).all(),
      db.select().from(schema.products).where(eq(schema.products.tenantId, t)).all(),
      db.select().from(schema.orders).where(eq(schema.orders.tenantId, t)).all(),
      db.select().from(schema.orderItems).where(eq(schema.orderItems.tenantId, t)).all(),
      db.select().from(schema.invoices).where(eq(schema.invoices.tenantId, t)).all(),
      db.select().from(schema.payments).where(eq(schema.payments.tenantId, t)).all(),
      db.select().from(schema.ledgerEntries).where(eq(schema.ledgerEntries.tenantId, t)).all(),
      db.select().from(schema.shipments).where(eq(schema.shipments.tenantId, t)).all(),
      db.select().from(schema.parcels).where(eq(schema.parcels.tenantId, t)).all(),
      db.select().from(schema.deliveries).where(eq(schema.deliveries.tenantId, t)).all(),
    ]);
    const files = Object.entries({ customers, addresses, trips, products, orders, order_items: items, invoices, payments, ledger, shipments, parcels, deliveries })
      .filter(([, rows]) => rows.length)
      .map(([name, rows]) => ({ name: `${name}.csv`, data: toCsv(rows as Array<Record<string, unknown>>) }));
    await auditInsert(db, { tenantId: t, actorId: c.var.user.id, action: "tenant.export", entityType: "tenant", entityId: t });
    const stamp = new Date().toISOString().slice(0, 10);
    return c.body(zip(files.length ? files : [{ name: "kosong.txt", data: "Belum ada data." }]), 200, {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="bawaan-${c.var.tenant.slug}-${stamp}.zip"`,
    });
  });

  r.get("/:tenantId/domain", async (c) => c.json({ enabled: domainsEnabled(c.env), allowed: PLAN_LIMITS[await planOf(c.var.db, c.var.tenant.id)].customDomain, domain: await domainStatus(c.env, c.var.db, c.var.tenant.id) }));

  r.put("/:tenantId/domain", requireRole("owner"), async (c) => {
    const { hostname } = await body(c, z.object({ hostname: z.string().max(253) }));
    if (!PLAN_LIMITS[await planOf(c.var.db, c.var.tenant.id)].customDomain) throw new HttpError(402, "plan_limit", "Custom domain tersedia di paket Pro");
    await removeDomain(c.env, c.var.db, c.var.tenant.id);
    return c.json(await addDomain(c.env, c.var.db, c.var.tenant, hostname));
  });

  r.delete("/:tenantId/domain", requireRole("owner"), async (c) => {
    await removeDomain(c.env, c.var.db, c.var.tenant.id);
    return c.json({ ok: true });
  });

  r.get("/:tenantId/integrations", requireRole("owner", "admin"), async (c) => {
    const i = await loadIntegrations(c.env, c.var.db, c.var.tenant.id);
    return c.json({ ...describeIntegrations(i), webhookUrl: new URL(`/api/webhooks/xendit/${c.var.tenant.id}`, c.req.url).toString() });
  });

  r.put("/:tenantId/integrations", requireRole("owner"), async (c) => {
    const input = await body(c, integrationsSchema);
    const next = await saveIntegrations(c.env, c.var.db, c.var.tenant.id, input);
    await auditInsert(c.var.db, { tenantId: c.var.tenant.id, actorId: c.var.user.id, action: "integrations.update", entityType: "tenant", entityId: c.var.tenant.id, data: Object.keys(input) });
    return c.json(describeIntegrations(next));
  });

  r.post("/:tenantId/items/:id/ready-stock", requirePerm("money"), async (c) => {
    const input = await body(c, z.object({ price: z.number().int().min(0).optional() }));
    return c.json(await relistAsReadyStock(c.var.db, c.var.tenant.id, c.req.param("id"), input, c.var.user.id), 201);
  });

  r.post("/:tenantId/ready-stock", async (c) => {
    return c.json(await ensureReadyTrip(c.var.db, c.var.tenant.id));
  });

  r.get("/:tenantId/products/:id/waitlist", async (c) => {
    const rows = await c.var.db
      .select()
      .from(schema.waitlist)
      .where(and(eq(schema.waitlist.tenantId, c.var.tenant.id), eq(schema.waitlist.productId, c.req.param("id"))))
      .orderBy(asc(schema.waitlist.createdAt))
      .all();
    return c.json(rows);
  });

  r.post("/:tenantId/deliveries/rates", async (c) => {
    const { customerId, weightG, value } = await body(c, z.object({ customerId: z.string(), weightG: z.number().int().min(1).max(100_000), value: z.number().int().min(0).default(0) }));
    if (!courierEnabled(c.env)) throw new HttpError(503, "unavailable", "Cek ongkir belum tersedia");
    const db = c.var.db;
    const policy = parsePolicy((await db.select({ p: schema.tenants.policyJson }).from(schema.tenants).where(eq(schema.tenants.id, c.var.tenant.id)).get())?.p);
    if (!policy.originPostalCode) throw conflict("Isi kode pos asal pengiriman di Pengaturan dulu");
    const addr = await db
      .select()
      .from(schema.addresses)
      .where(and(eq(schema.addresses.tenantId, c.var.tenant.id), eq(schema.addresses.customerId, customerId)))
      .all();
    const dest = (addr.find((a) => a.isDefault) ?? addr[0])?.postalCode;
    if (!dest) throw conflict("Alamat pelanggan belum ada kode posnya");
    return c.json({ origin: policy.originPostalCode, destination: dest, rates: await courierRates(c.env, { origin: policy.originPostalCode, destination: dest, weightG, value }) });
  });

  r.get("/:tenantId/capabilities", async (c) => {
    const plan = await planOf(c.var.db, c.var.tenant.id);
    const i = await loadIntegrations(c.env, c.var.db, c.var.tenant.id);
    return c.json({ plan, courier: courierEnabled(c.env), domains: domainsEnabled(c.env), qris: !!i.xendit, waCloud: !!i.waCloud, available: integrationFeatures(c.env) });
  });
}
