import { effectivePlan } from "@bawaan/shared";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { createMiddleware } from "hono/factory";
import { z } from "zod";
import { createRouter, type AppEnv } from "../app";
import { requireUser } from "../auth/session";
import { schema } from "../db";
import { HttpError, body, notFound } from "../lib/http";
import { auditInsert } from "../services/events";
import { isPlatformAdmin, markPlatformInvoicePaid } from "./billing";

const requireAdmin = createMiddleware<AppEnv>(async (c, next) => {
  if (!isPlatformAdmin(c.env, c.var.user.email)) throw new HttpError(404, "not_found", "Tidak ditemukan");
  await next();
});

/** Abuse handling, plans and support for the Bawaan team, on the app host. */
export const adminRoutes = createRouter();
adminRoutes.use(requireUser, requireAdmin);

adminRoutes.get("/overview", async (c) => {
  const db = c.var.db;
  const q = c.req.query("q")?.trim().toLowerCase();
  const [tenants, reports, pending] = await Promise.all([
    db
      .select({
        id: schema.tenants.id,
        slug: schema.tenants.slug,
        name: schema.tenants.name,
        plan: schema.tenants.plan,
        planUntil: schema.tenants.planUntil,
        status: schema.tenants.status,
        statusReason: schema.tenants.statusReason,
        createdAt: schema.tenants.createdAt,
        orders: sql<number>`(select count(*) from orders o where o.tenant_id = "tenants"."id")`,
        owner: sql<string>`(select u.email from memberships m join users u on u.id = m.user_id where m.tenant_id = "tenants"."id" and m.role = 'owner' limit 1)`,
      })
      .from(schema.tenants)
      .where(q ? sql`lower(${schema.tenants.slug}) like ${`%${q}%`} or lower(${schema.tenants.name}) like ${`%${q}%`}` : undefined)
      .orderBy(desc(schema.tenants.createdAt))
      .limit(200)
      .all(),
    db
      .select({ report: schema.abuseReports, slug: schema.tenants.slug, name: schema.tenants.name })
      .from(schema.abuseReports)
      .innerJoin(schema.tenants, eq(schema.tenants.id, schema.abuseReports.tenantId))
      .where(isNull(schema.abuseReports.resolvedAt))
      .orderBy(desc(schema.abuseReports.createdAt))
      .limit(100)
      .all(),
    db
      .select({ invoice: schema.platformInvoices, slug: schema.tenants.slug, name: schema.tenants.name })
      .from(schema.platformInvoices)
      .innerJoin(schema.tenants, eq(schema.tenants.id, schema.platformInvoices.tenantId))
      .where(eq(schema.platformInvoices.status, "pending_review"))
      .orderBy(desc(schema.platformInvoices.createdAt))
      .all(),
  ]);
  return c.json({
    tenants: tenants.map((t) => ({ ...t, effectivePlan: effectivePlan(t.plan, t.planUntil) })),
    reports: reports.map((r) => ({ ...r.report, slug: r.slug, name: r.name })),
    pendingPayments: pending.map((p) => ({ ...p.invoice, slug: p.slug, name: p.name })),
  });
});

adminRoutes.patch("/tenants/:id", async (c) => {
  const input = await body(
    c,
    z.object({
      status: z.enum(["active", "readonly", "suspended"]).optional(),
      reason: z.string().max(300).nullable().optional(),
      plan: z.enum(["free", "pro"]).optional(),
      planUntil: z.number().int().nullable().optional(),
    }),
  );
  const db = c.var.db;
  const t = await db.select({ id: schema.tenants.id, status: schema.tenants.status }).from(schema.tenants).where(eq(schema.tenants.id, c.req.param("id"))).get();
  if (!t) throw notFound("Toko");
  if (t.status === "deleted") throw new HttpError(409, "conflict", "Toko ini sudah dihapus");
  await db.batch([
    db
      .update(schema.tenants)
      .set({
        ...(input.status ? { status: input.status, statusReason: input.reason ?? null } : {}),
        ...(input.plan ? { plan: input.plan } : {}),
        ...(input.planUntil !== undefined ? { planUntil: input.planUntil } : {}),
      })
      .where(eq(schema.tenants.id, t.id)),
    auditInsert(db, { tenantId: t.id, actorId: c.var.user.id, action: "platform.tenant_update", entityType: "tenant", entityId: t.id, data: input }),
  ]);
  return c.json({ ok: true });
});

adminRoutes.post("/platform-invoices/:id/approve", async (c) => c.json(await markPlatformInvoicePaid(c.var.db, c.req.param("id"), c.var.user.id)));

adminRoutes.post("/platform-invoices/:id/reject", async (c) => {
  await c.var.db
    .update(schema.platformInvoices)
    .set({ status: "open", proofKey: null })
    .where(and(eq(schema.platformInvoices.id, c.req.param("id")), eq(schema.platformInvoices.status, "pending_review")));
  return c.json({ ok: true });
});

adminRoutes.post("/reports/:id/resolve", async (c) => {
  await c.var.db.update(schema.abuseReports).set({ resolvedAt: Date.now() }).where(eq(schema.abuseReports.id, c.req.param("id")));
  return c.json({ ok: true });
});

adminRoutes.get("/files/*", async (c) => {
  const key = c.req.path.split("/files/")[1] ?? "";
  if (!/^t\/[^/]+\/billing\//.test(key)) throw notFound("File");
  const obj = await c.env.PRIVATE_BUCKET.get(key);
  if (!obj) throw notFound("File");
  return new Response(obj.body, { headers: { "Content-Type": obj.httpMetadata?.contentType ?? "application/octet-stream", "Cache-Control": "private, max-age=600" } });
});
