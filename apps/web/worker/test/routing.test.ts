import { exports } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { seller } from "./helpers";

const call = (url: string, init?: RequestInit) => exports.default.fetch(new Request(url, init));

describe("host routing (production hosts)", () => {
  beforeAll(async () => {
    await seller("routing@example.com", "toko-ayu");
  });

  it.each([
    ["https://bawaan.my.id/", "landing"],
    ["https://app.bawaan.my.id/orders", "app"],
    ["https://toko-ayu.bawaan.my.id/", "store"],
  ])("%s → %s shell", async (url, surface) => {
    const res = await call(url);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain(`data-surface="${surface}"`);
    expect(html).toContain('property="og:title"');
  });

  it("stamps the store slug", async () => {
    const html = await (await call("https://toko-ayu.bawaan.my.id/")).text();
    expect(html).toContain('data-slug="toko-ayu"');
    expect(html).toContain('data-store-name="Toko toko-ayu"');
    expect(html).toContain("<title>Toko toko-ayu · Jastip</title>");
  });

  it("404s a well-formed subdomain with no store behind it", async () => {
    const res = await call("https://belum-ada.bawaan.my.id/");
    expect(res.status).toBe(404);
    expect(await res.text()).toContain('data-surface="not-found"');
  });

  it("redirects www to the apex, keeping the path", async () => {
    const res = await call("https://www.bawaan.my.id/harga?x=1", { redirect: "manual" });
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe("https://bawaan.my.id/harga?x=1");
  });

  it.each(["https://a.b.bawaan.my.id/", "https://-bad-.bawaan.my.id/"])("404s %s", async (url) => {
    const res = await call(url);
    expect(res.status).toBe(404);
    expect(await res.text()).toContain('data-surface="not-found"');
  });

  it("sets security headers and no-cache on the shell", async () => {
    const res = await call("https://app.bawaan.my.id/");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("cache-control")).toBe("no-cache");
  });

  it("serves files with an extension straight from assets", async () => {
    const res = await call("https://toko-ayu.bawaan.my.id/robots.txt");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("User-agent");
  });

  it("rejects writes to page routes", async () => {
    const res = await call("https://app.bawaan.my.id/", { method: "POST" });
    expect(res.status).toBe(405);
  });
});

describe("host override (non-production only)", () => {
  it("?host= picks the surface and remembers it in a cookie", async () => {
    const res = await call("https://bawaan-preview.example.workers.dev/api/surface?host=toko-ayu");
    expect(await res.json()).toEqual({ kind: "store", slug: "toko-ayu" });
    expect(res.headers.get("set-cookie")).toContain("bawaan_host=toko-ayu");

    const again = await call("https://bawaan-preview.example.workers.dev/api/surface", { headers: { cookie: "bawaan_host=app" } });
    expect(await again.json()).toEqual({ kind: "app" });
  });

  it("unknown preview hosts fall back to the landing page", async () => {
    const res = await call("https://bawaan-preview.example.workers.dev/api/surface");
    expect(await res.json()).toEqual({ kind: "landing" });
  });
});

describe("api", () => {
  it("health reports every binding", async () => {
    const res = await call("https://app.bawaan.my.id/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, d1: "phase-3", kv: "ok", r2: "ok" });
  });

  it("unknown api routes are JSON 404s", async () => {
    const res = await call("https://app.bawaan.my.id/api/nope");
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: "not_found" });
  });
});

describe("production ignores overrides", () => {
  it("does not let ?host= or the cookie change the surface", async () => {
    const { surfaceFor } = await import("../surface");
    const prod = { ROOT_DOMAIN: "bawaan.my.id", ENVIRONMENT: "production" } as Env;
    const req = new Request("https://demo.bawaan.my.id/?host=app", { headers: { cookie: "bawaan_host=app" } });
    expect(surfaceFor(req, prod)).toEqual({ surface: { kind: "store", slug: "demo" } });
    expect(surfaceFor(new Request("https://evil.workers.dev/?host=app"), prod).surface).toEqual({ kind: "not-found", reason: "unknown-host" });
  });
});
