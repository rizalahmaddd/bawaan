import { PRO_PRICE_IDR, formatRupiah, normalizePhone } from "@bawaan/shared";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { createRouter } from "../app";
import { requireRole } from "../auth/session";
import { schema, type DB } from "../db";
import { feature } from "../lib/features";
import { HttpError, body, conflict, notFound } from "../lib/http";
import { domainsEnabled } from "../services/domains";
import { newId } from "../lib/ids";
import { origins } from "../lib/origins";
import { safeEqual } from "../lib/ratelimit";
import { emailEnabled, emailHtml, sendEmail } from "../services/channels";
import { auditInsert } from "../services/events";
import { planStatus } from "../services/plan";

const DAY = 86_400_000;
const MONTH = 30 * DAY;
export const PLAN_MONTHS = [1, 3, 12] as const;
/** Two months free on the yearly plan. */
export const priceFor = (months: number) => (months === 12 ? PRO_PRICE_IDR * 10 : PRO_PRICE_IDR * months);

const platformGateway = (env: Env) => feature(env, "platform_gateway") && !!env.PLATFORM_XENDIT_KEY;

export const platformAdmins = (env: Env) => (env.PLATFORM_ADMINS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
export const isPlatformAdmin = (env: Env, email: string) => platformAdmins(env).includes(email.toLowerCase());

/** Paid time stacks on top of whatever Pro time is left. */
export async function markPlatformInvoicePaid(db: DB, invoiceId: string, actorId: string | null) {
  const inv = await db.select().from(schema.platformInvoices).where(eq(schema.platformInvoices.id, invoiceId)).get();
  if (!inv) throw notFound("Tagihan");
  if (inv.status === "paid") return inv;
  if (inv.status === "void") throw conflict("Tagihan ini sudah dibatalkan");
  const tenant = (await db.select({ until: schema.tenants.planUntil, plan: schema.tenants.plan }).from(schema.tenants).where(eq(schema.tenants.id, inv.tenantId)).get())!;
  const from = tenant.plan === "pro" && tenant.until && tenant.until > Date.now() ? tenant.until : Date.now();
  await db.batch([
    db.update(schema.platformInvoices).set({ status: "paid", paidAt: Date.now() }).where(eq(schema.platformInvoices.id, inv.id)),
    db.update(schema.tenants).set({ plan: "pro", planUntil: from + inv.months * MONTH }).where(eq(schema.tenants.id, inv.tenantId)),
    auditInsert(db, { tenantId: inv.tenantId, actorId, action: "plan.paid", entityType: "platform_invoice", entityId: inv.id, data: { months: inv.months, amount: inv.amount } }),
  ]);
  return { ...inv, status: "paid" as const };
}

export function registerBillingRoutes(r: ReturnType<typeof createRouter>) {
  r.get("/:tenantId/billing", async (c) => {
    const db = c.var.db;
    const [status, tenant, invoices] = await Promise.all([
      planStatus(db, c.var.tenant.id),
      db.select({ planUntil: schema.tenants.planUntil }).from(schema.tenants).where(eq(schema.tenants.id, c.var.tenant.id)).get(),
      db.select().from(schema.platformInvoices).where(eq(schema.platformInvoices.tenantId, c.var.tenant.id)).orderBy(desc(schema.platformInvoices.createdAt)).limit(12).all(),
    ]);
    return c.json({
      ...status,
      planUntil: tenant?.planUntil ?? null,
      invoices,
      options: PLAN_MONTHS.map((m) => ({ months: m, amount: priceFor(m) })),
      gateway: platformGateway(c.env),
      customDomain: domainsEnabled(c.env),
      supportWa: normalizePhone(c.env.SUPPORT_WA ?? "") ?? normalizePhone("085777775477"),
      qris: c.env.PLATFORM_QRIS || null,
      manualTransfer: c.env.PLATFORM_QRIS
        ? "Scan QRIS pakai m-banking atau e-wallet apa pun, nominalnya sudah terisi. Lalu unggah bukti bayarnya. Paket aktif setelah dicek (maks. 1×24 jam)."
        : "Transfer ke rekening Bawaan yang tertera di tagihan, lalu unggah buktinya. Paket aktif setelah dicek (maks. 1×24 jam).",
    });
  });

  r.post("/:tenantId/billing/checkout", requireRole("owner"), async (c) => {
    const { months } = await body(c, z.object({ months: z.union([z.literal(1), z.literal(3), z.literal(12)]) }));
    const db = c.var.db;
    const id = newId("pin");
    const amount = priceFor(months);
    let gatewayUrl: string | null = null;
    if (platformGateway(c.env)) {
      const res = await fetch("https://api.xendit.co/v2/invoices", {
        method: "POST",
        headers: { Authorization: `Basic ${btoa(`${c.env.PLATFORM_XENDIT_KEY}:`)}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          external_id: id,
          amount,
          description: `Bawaan Pro ${months} bulan · ${c.var.tenant.name}`,
          payer_email: c.var.user.email,
          success_redirect_url: origins(c.env, c.req.url).app("/paket?bayar=ok"),
          currency: "IDR",
        }),
      });
      if (!res.ok) throw new HttpError(502, "gateway", "Pembayaran online sedang bermasalah. Coba lagi atau pakai transfer manual.");
      gatewayUrl = (await res.json<{ invoice_url: string }>()).invoice_url;
    }
    await db.insert(schema.platformInvoices).values({ id, tenantId: c.var.tenant.id, months, amount, gatewayUrl, createdBy: c.var.user.id });
    return c.json({ id, amount, gatewayUrl }, 201);
  });

  r.post("/:tenantId/billing/:id/proof", requireRole("owner"), async (c) => {
    const { proofKey } = await body(c, z.object({ proofKey: z.string().startsWith(`t/${c.var.tenant.id}/billing/`) }));
    const db = c.var.db;
    const done = await db
      .update(schema.platformInvoices)
      .set({ proofKey, status: "pending_review" })
      .where(and(eq(schema.platformInvoices.id, c.req.param("id")), eq(schema.platformInvoices.tenantId, c.var.tenant.id), eq(schema.platformInvoices.status, "open")))
      .returning()
      .get();
    if (!done) throw conflict("Tagihan ini tidak sedang menunggu pembayaran");
    if (emailEnabled(c.env)) {
      const text = `${c.var.tenant.name} (${c.var.tenant.slug}) mengirim bukti bayar Pro ${done.months} bulan, ${formatRupiah(done.amount)}.`;
      const link = origins(c.env, c.req.url).app("/admin");
      for (const to of platformAdmins(c.env)) c.executionCtx.waitUntil(sendEmail(c.env, { to, subject: "Bukti bayar Pro baru", text: `${text}\n${link}`, html: emailHtml("Platform", text, link, "Buka admin") }));
    }
    return c.json({ ok: true });
  });
}

export function registerPlatformWebhooks(r: ReturnType<typeof createRouter>) {
  r.post("/xendit", async (c) => {
    const token = c.req.header("x-callback-token") ?? "";
    if (!feature(c.env, "platform_gateway") || !c.env.PLATFORM_XENDIT_CALLBACK_TOKEN || !safeEqual(token, c.env.PLATFORM_XENDIT_CALLBACK_TOKEN)) throw new HttpError(401, "unauthorized", "Bad token");
    const evt = await c.req.json<{ external_id?: string; status?: string; amount?: number }>();
    if (evt.status !== "PAID" && evt.status !== "SETTLED") return c.json({ ok: true });
    const inv = evt.external_id ? await c.var.db.select().from(schema.platformInvoices).where(eq(schema.platformInvoices.id, evt.external_id)).get() : null;
    if (!inv) return c.json({ ok: true });
    if (evt.amount !== undefined && evt.amount < inv.amount) throw new HttpError(400, "amount", "Amount mismatch");
    await markPlatformInvoicePaid(c.var.db, inv.id, null);
    return c.json({ ok: true });
  });
}
