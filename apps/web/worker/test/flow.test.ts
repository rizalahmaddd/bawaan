import { describe, expect, it } from "vitest";
import { APP, call, fakeJpeg, login, openTrip, seller, store } from "./helpers";

describe("full jastip flow", () => {
  it("runs from checkout to delivery", async () => {
    const s = await seller("ayu@example.com", "toko-ayu");
    const tripId = await openTrip(s.api);
    const product = await s.api(`/trips/${tripId}/products`, { body: { title: "Tokyo Banana", priceMinor: 3200, fee: 25_000, quota: 2, variants: ["S", "M"] } });
    expect(product.status).toBe(201);

    const catalog = await call(`${store("toko-ayu")}/api/store`);
    expect(catalog.json.trips[0].products[0]).toMatchObject({ title: "Tokyo Banana", left: 2, variants: ["S", "M"] });

    const checkoutBody = {
      tripId,
      customer: { name: "Nadia", phone: "0812-1111-2222" },
      items: [{ productId: product.json.id, variant: "M", qty: 1 }],
      requests: [{ title: "Royce Matcha", qty: 1 }],
      idempotencyKey: "checkout-key-1",
    };
    const co = await call(`${store("toko-ayu")}/api/store/checkout`, { body: checkoutBody });
    expect(co.status).toBe(201);
    const { code, token } = co.json;
    expect(code).toMatch(/^JEP-\d{4}-[0-9A-Z]{5}$/);

    const again = await call(`${store("toko-ayu")}/api/store/checkout`, { body: checkoutBody });
    expect(again.json.code).toBe(code);

    const tooMany = await call(`${store("toko-ayu")}/api/store/checkout`, {
      body: { ...checkoutBody, customer: { name: "Rina", phone: "081299998888" }, items: [{ productId: product.json.id, variant: "S", qty: 2 }], requests: [], idempotencyKey: "checkout-key-2" },
    });
    expect(tooMany.status).toBe(409);
    expect(tooMany.json.message).toContain("tinggal 1");

    const orders = await s.api("/orders");
    const orderId = orders.json[0].id;
    expect(orders.json[0]).toMatchObject({ code, status: "requested" });

    const early = await s.api(`/orders/${orderId}/confirm`, { method: "POST" });
    expect(early.status).toBe(409);
    expect(early.json.message).toContain("Royce Matcha");

    const detail = await s.api(`/orders/${orderId}`);
    const requestItem = detail.json.items.find((i: any) => i.title === "Royce Matcha");
    await s.api(`/items/${requestItem.id}/quote`, { body: { priceMinor: 1000, fee: 25_000 } });

    const confirmed = await s.api(`/orders/${orderId}/confirm`, { method: "POST" });
    expect(confirmed.status).toBe(200);
    // 3200 × 105.25 = 336,800 → 337,000 + 25,000 fee; 1000 × 105.25 → 106,000 + 25,000.
    expect(confirmed.json.total).toBe(362_000 + 131_000);
    const dp = confirmed.json.invoice;
    expect(dp).toMatchObject({ type: "dp", amount: 247_000 });
    expect(dp.uniqueCode).toBeGreaterThan(0);

    const tracking = await call(`${store("toko-ayu")}/api/store/orders/${code}`, { headers: { "x-order-token": token } });
    expect(tracking.status).toBe(200);
    expect(tracking.json.items.every((i: any) => i.status === "awaiting_dp")).toBe(true);
    expect(tracking.json.customer).toEqual({ name: "Nadia", balance: 0, linked: false });

    expect((await call(`${store("toko-ayu")}/api/store/orders/${code}`, { headers: { "x-order-token": "nope" } })).status).toBe(404);
    const tracked = await call(`${store("toko-ayu")}/api/store/track`, { body: { code: code.toLowerCase(), last4: "2222" } });
    expect(tracked.json.token).toBe(token);
    expect((await call(`${store("toko-ayu")}/api/store/track`, { body: { code, last4: "0000" } })).status).toBe(404);

    const form = new FormData();
    form.set("kind", "proof");
    form.set("file", fakeJpeg(1));
    const up = await call(`${store("toko-ayu")}/api/store/orders/${code}/uploads`, { form, headers: { "x-order-token": token } });
    expect(up.status).toBe(201);
    const due = dp.amount + dp.uniqueCode;
    const pay = await call(`${store("toko-ayu")}/api/store/orders/${code}/payments`, { body: { invoiceId: dp.id, amount: due, proofKey: up.json.key }, headers: { "x-order-token": token } });
    expect(pay.status).toBe(201);
    const dupe = await call(`${store("toko-ayu")}/api/store/orders/${code}/payments`, { body: { invoiceId: dp.id, amount: due, proofKey: up.json.key }, headers: { "x-order-token": token } });
    expect(dupe.status).toBe(409);

    const pending = await s.api("/payments");
    expect(pending.json).toHaveLength(1);
    const verified = await s.api(`/payments/${pending.json[0].id}/verify`, { body: {} });
    expect(verified.json).toMatchObject({ credited: 0, paidInvoices: [dp.id] });
    expect((await s.api(`/payments/${pending.json[0].id}/verify`, { body: {} })).status).toBe(409);

    const hunting = await s.api(`/orders/${orderId}`);
    expect(hunting.json.items.map((i: any) => i.status)).toEqual(["hunting", "hunting"]);
    const banana = hunting.json.items.find((i: any) => i.title === "Tokyo Banana");

    const pricier = await s.api(`/items/${banana.id}/decide`, { body: { result: "obtained", actualPriceMinor: 3500 } });
    expect(pricier.json.status).toBe("needs_approval");
    const approve = await call(`${store("toko-ayu")}/api/store/orders/${code}/items/${banana.id}/approval`, { body: { approve: true }, headers: { "x-order-token": token } });
    expect(approve.status).toBe(200);

    const unavailable = await s.api(`/items/${requestItem.id}/decide`, { body: { result: "unavailable" } });
    expect(unavailable.status).toBe(200);
    // 3500 × 105.25 = 368,375 → 369,000 + 25,000 = 394,000; minus 247,000 DP.
    const settled = await s.api(`/orders/${orderId}`);
    const settlement = settled.json.invoices.find((i: any) => i.type === "settlement");
    expect(settlement).toMatchObject({ amount: 147_000, status: "open" });
    expect(settlement.lines.at(-1)).toEqual({ label: "Sudah dibayar (DP)", amount: -247_000 });

    const cash = await s.api(`/invoices/${settlement.id}/payments`, { body: { amount: 147_000 + settlement.uniqueCode + 5_000, method: "cash" } });
    expect(cash.json.credited).toBe(5_000);

    const shp = await s.api("/shipments", { body: { tripId, name: "Kargo 1" } });
    const shpDetail = await s.api(`/shipments/${shp.json.id}`);
    expect(shpDetail.json.candidates.map((i: any) => i.title)).toEqual(["Tokyo Banana"]);
    await s.api(`/shipments/${shp.json.id}/items`, { body: { itemIds: [banana.id] } });
    const moved = await s.api(`/shipments/${shp.json.id}/status`, { body: { status: "in_transit" } });
    expect(moved.json.notified).toBe(1);

    const inTransit = await call(`${store("toko-ayu")}/api/store/orders/${code}`, { headers: { "x-order-token": token } });
    expect(inTransit.json.shipments[0]).toMatchObject({ status: "in_transit", awb: null });
    expect(inTransit.json.customer.balance).toBe(5_000);

    const customerId = settled.json.customer.id;
    const dlv = await s.api("/deliveries", { body: { customerId, itemIds: [banana.id], courier: "JNE", resi: "JNE123", status: "shipped" } });
    expect(dlv.status).toBe(201);
    await s.api(`/deliveries/${dlv.json.id}`, { method: "PATCH", body: { status: "delivered" } });
    const done = await s.api(`/orders/${orderId}`);
    expect(done.json.order.status).toBe("completed");
  });
});

describe("tenant isolation", () => {
  it("keeps sellers and stores apart", async () => {
    const a = await seller("a@example.com", "toko-satu");
    const b = await seller("b@example.com", "toko-dua");
    const tripId = await openTrip(a.api);
    const p = await a.api(`/trips/${tripId}/products`, { body: { title: "Barang", priceMinor: 1000 } });
    const co = await call(`${store("toko-satu")}/api/store/checkout`, {
      body: { tripId, customer: { name: "Dewi", phone: "081377778888" }, items: [{ productId: p.json.id, qty: 1 }], idempotencyKey: "iso-key-1" },
    });
    const orderId = (await a.api("/orders")).json[0].id;

    expect((await call(`${APP}/api/t/${a.tenantId}/orders/${orderId}`, { cookie: b.cookie })).status).toBe(404);
    expect((await b.api(`/orders/${orderId}`)).status).toBe(404);
    expect((await b.api(`/items/x/decide`, { body: { result: "unavailable" } })).status).toBe(404);
    expect((await call(`${store("toko-dua")}/api/store/orders/${co.json.code}`, { headers: { "x-order-token": co.json.token } })).status).toBe(404);
    // Checkout into another store's trip is refused.
    const cross = await call(`${store("toko-dua")}/api/store/checkout`, {
      body: { tripId, customer: { name: "Dewi", phone: "081377778888" }, items: [{ productId: p.json.id, qty: 1 }], idempotencyKey: "iso-key-2" },
    });
    expect(cross.status).toBe(409);
  });

  it("guards surfaces, auth, and roles", async () => {
    expect((await call(`${APP}/api/t/ten_x/today`)).status).toBe(401);
    expect((await call(`${store("toko-ayu")}/api/t/ten_x/today`)).status).toBe(404);
    expect((await call(`${APP}/api/store`)).status).toBe(404);
    const cookie = await login("c@example.com");
    expect((await call(`${APP}/api/tenants`, { cookie, body: { name: "Toko App", slug: "app", waNumber: "081234567890" } })).status).toBe(422);
    const cross = await call(`${APP}/api/auth/logout`, { method: "POST", cookie, headers: { origin: "https://evil.example" } });
    expect(cross.status).toBe(403);
  });
});
