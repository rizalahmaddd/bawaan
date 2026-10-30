import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runCron } from "../cron";
import { appleEnabled } from "../auth/routes";
import { emailEnabled, sendEmail } from "../services/channels";
import { courierCode, courierEnabled } from "../services/courier";
import { domainsEnabled, normalizeHostname } from "../services/domains";
import { integrationFeatures } from "../services/integrations";
import { APP, call, fakeJpeg, login, makePro, openTrip, seller, store } from "./helpers";

type Api = Awaited<ReturnType<typeof seller>>["api"];
const DAY = 86_400_000;

async function order(slug: string, tripId: string, productId: string, phone: string, key: string, qty = 1) {
  return call(`${store(slug)}/api/store/checkout`, { body: { tripId, customer: { name: "Pelanggan", phone }, items: [{ productId, qty }], idempotencyKey: `p3-${key}` } });
}
const orderId = async (api: Api, code: string) => (await api(`/orders?q=${code}`)).json[0].id as string;

afterEach(() => vi.restoreAllMocks());

describe("plans and billing", () => {
  it("holds free stores to their limits without touching existing data", async () => {
    const s = await seller("free@example.com", "toko-gratis");
    const t1 = await openTrip(s.api);
    const t2 = (await s.api("/trips", { body: { title: "Trip kedua", country: "Korea", currency: "KRW", kursMicro: 12_000_000, dpPercent: 50, closesAt: Date.now() + DAY } })).json.id;
    const open2 = await s.api(`/trips/${t2}`, { method: "PATCH", body: { status: "open" } });
    expect(open2.status).toBe(402);
    expect((await s.api("/team/invites", { body: { email: "staf@example.com", role: "staff" } })).status).toBe(402);

    const p = await s.api(`/trips/${t1}/products`, { body: { title: "Barang murah", priceMinor: 100 } });
    expect((await order("toko-gratis", t1, p.json.id, "081400000001", "lim-1", 99)).status).toBe(201);
    expect((await order("toko-gratis", t1, p.json.id, "081400000002", "lim-2", 2)).status).toBe(402);
    expect((await s.api("/billing")).json).toMatchObject({ plan: "free", used: { itemsThisMonth: 99, activeTrips: 1 }, warn: true });
  });

  it("upgrades to Pro by manual transfer reviewed by the platform admin", async () => {
    const s = await seller("pro@example.com", "toko-pro");
    const inv = await s.api("/billing/checkout", { body: { months: 3 } });
    expect(inv.json).toMatchObject({ amount: 147_000, gatewayUrl: null });
    const form = new FormData();
    form.set("kind", "billing");
    form.set("file", fakeJpeg(9));
    const up = await s.api("/uploads", { form });
    expect((await s.api(`/billing/${inv.json.id}/proof`, { body: { proofKey: up.json.key } })).status).toBe(200);

    expect((await call(`${APP}/api/admin/overview`, { cookie: s.cookie })).status).toBe(404);
    const admin = await login("admin@example.com");
    const overview = await call(`${APP}/api/admin/overview`, { cookie: admin });
    expect(overview.json.pendingPayments.map((p: any) => p.id)).toContain(inv.json.id);
    expect((await call(`${APP}/api/admin/files/${up.json.key}`, { cookie: admin })).status).toBe(200);
    await call(`${APP}/api/admin/platform-invoices/${inv.json.id}/approve`, { method: "POST", cookie: admin });
    const billing = (await s.api("/billing")).json;
    expect(billing.plan).toBe("pro");
    expect(billing.planUntil).toBeGreaterThan(Date.now() + 89 * DAY);
  });

  it("accepts the platform payment webhook only with the right token", async () => {
    const s = await seller("pro2@example.com", "toko-pro-dua");
    const inv = await s.api("/billing/checkout", { body: { months: 1 } });
    const hook = (token: string) => call(`${APP}/api/webhooks/xendit`, { body: { external_id: inv.json.id, status: "PAID", amount: 49_000 }, headers: { "x-callback-token": token } });
    expect((await hook("salah")).status).toBe(401);
    expect((await hook("platform-callback-token")).status).toBe(200);
    expect((await hook("platform-callback-token")).status).toBe(200);
    expect((await s.api("/billing")).json.plan).toBe("pro");
  });
});

describe("payment gateway", () => {
  it("creates a QRIS charge and settles the invoice from the webhook, once", async () => {
    const s = await seller("qris@example.com", "toko-otomatis");
    const tripId = await openTrip(s.api);
    const p = await s.api(`/trips/${tripId}/products`, { body: { title: "Matcha", priceMinor: 1000 } });
    const co = await order("toko-otomatis", tripId, p.json.id, "081400000003", "qris-1");
    const id = await orderId(s.api, co.json.code);
    const dp = (await s.api(`/orders/${id}/confirm`, { method: "POST" })).json.invoice;

    await s.api("/integrations", { method: "PUT", body: { xendit: { secretKey: "xnd_development_secret_1234", callbackToken: "tenant-callback-token" } } });
    const integ = await s.api("/integrations");
    expect(integ.json.xendit).toEqual({ connected: true, keyHint: "…1234" });
    expect(integ.text).not.toContain("xnd_development_secret_1234");

    const real = globalThis.fetch;
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url === "https://api.xendit.co/qr_codes") {
        expect((init?.headers as Record<string, string>).Authorization).toBe(`Basic ${btoa("xnd_development_secret_1234:")}`);
        return Response.json({ id: "qr_123", qr_string: "00020101021226..." });
      }
      return real(input, init);
    });
    const headers = { "x-order-token": co.json.token };
    const qr = await call(`${store("toko-otomatis")}/api/store/orders/${co.json.code}/invoices/${dp.id}/qris`, { method: "POST", headers });
    expect(qr.json).toMatchObject({ qrString: "00020101021226...", amount: dp.amount + dp.uniqueCode });
    const again = await call(`${store("toko-otomatis")}/api/store/orders/${co.json.code}/invoices/${dp.id}/qris`, { method: "POST", headers });
    expect(again.json.qrString).toBe(qr.json.qrString);
    expect(spy.mock.calls.filter(([u]) => String(u).includes("xendit")).length).toBe(1);
    spy.mockRestore();

    const charge = await env.DB.prepare("select id from gateway_charges where invoice_id = ?").bind(dp.id).first<{ id: string }>();
    const event = { event: "qr.payment", data: { id: "qrpy_1", reference_id: charge!.id, amount: qr.json.amount, status: "SUCCEEDED" } };
    const hook = (token: string) => call(`${APP}/api/webhooks/xendit/${s.tenantId}`, { body: event, headers: { "x-callback-token": token } });
    expect((await hook("tenant-callback-tokeX")).status).toBe(401);
    expect((await hook("tenant-callback-token")).status).toBe(200);
    expect((await hook("tenant-callback-token")).status).toBe(200);
    const detail = await s.api(`/orders/${id}`);
    expect(detail.json.invoices[0].status).toBe("paid");
    expect(detail.json.items[0].status).toBe("hunting");
    expect(detail.json.payments.filter((p: any) => p.method === "qris")).toHaveLength(1);
    expect((await call(`${store("toko-otomatis")}/api/store/orders/${co.json.code}/invoices/${dp.id}/status`, { headers })).json.status).toBe("paid");
  });
});

describe("ready stock, waitlist and market", () => {
  it("relists forfeited goods as ready stock that skips the hunt once paid", async () => {
    const s = await seller("ready@example.com", "toko-ready");
    const tripId = await openTrip(s.api);
    const p = await s.api(`/trips/${tripId}/products`, { body: { title: "Parfum", priceMinor: 5000 } });
    const co = await order("toko-ready", tripId, p.json.id, "081400000004", "ready-1");
    const id = await orderId(s.api, co.json.code);
    const dp = (await s.api(`/orders/${id}/confirm`, { method: "POST" })).json.invoice;
    await s.api(`/invoices/${dp.id}/payments`, { body: { amount: dp.amount + dp.uniqueCode, method: "cash" } });
    const item = (await s.api(`/orders/${id}`)).json.items[0];
    await s.api(`/items/${item.id}/decide`, { body: { result: "obtained" } });
    await runCron(env, Date.now() + 10 * DAY);
    expect((await s.api(`/orders/${id}`)).json.items[0].status).toBe("forfeited");

    const relist = await s.api(`/items/${item.id}/ready-stock`, { body: { price: 600_000 } });
    expect(relist.status).toBe(201);
    expect((await s.api(`/items/${item.id}/ready-stock`, { body: {} })).status).toBe(409);

    const catalog = await call(`${store("toko-ready")}/api/store`);
    const shelf = catalog.json.trips.find((t: any) => t.kind === "ready");
    expect(shelf.products[0]).toMatchObject({ title: "Parfum", priceMinor: 600_000, left: 1 });

    const market = await call("https://bawaan.my.id/api/market");
    expect(market.json.items.map((i: any) => i.title)).toContain("Parfum");

    const buy = await order("toko-ready", relist.json.tripId, relist.json.productId, "081400000005", "ready-2");
    const buyId = await orderId(s.api, buy.json.code);
    const full = (await s.api(`/orders/${buyId}/confirm`, { method: "POST" })).json.invoice;
    expect(full).toMatchObject({ type: "full", amount: 600_000 });
    await s.api(`/invoices/${full.id}/payments`, { body: { amount: full.amount + full.uniqueCode, method: "transfer" } });
    expect((await s.api(`/orders/${buyId}`)).json.items[0].status).toBe("obtained");
  });

  it("tells the seller when a full product frees up for people on the waitlist", async () => {
    const s = await seller("wait@example.com", "toko-wait");
    const tripId = await openTrip(s.api);
    const p = await s.api(`/trips/${tripId}/products`, { body: { title: "Edisi terbatas", priceMinor: 1000, quota: 1 } });
    const co = await order("toko-wait", tripId, p.json.id, "081400000006", "wait-1");
    expect((await call(`${store("toko-wait")}/api/store/waitlist`, { body: { productId: p.json.id, name: "Rani", phone: "081400000007" } })).status).toBe(201);
    expect((await s.api(`/products/${p.json.id}/waitlist`)).json).toHaveLength(1);
    const id = await orderId(s.api, co.json.code);
    await s.api(`/orders/${id}/reject`, { body: { reason: "Stok habis duluan" } });
    // The alert runs in waitUntil after the response.
    await vi.waitFor(async () => {
      const note = await env.DB.prepare("select body from notifications where audience = 'seller' and target_id = ? and title = 'Slot PO kosong lagi'").bind(s.tenantId).first<{ body: string }>();
      expect(note?.body).toContain("Edisi terbatas: 1 orang menunggu");
    });
  });
});

describe("store lifecycle", () => {
  it("renames with a redirect, pauses, exports, and deletes after the grace period", async () => {
    const s = await seller("life@example.com", "toko-lama");
    const tripId = await openTrip(s.api);
    const p = await s.api(`/trips/${tripId}/products`, { body: { title: "Snack", priceMinor: 100 } });
    const co = await order("toko-lama", tripId, p.json.id, "081400000008", "life-1");

    expect((await s.api("/settings/slug", { body: { slug: "toko-baru-ku" } })).json.slug).toBe("toko-baru-ku");
    expect((await s.api("/settings/slug", { body: { slug: "toko-lagi" } })).status).toBe(409);
    const old = await call(`${store("toko-lama")}/api/store`);
    expect(old.json.details).toEqual({ movedTo: "toko-baru-ku" });
    const page = await call(`${store("toko-lama")}/o/${co.json.code}`);
    expect(page.status).toBe(301);
    expect(page.headers.get("location")).toContain("toko-baru-ku");
    const check = await call(`${APP}/api/tenants/slug-check?slug=toko-lama`, { cookie: s.cookie });
    expect(check.json.ok).toBe(false);

    await s.api("/settings/pause", { body: { paused: true } });
    const blocked = await call(`${store("toko-baru-ku")}/api/store/checkout`, { body: { tripId, customer: { name: "Baru", phone: "081400000009" }, items: [{ productId: p.json.id, qty: 1 }], idempotencyKey: "p3-life-2" } });
    expect(blocked.status).toBe(409);
    expect((await call(`${store("toko-baru-ku")}/api/store/orders/${co.json.code}`, { headers: { "x-order-token": co.json.token } })).status).toBe(200);
    await s.api("/settings/pause", { body: { paused: false } });

    const zip = await s.api("/export.zip");
    expect(zip.headers.get("content-type")).toBe("application/zip");
    expect(zip.text.startsWith("PK")).toBe(true);
    expect(zip.text).toContain("orders.csv");

    expect((await s.api("/settings/delete", { body: { confirmSlug: "salah" } })).status).toBe(422);
    await s.api("/settings/delete", { body: { confirmSlug: "toko-baru-ku" } });
    expect((await call(`${store("toko-baru-ku")}/api/store/checkout`, { body: { tripId, customer: { name: "Baru", phone: "081400000009" }, items: [{ productId: p.json.id, qty: 1 }], idempotencyKey: "p3-life-3" } })).status).toBe(409);
    await runCron(env, Date.now() + 8 * DAY);
    expect((await call(`${store("toko-baru-ku")}/api/store`)).status).toBe(404);
    expect((await call(`${APP}/api/tenants/slug-check?slug=toko-baru-ku`, { cookie: s.cookie })).json.ok).toBe(false);
    expect((await call(`${APP}/api/auth/me`, { cookie: s.cookie })).json.tenants).toEqual([]);
    await runCron(env, Date.now() + 31 * DAY);
    const cust = await env.DB.prepare("select name, phone_e164 as phone from customers where tenant_id = ?").bind(s.tenantId).first<{ name: string; phone: string }>();
    expect(cust).toMatchObject({ name: "Dihapus" });
    expect(cust!.phone.startsWith("deleted:")).toBe(true);
  });

  it("takes abuse reports into the admin queue", async () => {
    const s = await seller("abuse@example.com", "toko-aneh");
    expect((await call(`${store("toko-aneh")}/api/store/report`, { body: { reason: "Pakai logo bank untuk minta transfer" } })).status).toBe(201);
    const admin = await login("admin@example.com");
    const ov = await call(`${APP}/api/admin/overview`, { cookie: admin });
    const rep = ov.json.reports.find((r: any) => r.slug === "toko-aneh");
    expect(rep).toBeTruthy();
    await call(`${APP}/api/admin/tenants/${s.tenantId}`, { method: "PATCH", cookie: admin, body: { status: "suspended", reason: "Phishing" } });
    expect((await call(`${store("toko-aneh")}/api/store`)).status).toBe(404);
    expect((await s.api("/settings/pause", { body: { paused: false } })).status).toBe(409);
  });
});

describe("integration helpers", () => {
  it("maps free-text courier names to API codes", () => {
    expect(["JNE REG", "J&T", "SiCepat", "Pos Indonesia", "Kurir lokal"].map(courierCode)).toEqual(["jne", "jnt", "sicepat", "pos", null]);
  });

  it("validates custom domains", () => {
    const e = { ROOT_DOMAIN: "bawaan.my.id" } as Env;
    expect(normalizeHostname(e, "https://Toko.JastipKu.com/")).toBe("toko.jastipku.com");
    expect(() => normalizeHostname(e, "ayu.bawaan.my.id")).toThrow();
    expect(() => normalizeHostname(e, "bukan domain")).toThrow();
  });

  it("sends email through Resend only when configured", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ id: "em_1" }));
    expect(await sendEmail({ FEATURES: "email" } as unknown as Env, { to: "a@b.c", subject: "x", text: "x", html: "x" })).toBe(false);
    expect(await sendEmail({ FEATURES: "email", RESEND_API_KEY: "re_1", EMAIL_FROM: "Bawaan <n@bawaan.my.id>" } as unknown as Env, { to: "a@b.c", subject: "Halo", text: "x", html: "<p>x</p>" })).toBe(true);
    expect(spy).toHaveBeenCalledWith("https://api.resend.com/emails", expect.objectContaining({ method: "POST" }));
  });

  it("keeps every integration off unless FEATURES lists it, even with secrets set", () => {
    const secrets = {
      RESEND_API_KEY: "re_1",
      EMAIL_FROM: "x@y.z",
      APPLE_CLIENT_ID: "a",
      APPLE_TEAM_ID: "b",
      APPLE_KEY_ID: "c",
      APPLE_PRIVATE_KEY: "d",
      BITESHIP_API_KEY: "e",
      CF_API_TOKEN: "f",
      CF_ZONE_ID: "g",
    };
    const off = { ...secrets, FEATURES: "" } as unknown as Env;
    const on = { ...secrets, FEATURES: "email, apple,courier,domains" } as unknown as Env;
    expect([emailEnabled(off), appleEnabled(off), courierEnabled(off), domainsEnabled(off)]).toEqual([false, false, false, false]);
    expect([emailEnabled(on), appleEnabled(on), courierEnabled(on), domainsEnabled(on)]).toEqual([true, true, true, true]);
    expect(integrationFeatures(off)).toEqual({ qris: false, waCloud: false });
  });

  it("keeps Apple sign-in off until configured", async () => {
    expect((await call(`${APP}/api/auth/apple/start`)).status).toBe(503);
    expect((await call(`${APP}/api/auth/me`)).json.appleEnabled).toBe(false);
  });

  it("lets Pro stores reach domain settings", async () => {
    const s = await seller("domain@example.com", "toko-domain");
    expect((await s.api("/domain")).json).toMatchObject({ enabled: false, allowed: false, domain: null });
    await makePro(s.tenantId);
    expect((await s.api("/domain")).json.allowed).toBe(true);
    expect((await s.api("/domain", { method: "PUT", body: { hostname: "toko.contoh.com" } })).status).toBe(503);
  });
});

describe("sample store", () => {
  it("shows the demo store but refuses its orders", async () => {
    const s = await seller("demo@example.com", "toko-contoh");
    const tripId = await openTrip(s.api);
    const p = await s.api(`/trips/${tripId}/products`, { body: { title: "Snack", priceMinor: 1000 } });
    await env.DB.prepare("update tenants set slug = 'demo' where id = ?").bind(s.tenantId).run();
    const page = await call(`${store("demo")}/api/store`);
    expect(page.json.store.demo).toBe(true);
    const co = await order("demo", tripId, p.json.id, "081200000099", "demo");
    expect(co.status).toBe(409);
  });
});
