import { and, eq, inArray } from "drizzle-orm";
import type { DB } from "../db";
import { schema } from "../db";
import { newId } from "../lib/ids";
import { emailEnabled, emailHtml, sendEmail, sendWhatsApp } from "./channels";
import { loadIntegrations, type Integrations } from "./integrations";
import { orderToken } from "./orders";
import { sendEmptyPush } from "./push";

export type Message = { title: string; body: string; url: string };
type Target = { audience: "seller" | "customer"; targetId: string };

/**
 * Stores the message (the tracking page and the service worker both read it) and pings every push
 * subscription for the target. Run it inside waitUntil so the request doesn't wait on push services.
 */
export async function notify(env: Env, db: DB, targets: Target[], message: Message | ((t: Target) => Message)) {
  if (!targets.length) return;
  const rows = targets.map((t) => ({ id: newId("ntf"), ...t, ...(typeof message === "function" ? message(t) : message) }));
  for (let i = 0; i < rows.length; i += 50) await db.insert(schema.notifications).values(rows.slice(i, i + 50));
  try {
    await sendExternal(env, db, rows);
  } catch (e) {
    console.error("external notify failed", e);
  }

  for (const audience of ["seller", "customer"] as const) {
    const ids = targets.filter((t) => t.audience === audience).map((t) => t.targetId);
    if (!ids.length) continue;
    const subs = await db
      .select({ id: schema.pushSubscriptions.id, endpoint: schema.pushSubscriptions.endpoint })
      .from(schema.pushSubscriptions)
      .where(and(eq(schema.pushSubscriptions.audience, audience), inArray(schema.pushSubscriptions.targetId, ids)))
      .all();
    const results = await Promise.allSettled(subs.map((s) => sendEmptyPush(env, s.endpoint)));
    const dead = subs.filter((_, i) => results[i]?.status === "fulfilled" && (results[i] as PromiseFulfilledResult<boolean>).value === false);
    if (dead.length) await db.delete(schema.pushSubscriptions).where(inArray(schema.pushSubscriptions.id, dead.map((d) => d.id)));
  }
}

const isProd = (env: Env) => env.ENVIRONMENT === "production";

/** Email and WhatsApp need absolute links; customer links also need the order token or they won't open. */
async function linkFor(env: Env, db: DB, row: Target & Message, slug: string, tenantId: string) {
  if (!isProd(env)) return null;
  if (row.audience === "seller") return `https://app.${env.ROOT_DOMAIN}${row.url}`;
  const code = /^\/o\/([A-Z0-9-]+)/.exec(row.url)?.[1];
  const base = `https://${slug}.${env.ROOT_DOMAIN}`;
  if (!code) return `${base}${row.url}`;
  const order = await db.select().from(schema.orders).where(and(eq(schema.orders.tenantId, tenantId), eq(schema.orders.code, code))).get();
  return order ? `${base}/o/${code}?t=${await orderToken(env, order)}` : `${base}${row.url}`;
}

async function sendExternal(env: Env, db: DB, rows: Array<Target & Message & { id: string }>) {
  const customerRows = rows.filter((r) => r.audience === "customer");
  const sellerRows = rows.filter((r) => r.audience === "seller");
  if (customerRows.length) {
    const custs = await db
      .select({ id: schema.customers.id, email: schema.customers.email, phone: schema.customers.phone, tenantId: schema.customers.tenantId, slug: schema.tenants.slug, plan: schema.tenants.plan })
      .from(schema.customers)
      .innerJoin(schema.tenants, eq(schema.tenants.id, schema.customers.tenantId))
      .where(inArray(schema.customers.id, customerRows.map((r) => r.targetId)))
      .all();
    const byId = new Map(custs.map((c) => [c.id, c]));
    const wa = new Map<string, Integrations["waCloud"]>();
    for (const tenantId of new Set(custs.map((c) => c.tenantId))) wa.set(tenantId, (await loadIntegrations(env, db, tenantId)).waCloud);
    for (const r of customerRows) {
      const c = byId.get(r.targetId);
      if (!c) continue;
      const link = await linkFor(env, db, r, c.slug, c.tenantId);
      if (c.email && emailEnabled(env)) {
        await sendEmail(env, { to: c.email, subject: `${r.title}: ${r.body.slice(0, 60)}`, text: link ? `${r.body}\n\n${link}` : r.body, html: emailHtml(r.title, r.body, link, "Lihat pesanan") });
      }
      const cfg = wa.get(c.tenantId);
      if (cfg) await sendWhatsApp(cfg, c.phone, link ? `${r.body} ${link}` : r.body);
    }
  }
  if (sellerRows.length && emailEnabled(env)) {
    const members = await db
      .select({ tenantId: schema.memberships.tenantId, email: schema.users.email, slug: schema.tenants.slug })
      .from(schema.memberships)
      .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
      .innerJoin(schema.tenants, eq(schema.tenants.id, schema.memberships.tenantId))
      .where(and(inArray(schema.memberships.tenantId, sellerRows.map((r) => r.targetId)), inArray(schema.memberships.role, ["owner", "admin"])))
      .all();
    for (const r of sellerRows) {
      for (const m of members.filter((x) => x.tenantId === r.targetId)) {
        const link = await linkFor(env, db, r, m.slug, m.tenantId);
        await sendEmail(env, { to: m.email, subject: `${r.title}: ${r.body.slice(0, 60)}`, text: link ? `${r.body}\n\n${link}` : r.body, html: emailHtml(r.title, r.body, link) });
      }
    }
  }
}
