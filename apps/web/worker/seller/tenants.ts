import { z } from "zod";
import { checkSlug, onboardingSchema, policySchema } from "@bawaan/shared";
import { and, eq, gt } from "drizzle-orm";
import { createRouter } from "../app";
import { requireUser } from "../auth/session";
import { isUniqueViolation, schema, type DB } from "../db";
import { HttpError, body, conflict } from "../lib/http";
import { newId } from "../lib/ids";
import { acceptInvite } from "./team";

const FREE_TENANTS_PER_USER = 3;

export async function slugAvailability(db: DB, input: string) {
  const check = checkSlug(input);
  if (!check.ok) return { ok: false as const, reason: check.reason };
  const taken = await db.select({ id: schema.tenants.id }).from(schema.tenants).where(eq(schema.tenants.slug, check.slug)).get();
  if (taken) return { ok: false as const, reason: "Nama ini sudah dipakai toko lain" };
  const held = await db
    .select({ slug: schema.slugHistory.slug })
    .from(schema.slugHistory)
    .where(and(eq(schema.slugHistory.slug, check.slug), gt(schema.slugHistory.quarantineUntil, Date.now())))
    .get();
  if (held) return { ok: false as const, reason: "Nama ini baru dilepas toko lain dan belum bisa dipakai" };
  return { ok: true as const, slug: check.slug };
}

export const tenantRoutes = createRouter();
tenantRoutes.use(requireUser);

tenantRoutes.post("/invites/accept", async (c) => {
  const { token } = await body(c, z.object({ token: z.string().min(10) }));
  return c.json(await acceptInvite(c.var.db, c.var.user, token));
});

tenantRoutes.get("/slug-check", async (c) => c.json(await slugAvailability(c.var.db, c.req.query("slug") ?? "")));

tenantRoutes.post("/", async (c) => {
  const input = await body(c, onboardingSchema);
  const db = c.var.db;
  const owned = await db.select({ t: schema.memberships.tenantId }).from(schema.memberships).where(and(eq(schema.memberships.userId, c.var.user.id), eq(schema.memberships.role, "owner"))).all();
  if (owned.length >= FREE_TENANTS_PER_USER) throw conflict(`Satu akun maksimal ${FREE_TENANTS_PER_USER} toko`);
  const avail = await slugAvailability(db, input.slug);
  if (!avail.ok) throw new HttpError(422, "invalid", avail.reason);

  const id = newId("ten");
  const policy = policySchema.parse({ dpPercent: input.dpPercent, settleDays: input.settleDays });
  try {
    await db.batch([
      db.insert(schema.tenants).values({ id, slug: avail.slug, name: input.name, waNumber: input.waNumber, policyJson: JSON.stringify(policy) }),
      db.insert(schema.memberships).values({ tenantId: id, userId: c.var.user.id, role: "owner" }),
      ...(input.bank ? [db.insert(schema.bankAccounts).values({ id: newId("bnk"), tenantId: id, ...input.bank })] : []),
    ]);
  } catch (e) {
    // Two people racing for the same name: the UNIQUE index decides.
    if (isUniqueViolation(e)) throw conflict("Nama ini baru saja dipakai toko lain");
    throw e;
  }
  return c.json({ id, slug: avail.slug }, 201);
});
