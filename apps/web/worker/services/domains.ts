import { eq } from "drizzle-orm";
import type { DB } from "../db";
import { schema } from "../db";
import { feature } from "../lib/features";
import { HttpError, conflict } from "../lib/http";

const HOST_RE = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
export const hostKey = (hostname: string) => `host:${hostname}`;

export const domainsEnabled = (env: Env) => feature(env, "domains") && !!(env.CF_API_TOKEN && env.CF_ZONE_ID);

export function normalizeHostname(env: Env, input: string) {
  const host = input.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/\.$/, "");
  if (!HOST_RE.test(host)) throw new HttpError(422, "invalid", "Nama domain tidak valid, contoh: toko.namaku.com");
  if (host === env.ROOT_DOMAIN || host.endsWith(`.${env.ROOT_DOMAIN}`)) throw new HttpError(422, "invalid", "Pakai domain milikmu sendiri, bukan subdomain Bawaan");
  return host;
}

type CfHostname = {
  id: string;
  hostname: string;
  status: string;
  ssl?: { status?: string; validation_errors?: Array<{ message: string }> };
  ownership_verification?: { type: string; name: string; value: string };
  verification_errors?: string[];
};

async function cf<T>(env: Env, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${env.CF_ZONE_ID}/custom_hostnames${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${env.CF_API_TOKEN}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  const data = await res.json<{ success: boolean; result: T; errors?: Array<{ code: number; message: string }> }>().catch(() => null);
  if (!res.ok || !data?.success) {
    const msg = data?.errors?.[0]?.message ?? `HTTP ${res.status}`;
    if (/already exists/i.test(msg)) throw conflict("Domain ini sudah dipakai di Cloudflare");
    throw new HttpError(502, "cloudflare", `Cloudflare menolak: ${msg}`);
  }
  return data.result;
}

function view(env: Env, h: CfHostname | null, hostname: string) {
  return {
    hostname,
    status: h?.status ?? "pending",
    sslStatus: h?.ssl?.status ?? null,
    active: h?.status === "active" && h.ssl?.status === "active",
    cnameTarget: env.CUSTOM_DOMAIN_TARGET ?? `domain.${env.ROOT_DOMAIN}`,
    txt: h?.ownership_verification ?? null,
    errors: [...(h?.verification_errors ?? []), ...(h?.ssl?.validation_errors?.map((e) => e.message) ?? [])],
  };
}

export async function addDomain(env: Env, db: DB, tenant: { id: string; slug: string }, input: string) {
  if (!domainsEnabled(env)) throw new HttpError(503, "unavailable", "Custom domain belum tersedia");
  const hostname = normalizeHostname(env, input);
  const taken = await db.select({ id: schema.tenants.id }).from(schema.tenants).where(eq(schema.tenants.customDomain, hostname)).get();
  if (taken && taken.id !== tenant.id) throw conflict("Domain ini sudah dipakai toko lain");
  const h = await cf<CfHostname>(env, "", { method: "POST", body: JSON.stringify({ hostname, ssl: { method: "http", type: "dv" } }) });
  await db.update(schema.tenants).set({ customDomain: hostname, customDomainId: h.id, customDomainStatus: h.status }).where(eq(schema.tenants.id, tenant.id));
  await env.HOSTS.put(hostKey(hostname), tenant.slug);
  return view(env, h, hostname);
}

export async function domainStatus(env: Env, db: DB, tenantId: string) {
  const t = (await db.select({ host: schema.tenants.customDomain, id: schema.tenants.customDomainId, status: schema.tenants.customDomainStatus }).from(schema.tenants).where(eq(schema.tenants.id, tenantId)).get())!;
  if (!t.host) return null;
  if (!domainsEnabled(env) || !t.id) return view(env, null, t.host);
  const h = await cf<CfHostname>(env, `/${t.id}`).catch(() => null);
  if (h && h.status !== t.status) await db.update(schema.tenants).set({ customDomainStatus: h.status }).where(eq(schema.tenants.id, tenantId));
  return view(env, h, t.host);
}

export async function removeDomain(env: Env, db: DB, tenantId: string) {
  const t = (await db.select({ host: schema.tenants.customDomain, id: schema.tenants.customDomainId }).from(schema.tenants).where(eq(schema.tenants.id, tenantId)).get())!;
  if (!t.host) return;
  if (t.id && domainsEnabled(env)) await cf(env, `/${t.id}`, { method: "DELETE" }).catch((e) => console.error("cf delete", e));
  await env.HOSTS.delete(hostKey(t.host));
  await db.update(schema.tenants).set({ customDomain: null, customDomainId: null, customDomainStatus: null }).where(eq(schema.tenants.id, tenantId));
}

/** Requests on a seller's own domain: the hostname → slug map lives in KV, written only when a domain is added. */
export async function slugForHost(env: Env, hostname: string) {
  return env.HOSTS.get(hostKey(hostname.toLowerCase()), { cacheTtl: 300 });
}
