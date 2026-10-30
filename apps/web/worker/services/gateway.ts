import { formatRupiah } from "@bawaan/shared";
import { and, eq, gt } from "drizzle-orm";
import type { createRouter } from "../app";
import { schema, type DB } from "../db";
import { HttpError, conflict } from "../lib/http";
import { newId } from "../lib/ids";
import { safeEqual } from "../lib/ratelimit";
import { loadIntegrations } from "./integrations";
import { remaining } from "./invoices";
import { notify } from "./notify";
import { payable, recordGatewayPayment } from "./payments";

const QR_TTL = 30 * 60_000;

/**
 * A dynamic QRIS for exactly what's left on the invoice. The money lands in the seller's own
 * Xendit account and the webhook marks the invoice paid, so there's no screenshot to check.
 */
export async function createQris(env: Env, db: DB, tenantId: string, customerId: string, invoiceId: string) {
  const cfg = (await loadIntegrations(env, db, tenantId)).xendit;
  if (!cfg) throw conflict("Toko ini belum memakai pembayaran otomatis");
  const inv = await payable(db, tenantId, invoiceId);
  if (inv.customerId !== customerId || !["open", "partially_paid"].includes(inv.status)) throw conflict("Tagihan ini tidak sedang menunggu pembayaran");
  // QRIS charges the exact amount, so the unique code isn't needed for matching; it's still owed as part of the total.
  const amount = remaining(inv);
  const reuse = await db
    .select()
    .from(schema.gatewayCharges)
    .where(and(eq(schema.gatewayCharges.invoiceId, inv.id), eq(schema.gatewayCharges.status, "pending"), eq(schema.gatewayCharges.amount, amount), gt(schema.gatewayCharges.expiresAt, Date.now() + 60_000)))
    .get();
  if (reuse) return { invoiceId: inv.id, amount, expiresAt: reuse.expiresAt, qrString: (JSON.parse(reuse.payload) as { qr_string: string }).qr_string };

  const id = newId("chg");
  const expiresAt = Date.now() + QR_TTL;
  const res = await fetch("https://api.xendit.co/qr_codes", {
    method: "POST",
    headers: { Authorization: `Basic ${btoa(`${cfg.secretKey}:`)}`, "Content-Type": "application/json", "api-version": "2022-07-31" },
    body: JSON.stringify({ reference_id: id, type: "DYNAMIC", currency: "IDR", amount, expires_at: new Date(expiresAt).toISOString() }),
  });
  if (!res.ok) {
    console.error("xendit qr failed", res.status, await res.text().catch(() => ""));
    throw new HttpError(502, "gateway", "QRIS belum bisa dibuat. Coba lagi atau transfer manual.");
  }
  const qr = await res.json<{ id: string; qr_string: string }>();
  await db.insert(schema.gatewayCharges).values({ id, tenantId, invoiceId: inv.id, provider: "xendit", externalId: qr.id, amount, payload: JSON.stringify({ qr_string: qr.qr_string }), expiresAt });
  return { invoiceId: inv.id, amount, expiresAt, qrString: qr.qr_string };
}

type XenditQrEvent = { event?: string; data?: { id?: string; reference_id?: string; amount?: number; status?: string } };

export function registerGatewayWebhooks(r: ReturnType<typeof createRouter>) {
  r.post("/xendit/:tenantId", async (c) => {
    const db = c.var.db;
    const tenantId = c.req.param("tenantId");
    const cfg = (await loadIntegrations(c.env, db, tenantId)).xendit;
    if (!cfg || !safeEqual(c.req.header("x-callback-token") ?? "", cfg.callbackToken)) throw new HttpError(401, "unauthorized", "Bad token");
    const evt = await c.req.json<XenditQrEvent>();
    const d = evt.data;
    if (evt.event !== "qr.payment" || d?.status !== "SUCCEEDED" || !d.reference_id || !d.id || !d.amount) return c.json({ ok: true });
    const charge = await db.select().from(schema.gatewayCharges).where(and(eq(schema.gatewayCharges.id, d.reference_id), eq(schema.gatewayCharges.tenantId, tenantId))).get();
    if (!charge) return c.json({ ok: true });
    const res = await recordGatewayPayment(db, { tenantId, invoiceId: charge.invoiceId, amount: d.amount, method: "qris", gatewayRef: `xendit:${d.id}` });
    await db.update(schema.gatewayCharges).set({ status: "paid" }).where(eq(schema.gatewayCharges.id, charge.id));
    if (res) {
      const order = res.invoice.orderId ? await db.select({ code: schema.orders.code }).from(schema.orders).where(eq(schema.orders.id, res.invoice.orderId)).get() : null;
      const tenant = (await db.select({ name: schema.tenants.name }).from(schema.tenants).where(eq(schema.tenants.id, tenantId)).get())!;
      c.executionCtx.waitUntil(
        Promise.all([
          notify(c.env, db, [{ audience: "customer", targetId: res.invoice.customerId }], { title: tenant.name, body: `Pembayaran QRIS ${formatRupiah(d.amount)} diterima. Terima kasih!`, url: order ? `/o/${order.code}` : "/akun" }),
          notify(c.env, db, [{ audience: "seller", targetId: tenantId }], { title: "QRIS masuk", body: `${formatRupiah(d.amount)} untuk ${res.invoice.number}${order ? ` (${order.code})` : ""}, otomatis tercatat.`, url: "/pembayaran" }),
        ]),
      );
    }
    return c.json({ ok: true });
  });
}
