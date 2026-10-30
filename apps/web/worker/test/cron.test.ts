import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { runCron } from "../cron";
import { call, openTrip, seller, store } from "./helpers";

describe("cron", () => {
  it("cancels orders whose DP was never paid and frees the quota", async () => {
    const s = await seller("cron@example.com", "toko-cron");
    const tripId = await openTrip(s.api);
    const p = await s.api(`/trips/${tripId}/products`, { body: { title: "Limited", priceMinor: 1000, quota: 1 } });
    await call(`${store("toko-cron")}/api/store/checkout`, {
      body: { tripId, customer: { name: "Sari", phone: "081355556666" }, items: [{ productId: p.json.id, qty: 1 }], idempotencyKey: "cron-key-1" },
    });
    const orderId = (await s.api("/orders")).json[0].id;
    await s.api(`/orders/${orderId}/confirm`, { method: "POST" });

    const result = await runCron(env, Date.now() + 4 * 86_400_000);
    expect(result.expireUnpaidDp).toBe(1);
    const order = await s.api(`/orders/${orderId}`);
    expect(order.json.order.status).toBe("cancelled");
    const catalog = await call(`${store("toko-cron")}/api/store`);
    expect(catalog.json.trips[0].products[0].left).toBe(1);
  });

  it("treats an unanswered price approval as a no", async () => {
    const s = await seller("cron2@example.com", "toko-cron-dua");
    const tripId = await openTrip(s.api, { dpPercent: 0 });
    const p = await s.api(`/trips/${tripId}/products`, { body: { title: "Parfum", priceMinor: 1000 } });
    await call(`${store("toko-cron-dua")}/api/store/checkout`, {
      body: { tripId, customer: { name: "Tia", phone: "081344445555" }, items: [{ productId: p.json.id, qty: 1 }], idempotencyKey: "cron-key-2" },
    });
    const orderId = (await s.api("/orders")).json[0].id;
    await s.api(`/orders/${orderId}/confirm`, { method: "POST" });
    const item = (await s.api(`/orders/${orderId}`)).json.items[0];
    await s.api(`/items/${item.id}/decide`, { body: { result: "obtained", actualPriceMinor: 1500 } });

    const result = await runCron(env, Date.now() + 2 * 86_400_000);
    expect(result.expireApprovals).toBe(1);
    const after = await s.api(`/orders/${orderId}`);
    expect(after.json.items[0].status).toBe("unavailable");
    expect(after.json.order.status).toBe("completed");
  });
});
