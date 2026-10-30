import type { Surface } from "@bawaan/shared";
import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import type { AppEnv } from "./app";
import { authRoutes } from "./auth/routes";
import { runCron } from "./cron";
import { and, desc, eq, gt, sql } from "drizzle-orm";
import { getDb, schema } from "./db";
import { origins } from "./lib/origins";
import { HttpError } from "./lib/http";
import { slugForHost } from "./services/domains";
import { adminRoutes } from "./platform/admin";
import { webhookRoutes } from "./platform/webhooks";
import { pushRoutes } from "./push";
import { withSecurityHeaders } from "./security";
import { sellerRoutes } from "./seller/routes";
import { tenantRoutes } from "./seller/tenants";
import { rewriteShell } from "./shell";
import { storeRoutes } from "./store/routes";
import { HOST_OVERRIDE_COOKIE, surfaceFor } from "./surface";

const app = new Hono<AppEnv>();

app.use(async (c, next) => {
  const resolved = surfaceFor(c.req.raw, c.env);
  const { setOverride } = resolved;
  let { surface } = resolved;
  if (surface.kind === "not-found" && surface.reason === "unknown-host") {
    const slug = await slugForHost(c.env, new URL(c.req.url).hostname);
    if (slug) surface = { kind: "store", slug };
  }
  if (surface.kind === "redirect") {
    const url = new URL(c.req.url);
    url.hostname = surface.to;
    return c.redirect(url.toString(), 301);
  }
  c.set("surface", surface);
  c.set("db", getDb(c.env));
  await next();
  if (setOverride !== undefined && getCookie(c, HOST_OVERRIDE_COOKIE) !== setOverride) {
    c.header("Set-Cookie", `${HOST_OVERRIDE_COOKIE}=${encodeURIComponent(setOverride)}; Path=/; SameSite=Lax; HttpOnly`, { append: true });
  }
  c.res = withSecurityHeaders(c.res, c.env);
});

// Cookies are SameSite=Lax, and a same-origin check on writes closes the rest of the CSRF gap.
app.use("/api/*", async (c, next) => {
  if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method)) {
    const origin = c.req.header("origin");
    // Apple posts its sign-in result back as a form from appleid.apple.com; the OAuth state guards that one.
    const crossSiteAllowed = c.req.path === "/api/auth/apple/callback";
    if (origin && origin !== new URL(c.req.url).origin && !crossSiteAllowed) throw new HttpError(403, "bad_origin", "Permintaan ditolak");
  }
  await next();
});

const only = (...kinds: Surface["kind"][]) =>
  async (c: { var: { surface: Surface } }, next: () => Promise<void>) => {
    if (!kinds.includes(c.var.surface.kind)) throw new HttpError(404, "not_found", "Tidak ditemukan");
    await next();
  };

app.get("/api/surface", (c) => c.json(c.get("surface")));

app.get("/api/health", async (c) => {
  const [db, kv, r2] = await Promise.allSettled([
    c.env.DB.prepare("SELECT value FROM app_meta WHERE key = 'schema'").first<{ value: string }>(),
    c.env.HOSTS.get("__health"),
    c.env.PUBLIC_BUCKET.head("__health"),
  ]);
  const ok = db.status === "fulfilled" && kv.status === "fulfilled" && r2.status === "fulfilled";
  return c.json(
    {
      ok,
      environment: c.env.ENVIRONMENT,
      d1: db.status === "fulfilled" ? (db.value?.value ?? "empty") : "error",
      kv: kv.status === "fulfilled" ? "ok" : "error",
      r2: r2.status === "fulfilled" ? "ok" : "error",
    },
    ok ? 200 : 503,
    { "Cache-Control": "no-store" },
  );
});

// The Google callback carries its own state, and outside production it may land on whatever surface the ?host= cookie picked.
app.use("/api/auth/*", async (c, next) => (/^\/api\/auth\/(google|apple)\/callback$/.test(c.req.path) ? next() : only("app", "accounts", "landing")(c, next)));
app.route("/api/auth", authRoutes);
app.use("/api/tenants/*", only("app"));
app.route("/api/tenants", tenantRoutes);
app.use("/api/t/*", only("app"));
app.route("/api/t", sellerRoutes);
app.use("/api/store/*", only("store"));
app.route("/api/store", storeRoutes);
app.route("/api/push", pushRoutes);
app.use("/api/admin/*", only("app"));
app.route("/api/admin", adminRoutes);
app.route("/api/webhooks", webhookRoutes);

/** Ready stock across stores on the landing page. Cached briefly: it's public and the same for everyone. */
app.get("/api/market", only("landing"), async (c) => {
  const cacheKey = new Request(new URL("/api/market", c.req.url).toString());
  const hit = await caches.default.match(cacheKey);
  if (hit) return hit;
  const rows = await c.var.db
    .select({
      id: schema.products.id,
      title: schema.products.title,
      price: schema.products.priceMinor,
      photoKey: schema.products.photoKey,
      quota: schema.products.quota,
      reserved: schema.products.reserved,
      slug: schema.tenants.slug,
      store: schema.tenants.name,
    })
    .from(schema.products)
    .innerJoin(schema.trips, eq(schema.trips.id, schema.products.tripId))
    .innerJoin(schema.tenants, eq(schema.tenants.id, schema.products.tenantId))
    .where(and(eq(schema.trips.kind, "ready"), eq(schema.trips.status, "open"), eq(schema.products.status, "active"), eq(schema.tenants.status, "active"), sql`coalesce(${schema.products.quota}, 1) > ${schema.products.reserved}`))
    .orderBy(desc(schema.products.createdAt))
    .limit(60)
    .all();
  const o = origins(c.env, c.req.url);
  const res = c.json({ items: rows.map((r) => ({ id: r.id, title: r.title, price: r.price, photoKey: r.photoKey, store: r.store, url: o.store(r.slug), left: r.quota === null ? null : r.quota - r.reserved })) }, 200, {
    "Cache-Control": "public, max-age=300",
  });
  c.executionCtx.waitUntil(caches.default.put(cacheKey, res.clone()));
  return res;
});

app.all("/api/*", (c) => c.json({ error: "not_found", message: "Tidak ditemukan" }, 404));

app.get("/media/*", async (c) => {
  const key = c.req.path.slice("/media/".length);
  const cache = caches.default;
  const hit = await cache.match(c.req.raw);
  if (hit) return hit;
  const obj = await c.env.PUBLIC_BUCKET.get(key);
  if (!obj) return c.text("Not found", 404);
  const res = new Response(obj.body, {
    headers: { "Content-Type": obj.httpMetadata?.contentType ?? "application/octet-stream", "Cache-Control": "public, max-age=31536000, immutable", ETag: obj.httpEtag },
  });
  c.executionCtx.waitUntil(cache.put(c.req.raw, res.clone()));
  return res;
});

app.get("*", async (c) => {
  const url = new URL(c.req.url);
  // Files that exist in the bundle but aren't excluded from run_worker_first in wrangler.jsonc.
  if (/\.[a-z0-9]+$/i.test(url.pathname)) return c.env.ASSETS.fetch(c.req.raw);

  let surface = c.get("surface");
  let storeName: string | undefined;
  if (surface.kind === "store") {
    const slug = (surface as { slug: string }).slug;
    const t = await c.var.db.query.tenants.findFirst({ where: (t, { eq }) => eq(t.slug, slug), columns: { name: true, status: true } });
    if (!t) {
      // Renamed stores keep their old links working for 90 days.
      const moved = await c.var.db
        .select({ to: schema.tenants.slug })
        .from(schema.slugHistory)
        .innerJoin(schema.tenants, eq(schema.tenants.id, schema.slugHistory.tenantId))
        .where(and(eq(schema.slugHistory.slug, slug), gt(schema.slugHistory.redirectUntil, Date.now())))
        .get();
      if (moved) return c.redirect(origins(c.env, c.req.url).store(moved.to, url.pathname + url.search.replace(/([?&])host=[^&]*&?/, "$1").replace(/[?&]$/, "")), 301);
    }
    if (!t || (t.status !== "active" && t.status !== "readonly")) surface = { kind: "not-found", reason: "invalid-slug" };
    else storeName = t.name;
  }
  const shell = await c.env.ASSETS.fetch(new URL("/", url));
  const res = rewriteShell(shell, surface, url.origin + url.pathname, storeName);
  return new Response(res.body, {
    status: surface.kind === "not-found" ? 404 : 200,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" },
  });
});

app.all("*", (c) => c.text("Method not allowed", 405));

app.onError((err, c) => {
  if (err instanceof HttpError) return c.json({ error: err.code, message: err.message, details: err.details }, err.status);
  console.error(err);
  return c.json({ error: "internal", message: "Terjadi kesalahan di server. Coba lagi." }, 500);
});

export default {
  fetch: app.fetch,
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(runCron(env));
  },
} satisfies ExportedHandler<Env>;
