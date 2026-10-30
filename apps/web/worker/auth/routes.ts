import { parseGrants } from "@bawaan/shared";
import { and, eq, isNull, lt, ne } from "drizzle-orm";
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import { createRouter, type AppEnv } from "../app";
import { schema, type DB } from "../db";
import { base64url, fromBase64url, randomToken, sha256 } from "../lib/crypto";
import { HttpError, body } from "../lib/http";
import { newId } from "../lib/ids";
import { origins } from "../lib/origins";
import { feature } from "../lib/features";
import { isPlatformAdmin } from "../platform/billing";
import { endSession, readSession, startSession } from "./session";

const GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";
const STATE_TTL = 10 * 60_000;
const HANDOFF_TTL = 60_000;

// Browsers read "/\host" as "//host", so backslashes and control characters are refused too.
export const safeReturn = (v: string | undefined) => (v && /^\/(?![/\\])/.test(v) && !/[\\\x00-\x1f]/.test(v) ? v : "/");

/**
 * The handoff code travels in a URL, so on its own it could log a victim into someone else's
 * account. Hashing it together with a cookie set when sign-in started ties it to that browser.
 */
const bindCookie = (env: Env) => (env.ENVIRONMENT === "development" ? "oauth_bind" : "__Host-oauth_bind");

function bindBrowser<E extends AppEnv>(c: Context<E>, state: string) {
  setCookie(c, bindCookie(c.env), state, { path: "/", httpOnly: true, secure: c.env.ENVIRONMENT !== "development", sameSite: "Lax", maxAge: STATE_TTL / 1000 });
}

const handoffHash = (code: string, state: string) => sha256(`${code}.${state}`);

/** Hash to look the handoff up by, or null when this browser didn't start the sign-in. */
export async function takeHandoffHash<E extends AppEnv>(c: Context<E>, code: string) {
  const state = getCookie(c, bindCookie(c.env));
  deleteCookie(c, bindCookie(c.env), { path: "/", secure: c.env.ENVIRONMENT !== "development" });
  return state ? handoffHash(code, state) : null;
}

export const authRoutes = createRouter();

/** Shared by the seller app and store subdomains; `target` is the store slug for customer sign-in. */
export async function startGoogle<E extends AppEnv>(c: Context<E>, returnTo: string, target: string | null) {
  if (!c.env.GOOGLE_CLIENT_ID) throw new HttpError(503, "auth_unavailable", "Login Google belum dikonfigurasi");
  const state = randomToken(24);
  const verifier = randomToken(48);
  await c.var.db.insert(schema.oauthStates).values({ state, verifier, returnTo: safeReturn(returnTo), target });
  bindBrowser(c, state);
  const url = new URL(GOOGLE_AUTH);
  url.search = new URLSearchParams({
    client_id: c.env.GOOGLE_CLIENT_ID,
    redirect_uri: origins(c.env, c.req.url).accounts("/api/auth/google/callback"),
    response_type: "code",
    scope: "openid email profile",
    state,
    code_challenge: base64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))),
    code_challenge_method: "S256",
    prompt: "select_account",
  }).toString();
  return c.redirect(url.toString());
}

authRoutes.get("/google/start", (c) => startGoogle(c, c.req.query("return") ?? "/", null));

type GoogleClaims = { iss: string; aud: string; sub: string; email: string; email_verified: boolean; name?: string; picture?: string; exp: number };

authRoutes.get("/google/callback", async (c) => {
  const { code, state, error } = c.req.query();
  const appUrl = origins(c.env, c.req.url).app;
  if (error || !code || !state) return c.redirect(appUrl("/?login=batal"));

  const db = c.var.db;
  const saved = await db.delete(schema.oauthStates).where(eq(schema.oauthStates.state, state)).returning().get();
  if (!saved || Date.now() - saved.createdAt > STATE_TTL) return c.redirect(appUrl("/?login=kedaluwarsa"));
  const fail = () => c.redirect(saved.target ? origins(c.env, c.req.url).store(saved.target, "/akun?login=gagal") : appUrl("/?login=gagal"));

  const res = await fetch(GOOGLE_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: c.env.GOOGLE_CLIENT_ID,
      client_secret: c.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: origins(c.env, c.req.url).accounts("/api/auth/google/callback"),
      grant_type: "authorization_code",
      code_verifier: saved.verifier,
    }),
  });
  if (!res.ok) return fail();
  const { id_token } = await res.json<{ id_token?: string }>();
  // The token came straight from Google over TLS, so per Google's guidance the claims are enough;
  // signature checking would only cost CPU we don't have on the free plan.
  const claims = id_token ? (JSON.parse(new TextDecoder().decode(fromBase64url(id_token.split(".")[1] ?? ""))) as GoogleClaims) : null;
  if (
    !claims ||
    claims.aud !== c.env.GOOGLE_CLIENT_ID ||
    !["accounts.google.com", "https://accounts.google.com"].includes(claims.iss) ||
    claims.exp * 1000 < Date.now() ||
    !claims.email_verified
  ) {
    return fail();
  }

  const userId = await upsertUser(c.var.db, `google:${claims.sub}`, claims.email, claims.name ?? claims.email.split("@")[0]!, claims.picture ?? null);
  return handOff(c, saved, userId);
});

/** Moves the signed-in user from accounts. to the host that will own the session cookie. */
async function handOff(c: Context<AppEnv>, saved: { state: string; returnTo: string; target: string | null }, userId: string) {
  const db = c.var.db;
  const handoff = randomToken();
  await db.insert(schema.authHandoffs).values({ codeHash: await handoffHash(handoff, saved.state), userId, returnTo: saved.returnTo, target: saved.target, expiresAt: Date.now() + HANDOFF_TTL });
  await db.delete(schema.oauthStates).where(lt(schema.oauthStates.createdAt, Date.now() - STATE_TTL));
  const o = origins(c.env, c.req.url);
  const finish = new URL(saved.target ? o.store(saved.target, "/api/store/auth/finish") : o.app("/api/auth/finish"));
  finish.searchParams.set("code", handoff);
  return c.redirect(finish.toString());
}

// Sign in with Apple
const APPLE = "https://appleid.apple.com";
export const appleEnabled = (env: Env) => feature(env, "apple") && !!(env.APPLE_CLIENT_ID && env.APPLE_TEAM_ID && env.APPLE_KEY_ID && env.APPLE_PRIVATE_KEY);

/** Apple wants a short-lived ES256 JWT signed with the team's .p8 key in place of a static client secret. */
async function appleClientSecret(env: Env) {
  const pem = env.APPLE_PRIVATE_KEY!.replace(/\\n/g, "\n").replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const key = await crypto.subtle.importKey("pkcs8", fromBase64url(pem.replace(/\+/g, "-").replace(/\//g, "_")), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const enc = new TextEncoder();
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(enc.encode(JSON.stringify({ alg: "ES256", kid: env.APPLE_KEY_ID })));
  const claims = base64url(enc.encode(JSON.stringify({ iss: env.APPLE_TEAM_ID, iat: now, exp: now + 300, aud: APPLE, sub: env.APPLE_CLIENT_ID })));
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(`${header}.${claims}`));
  return `${header}.${claims}.${base64url(sig)}`;
}

export async function startApple<E extends AppEnv>(c: Context<E>, returnTo: string, target: string | null) {
  if (!appleEnabled(c.env)) throw new HttpError(503, "auth_unavailable", "Login Apple belum dikonfigurasi");
  const state = randomToken(24);
  await c.var.db.insert(schema.oauthStates).values({ state, verifier: "-", returnTo: safeReturn(returnTo), target });
  bindBrowser(c, state);
  const url = new URL(`${APPLE}/auth/authorize`);
  url.search = new URLSearchParams({
    client_id: c.env.APPLE_CLIENT_ID!,
    redirect_uri: origins(c.env, c.req.url).accounts("/api/auth/apple/callback"),
    response_type: "code",
    response_mode: "form_post",
    scope: "name email",
    state,
  }).toString();
  return c.redirect(url.toString());
}

authRoutes.get("/apple/start", (c) => startApple(c, c.req.query("return") ?? "/", null));

type AppleClaims = { iss: string; aud: string; sub: string; email?: string; email_verified?: boolean | string; exp: number };

authRoutes.post("/apple/callback", async (c) => {
  const form = await c.req.formData();
  const code = form.get("code");
  const state = form.get("state");
  const appUrl = origins(c.env, c.req.url).app;
  if (typeof code !== "string" || typeof state !== "string") return c.redirect(appUrl("/?login=batal"), 303);
  const db = c.var.db;
  const saved = await db.delete(schema.oauthStates).where(eq(schema.oauthStates.state, state)).returning().get();
  if (!saved || Date.now() - saved.createdAt > STATE_TTL) return c.redirect(appUrl("/?login=kedaluwarsa"), 303);
  const fail = () => c.redirect(saved.target ? origins(c.env, c.req.url).store(saved.target, "/akun?login=gagal") : appUrl("/?login=gagal"), 303);

  const res = await fetch(`${APPLE}/auth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: c.env.APPLE_CLIENT_ID!,
      client_secret: await appleClientSecret(c.env),
      code,
      grant_type: "authorization_code",
      redirect_uri: origins(c.env, c.req.url).accounts("/api/auth/apple/callback"),
    }),
  });
  if (!res.ok) return fail();
  const { id_token } = await res.json<{ id_token?: string }>();
  const claims = id_token ? (JSON.parse(new TextDecoder().decode(fromBase64url(id_token.split(".")[1] ?? ""))) as AppleClaims) : null;
  if (!claims || claims.iss !== APPLE || claims.aud !== c.env.APPLE_CLIENT_ID || claims.exp * 1000 < Date.now() || !claims.email) return fail();
  // Apple sends the name once, on the very first sign-in, as a separate form field.
  let name = claims.email.split("@")[0]!;
  try {
    const user = JSON.parse(String(form.get("user") ?? "null")) as { name?: { firstName?: string; lastName?: string } } | null;
    const full = [user?.name?.firstName, user?.name?.lastName].filter(Boolean).join(" ");
    if (full) name = full;
  } catch {}
  const existing = await db.select({ name: schema.users.name }).from(schema.users).where(eq(schema.users.googleSub, `apple:${claims.sub}`)).get();
  const userId = await upsertUser(db, `apple:${claims.sub}`, claims.email, existing && name === claims.email.split("@")[0] ? existing.name : name, null);
  const out = await handOff(c, saved, userId);
  return c.redirect(out.headers.get("location")!, 303);
});

authRoutes.get("/finish", async (c) => {
  const code = c.req.query("code");
  if (!code) throw new HttpError(400, "bad_request", "Kode login tidak ada");
  const hash = await takeHandoffHash(c, code);
  if (!hash) return c.redirect("/?login=gagal");
  const row = await c.var.db
    .delete(schema.authHandoffs)
    .where(and(eq(schema.authHandoffs.codeHash, hash), isNull(schema.authHandoffs.target)))
    .returning()
    .get();
  if (!row || row.expiresAt < Date.now()) return c.redirect("/?login=kedaluwarsa");
  await startSession(c, row.userId);
  return c.redirect(row.returnTo);
});

export async function upsertUser(db: DB, sub: string, email: string, name: string, avatarUrl: string | null) {
  const existing = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.googleSub, sub)).get();
  if (existing) {
    await db.update(schema.users).set({ email, name, avatarUrl }).where(eq(schema.users.id, existing.id));
    return existing.id;
  }
  const id = newId("usr");
  await db.insert(schema.users).values({ id, googleSub: sub, email, name, avatarUrl });
  return id;
}

authRoutes.post("/dev-login", async (c) => {
  if (c.env.ENVIRONMENT !== "development") throw new HttpError(404, "not_found");
  const input = await body(c, z.object({ email: z.email(), name: z.string().min(1).default("Seller Dev") }));
  const userId = await upsertUser(c.var.db, `dev:${input.email}`, input.email, input.name, null);
  await startSession(c, userId);
  return c.json({ ok: true });
});

authRoutes.post("/logout", async (c) => {
  await endSession(c);
  return c.json({ ok: true });
});

authRoutes.get("/me", async (c) => {
  const user = await readSession(c);
  if (!user) return c.json({ user: null, tenants: [], googleEnabled: !!c.env.GOOGLE_CLIENT_ID, appleEnabled: appleEnabled(c.env), devLogin: c.env.ENVIRONMENT === "development" });
  const tenants = await c.var.db
    .select({
      id: schema.tenants.id,
      slug: schema.tenants.slug,
      name: schema.tenants.name,
      role: schema.memberships.role,
      permissions: schema.memberships.permissions,
      tintColor: schema.tenants.tintColor,
      plan: schema.tenants.plan,
    })
    .from(schema.memberships)
    .innerJoin(schema.tenants, eq(schema.tenants.id, schema.memberships.tenantId))
    .where(and(eq(schema.memberships.userId, user.id), ne(schema.tenants.status, "deleted")))
    .all();
  return c.json({
    user,
    platformAdmin: isPlatformAdmin(c.env, user.email),
    appleEnabled: appleEnabled(c.env),
    tenants: tenants.map(({ permissions, ...t }) => ({ ...t, grants: parseGrants(permissions) })),
    googleEnabled: !!c.env.GOOGLE_CLIENT_ID,
    devLogin: c.env.ENVIRONMENT === "development",
  });
});
