import { exports } from "cloudflare:workers";

export const APP = "https://app.bawaan.my.id";
export const store = (slug: string) => `https://${slug}.bawaan.my.id`;

type Opts = { method?: string; body?: unknown; cookie?: string; headers?: Record<string, string>; form?: FormData };

export async function call(url: string, opts: Opts = {}) {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.cookie) headers.cookie = opts.cookie;
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  const res = await exports.default.fetch(new Request(url, { method: opts.method ?? (body ? "POST" : "GET"), headers, body, redirect: "manual" }));
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, json, text, headers: res.headers };
}

export async function login(email: string) {
  const res = await exports.default.fetch(
    new Request(`${APP}/api/auth/dev-login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, name: email.split("@")[0] }) }),
  );
  const cookie = res.headers.get("set-cookie")!.split(";")[0]!;
  return cookie;
}

export async function seller(email: string, slug: string) {
  const cookie = await login(email);
  const t = await call(`${APP}/api/tenants`, { cookie, body: { name: `Toko ${slug}`, slug, waNumber: "081234567890", dpPercent: 50, settleDays: 3 } });
  if (t.status !== 201) throw new Error(`tenant create failed: ${t.text}`);
  const api = (path: string, opts: Opts = {}) => call(`${APP}/api/t/${t.json.id}${path}`, { cookie, ...opts });
  return { cookie, tenantId: t.json.id as string, slug, api };
}

export async function openTrip(api: Awaited<ReturnType<typeof seller>>["api"], extra: Record<string, unknown> = {}) {
  const trip = await api("/trips", {
    body: { title: "Jastip Jepang Nov", country: "Jepang", currency: "JPY", kursMicro: 105_250_000, rounding: 1000, dpPercent: 50, closesAt: Date.now() + 86_400_000, ...extra },
  });
  await api(`/trips/${trip.json.id}`, { method: "PATCH", body: { status: "open" } });
  return trip.json.id as string;
}

/** Smallest valid JPEG header followed by filler, enough for the magic-byte sniffing. */
export function fakeJpeg(seed = 0) {
  const bytes = new Uint8Array(64);
  bytes.set([0xff, 0xd8, 0xff, 0xe0]);
  bytes[20] = seed;
  return new File([bytes], "bukti.jpg", { type: "image/jpeg" });
}

/** Upgrades a store to Pro through the platform admin, for tests that need more than the free plan allows. */
export async function makePro(tenantId: string) {
  const admin = await login("admin@example.com");
  const res = await call(`${APP}/api/admin/tenants/${tenantId}`, { method: "PATCH", cookie: admin, body: { plan: "pro", planUntil: Date.now() + 30 * 86_400_000 } });
  if (res.status !== 200) throw new Error(`makePro failed: ${res.text}`);
}
