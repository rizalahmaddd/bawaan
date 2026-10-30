import { can, parseGrants, type Permission } from "@bawaan/shared";
import { and, eq, gt } from "drizzle-orm";
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import type { AppEnv, SessionUser } from "../app";
import type { DB } from "../db";
import { schema } from "../db";
import { randomToken, sha256 } from "../lib/crypto";
import { HttpError } from "../lib/http";

const DAY = 86_400_000;
const SESSION_DAYS = 30;

// __Host- cookies must be Secure, and WebKit won't store Secure cookies on http://localhost.
const cookieName = (env: Env) => (env.ENVIRONMENT === "development" ? "sid" : "__Host-sid");

export async function startSession<E extends AppEnv>(c: Context<E>, userId: string) {
  const raw = randomToken();
  await c.var.db.insert(schema.sessions).values({ idHash: await sha256(raw), userId, expiresAt: Date.now() + SESSION_DAYS * DAY });
  setCookie(c, cookieName(c.env), raw, {
    path: "/",
    httpOnly: true,
    secure: c.env.ENVIRONMENT !== "development",
    sameSite: "Lax",
    maxAge: SESSION_DAYS * 86_400,
  });
}

export async function endSession<E extends AppEnv>(c: Context<E>) {
  const raw = getCookie(c, cookieName(c.env));
  if (raw) await c.var.db.delete(schema.sessions).where(eq(schema.sessions.idHash, await sha256(raw)));
  deleteCookie(c, cookieName(c.env), { path: "/", secure: c.env.ENVIRONMENT !== "development" });
}

export async function readSession<E extends AppEnv>(c: Context<E>): Promise<SessionUser | null> {
  const raw = getCookie(c, cookieName(c.env));
  if (!raw) return null;
  return lookup(c.var.db, await sha256(raw));
}

async function lookup(db: DB, idHash: string): Promise<SessionUser | null> {
  const row = await db
    .select({ user: schema.users, expiresAt: schema.sessions.expiresAt })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .where(and(eq(schema.sessions.idHash, idHash), gt(schema.sessions.expiresAt, Date.now())))
    .get();
  if (!row) return null;
  // Slide the expiry at most once a day so a busy seller doesn't cost a write per request.
  if (row.expiresAt - Date.now() < (SESSION_DAYS - 1) * DAY) {
    await db.update(schema.sessions).set({ expiresAt: Date.now() + SESSION_DAYS * DAY }).where(eq(schema.sessions.idHash, idHash));
  }
  const { id, email, name, avatarUrl } = row.user;
  return { id, email, name, avatarUrl };
}

export const requireUser = createMiddleware<AppEnv>(async (c, next) => {
  const user = await readSession(c);
  if (!user) throw new HttpError(401, "unauthenticated", "Silakan masuk dulu");
  c.set("user", user);
  await next();
});

/** Loads the tenant from :tenantId and checks the signed-in user belongs to it. */
export const requireTenant = (roles: Array<"owner" | "admin" | "staff"> = ["owner", "admin", "staff"]) =>
  createMiddleware<AppEnv>(async (c, next) => {
    const tenantId = c.req.param("tenantId");
    if (!tenantId) throw new HttpError(400, "bad_request", "Toko tidak dikenal");
    const row = await c.var.db
      .select({
        id: schema.tenants.id,
        slug: schema.tenants.slug,
        name: schema.tenants.name,
        role: schema.memberships.role,
        permissions: schema.memberships.permissions,
        status: schema.tenants.status,
      })
      .from(schema.memberships)
      .innerJoin(schema.tenants, eq(schema.tenants.id, schema.memberships.tenantId))
      .where(and(eq(schema.memberships.tenantId, tenantId), eq(schema.memberships.userId, c.var.user.id)))
      .get();
    if (!row || row.status === "deleted") throw new HttpError(404, "not_found", "Toko tidak ditemukan");
    if (!roles.includes(row.role)) throw new HttpError(403, "forbidden", "Kamu tidak punya akses untuk ini");
    c.set("tenant", { id: row.id, slug: row.slug, name: row.name, role: row.role, grants: parseGrants(row.permissions) });
    await next();
  });

export const requirePerm = (perm: Permission) =>
  createMiddleware<AppEnv>(async (c, next) => {
    if (!can(c.var.tenant.role, c.var.tenant.grants, perm)) throw new HttpError(403, "forbidden", "Kamu tidak punya akses untuk ini");
    await next();
  });

export const requireRole = (...roles: Array<"owner" | "admin" | "staff">) =>
  createMiddleware<AppEnv>(async (c, next) => {
    if (!roles.includes(c.var.tenant.role)) throw new HttpError(403, "forbidden", "Kamu tidak punya akses untuk ini");
    await next();
  });
