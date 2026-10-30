import { describe, expect, it } from "vitest";
import { APP, call, login, makePro, openTrip, seller, store } from "./helpers";

type Api = Awaited<ReturnType<typeof seller>>["api"];

async function order(api: Api, slug: string, tripId: string, productId: string, customer: { name: string; phone: string }, key: string, qty = 1) {
  const co = await call(`${store(slug)}/api/store/checkout`, { body: { tripId, customer, items: [{ productId, qty }], idempotencyKey: `test-${key}` } });
  expect(co.status).toBe(201);
  const orderId = (await api(`/orders?q=${co.json.code}`)).json[0].id as string;
  return { ...co.json, orderId } as { code: string; token: string; orderId: string };
}

/** Confirm, pay the DP in cash and mark everything obtained: the order is then waiting for settlement. */
async function obtain(api: Api, orderId: string) {
  const conf = await api(`/orders/${orderId}/confirm`, { method: "POST" });
  await api(`/invoices/${conf.json.invoice.id}/payments`, { body: { amount: conf.json.invoice.amount + conf.json.invoice.uniqueCode, method: "cash" } });
  const detail = await api(`/orders/${orderId}`);
  for (const i of detail.json.items) await api(`/items/${i.id}/decide`, { body: { result: "obtained" } });
  return (await api(`/orders/${orderId}`)).json;
}

describe("phase 2", () => {
  it("patching a trip leaves other fields alone", async () => {
    const s = await seller("patch@example.com", "toko-patch");
    const tripId = await openTrip(s.api, { rounding: 500, defaultFee: 7_000, kursLock: "settle" });
    await s.api(`/trips/${tripId}`, { method: "PATCH", body: { title: "Ganti judul" } });
    const trip = (await s.api(`/trips/${tripId}`)).json.trip;
    expect(trip).toMatchObject({ title: "Ganti judul", rounding: 500, defaultFee: 7_000, kursLock: "settle", status: "open" });
  });

  it("bills cargo by weight and passes duty through by value", async () => {
    const s = await seller("cargo@example.com", "toko-kargo");
    const tripId = await openTrip(s.api, { cargoRatePerKg: 150_000, cargoRoundG: 100, cargoMinIdr: 50_000 });
    const p = await s.api(`/trips/${tripId}/products`, { body: { title: "Snack", priceMinor: 1000 } });
    const a = await order(s.api, "toko-kargo", tripId, p.json.id, { name: "Ani", phone: "081200000001" }, "cargo-a", 3);
    const b = await order(s.api, "toko-kargo", tripId, p.json.id, { name: "Budi", phone: "081200000002" }, "cargo-b", 1);
    const va = await obtain(s.api, a.orderId);
    const vb = await obtain(s.api, b.orderId);

    const shp = await s.api("/shipments", { body: { tripId, name: "Kargo udara" } });
    await s.api(`/shipments/${shp.json.id}/items`, { body: { itemIds: [va.items[0].id, vb.items[0].id] } });
    const saved = await s.api(`/shipments/${shp.json.id}/parcels`, {
      method: "PUT",
      body: [
        { customerId: va.customer.id, weightG: 1230 },
        { customerId: vb.customer.id, weightG: 150, lengthCm: 40, widthCm: 30, heightCm: 20 },
      ],
    });
    expect(saved.json.saved).toBe(2);
    const preview = await s.api(`/shipments/${shp.json.id}/cargo`);
    expect(preview.json.rows.map((r: any) => [r.customer, r.billedG, r.amount])).toEqual([
      ["Ani", 1300, 195_000],
      ["Budi", 4000, 600_000],
    ]);

    const bill = await s.api(`/shipments/${shp.json.id}/bill-cargo`, { method: "POST" });
    expect(bill.json).toMatchObject({ issued: 2, total: 795_000 });
    expect((await s.api(`/shipments/${shp.json.id}/bill-cargo`, { method: "POST" })).json.issued).toBe(0);
    const locked = await s.api(`/shipments/${shp.json.id}/parcels`, { method: "PUT", body: [{ customerId: va.customer.id, weightG: 10 }] });
    expect(locked.json).toMatchObject({ saved: 0, locked: 2 });

    // Ani's goods are worth 3× Budi's, so 100k duty splits 75k / 25k.
    const duty = await s.api(`/shipments/${shp.json.id}/costs`, { body: { costIdr: 600_000, dutyIdr: 100_000, dutyMode: "pass", bill: true } });
    expect(duty.json).toMatchObject({ issued: 2, total: 100_000 });
    const ani = await s.api(`/orders/${a.orderId}`);
    expect(ani.json.invoices.filter((i: any) => ["cargo", "adjustment"].includes(i.type)).map((i: any) => i.amount)).toEqual([195_000, 75_000]);
    expect((await s.api(`/shipments/${shp.json.id}/costs`, { body: { dutyIdr: 1 } })).status).toBe(409);

    const report = await s.api(`/reports/trips/${tripId}`);
    expect(report.json.money).toMatchObject({ cargoBilled: expect.any(Number), cargoCost: 600_000, dutyBilled: expect.any(Number), dutyCost: 100_000 });
    expect(report.json.money.cargoBilled - 795_000).toBeLessThan(2_000);
    const csv = await s.api(`/reports/trips/${tripId}/export.csv`);
    expect(csv.text).toContain("kode,pelanggan");
    expect(csv.text).toContain(a.code);
  });

  it("combines invoices and spreads one payment across them", async () => {
    const s = await seller("combine@example.com", "toko-gabung");
    await makePro(s.tenantId);
    const t1 = await openTrip(s.api);
    const t2 = await openTrip(s.api, { title: "Jastip Korea" });
    const p1 = await s.api(`/trips/${t1}/products`, { body: { title: "Barang A", priceMinor: 1000 } });
    const p2 = await s.api(`/trips/${t2}/products`, { body: { title: "Barang B", priceMinor: 2000 } });
    const cust = { name: "Citra", phone: "081300000003" };
    const o1 = await order(s.api, "toko-gabung", t1, p1.json.id, cust, "gab-1");
    const o2 = await order(s.api, "toko-gabung", t2, p2.json.id, cust, "gab-2");
    const dp1 = (await s.api(`/orders/${o1.orderId}/confirm`, { method: "POST" })).json.invoice;
    const dp2 = (await s.api(`/orders/${o2.orderId}/confirm`, { method: "POST" })).json.invoice;

    const combined = await s.api("/invoices/combine", { body: { invoiceIds: [dp1.id, dp2.id] } });
    expect(combined.status).toBe(201);
    expect(combined.json).toMatchObject({ type: "combined", amount: dp1.amount + dp2.amount });
    expect((await s.api("/invoices/combine", { body: { invoiceIds: [dp1.id, dp2.id] } })).status).toBe(409);
    expect((await s.api(`/invoices/${dp1.id}/void`, { body: { reason: "salah" } })).status).toBe(409);

    // Paying the inner invoice is redirected to the combined one.
    const paid = await s.api(`/invoices/${dp1.id}/payments`, { body: { amount: combined.json.amount + combined.json.uniqueCode, method: "transfer" } });
    expect(paid.json.credited).toBe(0);
    expect(paid.json.paidInvoices.sort()).toEqual([combined.json.id, dp1.id, dp2.id].sort());
    const v1 = await s.api(`/orders/${o1.orderId}`);
    expect(v1.json.items[0].status).toBe("hunting");
    expect((await s.api(`/orders/${o2.orderId}`)).json.items[0].status).toBe("hunting");
  });

  it("replays offline decisions once and flags overwrites", async () => {
    const s = await seller("offline@example.com", "toko-offline");
    await makePro(s.tenantId);
    const tripId = await openTrip(s.api);
    const p = await s.api(`/trips/${tripId}/products`, { body: { title: "Kit Kat", priceMinor: 500 } });
    const o = await order(s.api, "toko-offline", tripId, p.json.id, { name: "Dina", phone: "081300000004" }, "off-1");
    const conf = await s.api(`/orders/${o.orderId}/confirm`, { method: "POST" });
    await s.api(`/invoices/${conf.json.invoice.id}/payments`, { body: { amount: 999_999, method: "cash" } });
    const itemId = (await s.api(`/orders/${o.orderId}`)).json.items[0].id;

    const headers = { "idempotency-key": "outbox-0001", "x-client-at": String(Date.now() - 60_000) };
    const first = await s.api(`/items/${itemId}/decide`, { body: { result: "unavailable" }, headers });
    const replay = await s.api(`/items/${itemId}/decide`, { body: { result: "unavailable" }, headers });
    expect(replay.json).toEqual(first.json);

    // A teammate decided after the offline phone captured its decision: last writer wins, but it's flagged.
    const staff = await login("staf-offline@example.com");
    const inv = await s.api("/team/invites", { body: { email: "staf-offline@example.com", role: "staff" } });
    const token = new URL(inv.json.link).searchParams.get("token");
    expect((await call(`${APP}/api/tenants/invites/accept`, { cookie: staff, body: { token } })).status).toBe(200);
    const late = await call(`${APP}/api/t/${s.tenantId}/items/${itemId}/decide`, {
      cookie: staff,
      body: { result: "obtained" },
      headers: { "idempotency-key": "outbox-0002", "x-client-at": String(Date.now() - 120_000) },
    });
    expect(late.json.overwrote).toBe(true);
  });

  it("invites staff with limited powers", async () => {
    const s = await seller("owner@example.com", "toko-tim");
    await makePro(s.tenantId);
    const inv = await s.api("/team/invites", { body: { email: "Staf@Example.com", role: "staff" } });
    expect(inv.status).toBe(201);
    const token = new URL(inv.json.link).searchParams.get("token")!;

    const wrong = await login("orang-lain@example.com");
    expect((await call(`${APP}/api/tenants/invites/accept`, { cookie: wrong, body: { token } })).status).toBe(403);
    const staff = await login("staf@example.com");
    expect((await call(`${APP}/api/tenants/invites/accept`, { cookie: staff, body: { token } })).json.tenantId).toBe(s.tenantId);
    expect((await call(`${APP}/api/tenants/invites/accept`, { cookie: staff, body: { token } })).status).toBe(404);

    const tripId = await openTrip(s.api);
    const p = await s.api(`/trips/${tripId}/products`, { body: { title: "Barang X", priceMinor: 100 } });
    const o = await order(s.api, "toko-tim", tripId, p.json.id, { name: "Eka", phone: "081300000005" }, "tim-1");
    const conf = await s.api(`/orders/${o.orderId}/confirm`, { method: "POST" });
    const asStaff = (path: string, opts: Record<string, unknown> = {}) => call(`${APP}/api/t/${s.tenantId}${path}`, { cookie: staff, ...opts });

    expect((await asStaff(`/invoices/${conf.json.invoice.id}/payments`, { body: { amount: 1, method: "cash" } })).status).toBe(403);
    expect((await asStaff("/reports")).status).toBe(403);
    expect((await asStaff("/team/invites", { body: { email: "x@example.com", role: "admin" } })).status).toBe(403);
    expect((await asStaff("/customers")).json[0].phone).toContain("•••");

    const team = await s.api("/team");
    const staffId = team.json.members.find((m: any) => m.role === "staff").userId;
    await s.api(`/team/${staffId}`, { method: "PATCH", body: { permissions: { money: true } } });
    expect((await asStaff(`/invoices/${conf.json.invoice.id}/payments`, { body: { amount: 1, method: "cash" } })).status).toBe(200);

    const ownerId = team.json.me;
    expect((await s.api(`/team/${ownerId}`, { method: "DELETE" })).status).toBe(409);
    expect((await asStaff(`/team/${ownerId}`, { method: "DELETE" })).status).toBe(403);
    expect((await asStaff(`/team/${staffId}`, { method: "DELETE" })).status).toBe(200);
  });

  it("counts orders and products per row in the trip and customer lists", async () => {
    const s = await seller("counts@example.com", "toko-hitung");
    const tripId = await openTrip(s.api);
    const p = await s.api(`/trips/${tripId}/products`, { body: { title: "Snack", priceMinor: 1000 } });
    await order(s.api, "toko-hitung", tripId, p.json.id, { name: "Ani", phone: "081200000011" }, "count-a");
    const trip = (await s.api("/trips")).json.find((t: { id: string }) => t.id === tripId);
    expect(trip).toMatchObject({ orderCount: 1, productCount: 1 });
    expect((await s.api("/customers")).json[0].orderCount).toBe(1);
  });

  it("merges duplicate customers and keeps the old phone pointing at the survivor", async () => {
    const s = await seller("merge@example.com", "toko-merge");
    const tripId = await openTrip(s.api);
    const p = await s.api(`/trips/${tripId}/products`, { body: { title: "Barang Y", priceMinor: 100 } });
    await order(s.api, "toko-merge", tripId, p.json.id, { name: "Fani", phone: "081300000006" }, "mrg-1");
    await order(s.api, "toko-merge", tripId, p.json.id, { name: "Fani (nomor 2)", phone: "081300000007" }, "mrg-2");
    const list = (await s.api("/customers")).json;
    const [keep, dupe] = [list.find((c: any) => c.name === "Fani"), list.find((c: any) => c.name !== "Fani")];
    expect((await s.api(`/customers/${dupe.id}/merge`, { body: { intoId: keep.id } })).status).toBe(200);
    expect((await s.api("/customers")).json).toHaveLength(1);
    expect((await s.api(`/customers/${keep.id}`)).json.orders).toHaveLength(2);
    await order(s.api, "toko-merge", tripId, p.json.id, { name: "Fani", phone: "081300000007" }, "mrg-3");
    expect((await s.api(`/customers/${keep.id}`)).json.orders).toHaveLength(3);
  });

  it("lets a customer link orders to their Google account and hold deliveries", async () => {
    const s = await seller("akun@example.com", "toko-akun");
    const tripId = await openTrip(s.api);
    const p = await s.api(`/trips/${tripId}/products`, { body: { title: "Barang Z", priceMinor: 100 } });
    const o = await order(s.api, "toko-akun", tripId, p.json.id, { name: "Gita", phone: "081300000008" }, "akun-1");
    const base = store("toko-akun");

    expect((await call(`${base}/api/store/me`)).json.user).toBeNull();
    const loginRes = await call(`${base}/api/store/auth/dev-login`, { body: { email: "gita@example.com" } });
    const cookie = loginRes.headers.get("set-cookie")!.split(";")[0]!;
    expect((await call(`${base}/api/store/me`, { cookie })).json.orders).toEqual([]);
    expect((await call(`${base}/api/store/orders/${o.code}/link`, { method: "POST", cookie, headers: { "x-order-token": "salah" } })).status).toBe(404);
    const linked = await call(`${base}/api/store/orders/${o.code}/link`, { method: "POST", cookie, headers: { "x-order-token": o.token } });
    expect(linked.text).toBe('{"ok":true}');
    const me = await call(`${base}/api/store/me`, { cookie });
    expect(me.json.orders).toEqual([expect.objectContaining({ code: o.code, token: o.token })]);
    // The session belongs to this store's host only.
    expect((await call(`${store("toko-merge")}/api/store/me`, { cookie })).json.orders ?? []).toEqual([]);

    await call(`${base}/api/store/orders/${o.code}/hold`, { body: { hold: true }, headers: { "x-order-token": o.token } });
    expect((await s.api(`/orders/${o.orderId}`)).json.order.holdForCombine).toBe(true);
  });
});
