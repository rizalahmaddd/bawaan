import { describe, expect, it } from "vitest";
import { productPatchSchema, tripPatchSchema } from "../src/api";

describe("patch schemas", () => {
  it("leave absent fields absent", () => {
    expect(tripPatchSchema.parse({ title: "Jastip Seoul" })).toEqual({ title: "Jastip Seoul" });
    expect(tripPatchSchema.parse({ status: "open" })).toEqual({ status: "open" });
    expect(productPatchSchema.parse({ quota: 3 })).toEqual({ quota: 3 });
  });
});

describe("url inputs", () => {
  it("keeps request links to http(s)", async () => {
    const { checkoutSchema } = await import("../src/api");
    const base = { tripId: "t", customer: { name: "Nadia", phone: "081211112222" }, idempotencyKey: "key-12345678" };
    const withLink = (link: string) => checkoutSchema.safeParse({ ...base, requests: [{ title: "Royce", qty: 1, link }] }).success;
    expect(withLink("https://www.royce.com/")).toBe(true);
    expect(withLink("javascript:alert(1)")).toBe(false);
    expect(withLink("data:text/html,x")).toBe(false);
  });

  it("only accepts real push service endpoints", async () => {
    const { pushEndpointSchema } = await import("../src/api");
    expect(pushEndpointSchema.safeParse("https://fcm.googleapis.com/fcm/send/abc").success).toBe(true);
    expect(pushEndpointSchema.safeParse("https://web.push.apple.com/QK1").success).toBe(true);
    expect(pushEndpointSchema.safeParse("https://updates.push.services.mozilla.com/wpush/v2/x").success).toBe(true);
    expect(pushEndpointSchema.safeParse("http://fcm.googleapis.com/x").success).toBe(false);
    expect(pushEndpointSchema.safeParse("https://evil.example/fcm.googleapis.com").success).toBe(false);
    expect(pushEndpointSchema.safeParse("https://fcm.googleapis.com.evil.example/x").success).toBe(false);
  });
});
