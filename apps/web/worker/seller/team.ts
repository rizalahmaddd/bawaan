import { parseGrants } from "@bawaan/shared";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { createRouter } from "../app";
import { requirePerm } from "../auth/session";
import { schema, type DB } from "../db";
import { randomToken, sha256 } from "../lib/crypto";
import { HttpError, body, conflict, notFound } from "../lib/http";
import { newId } from "../lib/ids";
import { origins } from "../lib/origins";
import { emailEnabled, emailHtml, sendEmail } from "../services/channels";
import { auditInsert } from "../services/events";
import { assertCanAddMember } from "../services/plan";

const INVITE_DAYS = 7;
const role = z.enum(["owner", "admin", "staff"]);
const grants = z.object({ money: z.boolean().optional(), reports: z.boolean().optional() }).default({});

async function ownerCount(db: DB, tenantId: string) {
  const row = await db.select({ n: sql<number>`count(*)` }).from(schema.memberships).where(and(eq(schema.memberships.tenantId, tenantId), eq(schema.memberships.role, "owner"))).get();
  return row?.n ?? 0;
}

export function registerTeamRoutes(r: ReturnType<typeof createRouter>) {
  r.get("/:tenantId/team", async (c) => {
    const db = c.var.db;
    const [members, invites] = await Promise.all([
      db
        .select({ userId: schema.users.id, name: schema.users.name, email: schema.users.email, avatarUrl: schema.users.avatarUrl, role: schema.memberships.role, permissions: schema.memberships.permissions })
        .from(schema.memberships)
        .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
        .where(eq(schema.memberships.tenantId, c.var.tenant.id))
        .all(),
      db
        .select({ id: schema.invites.id, email: schema.invites.email, role: schema.invites.role, expiresAt: schema.invites.expiresAt, createdAt: schema.invites.createdAt })
        .from(schema.invites)
        .where(and(eq(schema.invites.tenantId, c.var.tenant.id), isNull(schema.invites.acceptedAt), gt(schema.invites.expiresAt, Date.now())))
        .orderBy(desc(schema.invites.createdAt))
        .all(),
    ]);
    return c.json({ members: members.map((m) => ({ ...m, permissions: parseGrants(m.permissions) })), invites, me: c.var.user.id });
  });

  /** No email in Phase 1–2, so the owner gets a link to send over WhatsApp. Only the invited Google account can use it. */
  r.post("/:tenantId/team/invites", requirePerm("team"), async (c) => {
    const input = await body(c, z.object({ email: z.email().transform((e) => e.toLowerCase()), role, permissions: grants }));
    const db = c.var.db;
    const already = await db
      .select({ id: schema.users.id })
      .from(schema.memberships)
      .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
      .where(and(eq(schema.memberships.tenantId, c.var.tenant.id), sql`lower(${schema.users.email}) = ${input.email}`))
      .get();
    if (already) throw conflict("Akun ini sudah ada di tim");
    await assertCanAddMember(db, c.var.tenant.id, input.role);
    const token = randomToken();
    const id = newId("inv");
    await db.batch([
      db.delete(schema.invites).where(and(eq(schema.invites.tenantId, c.var.tenant.id), eq(schema.invites.email, input.email), isNull(schema.invites.acceptedAt))),
      db.insert(schema.invites).values({
        id,
        tenantId: c.var.tenant.id,
        email: input.email,
        role: input.role,
        permissions: JSON.stringify(input.permissions),
        tokenHash: await sha256(token),
        invitedBy: c.var.user.id,
        expiresAt: Date.now() + INVITE_DAYS * 86_400_000,
      }),
      auditInsert(db, { tenantId: c.var.tenant.id, actorId: c.var.user.id, action: "team.invite", entityType: "invite", entityId: id, data: { email: input.email, role: input.role } }),
    ]);
    const link = origins(c.env, c.req.url).app(`/undangan?token=${token}`);
    let emailed = false;
    if (emailEnabled(c.env)) {
      const body = `${c.var.user.name} mengundangmu bergabung ke tim ${c.var.tenant.name} di Bawaan. Masuk dengan akun Google ${input.email} untuk menerima.`;
      emailed = await sendEmail(c.env, { to: input.email, subject: `Undangan tim ${c.var.tenant.name}`, text: `${body}\n\n${link}`, html: emailHtml("Undangan tim", body, link, "Terima undangan") });
    }
    return c.json({ id, link, emailed }, 201);
  });

  r.delete("/:tenantId/team/invites/:id", requirePerm("team"), async (c) => {
    await c.var.db.delete(schema.invites).where(and(eq(schema.invites.id, c.req.param("id")), eq(schema.invites.tenantId, c.var.tenant.id)));
    return c.json({ ok: true });
  });

  r.patch("/:tenantId/team/:userId", requirePerm("team"), async (c) => {
    const input = await body(c, z.object({ role: role.optional(), permissions: grants.optional() }));
    const db = c.var.db;
    const m = await db.select().from(schema.memberships).where(and(eq(schema.memberships.tenantId, c.var.tenant.id), eq(schema.memberships.userId, c.req.param("userId")))).get();
    if (!m) throw notFound("Anggota tim");
    if (m.role === "owner" && input.role && input.role !== "owner" && (await ownerCount(db, c.var.tenant.id)) < 2) throw conflict("Toko harus punya minimal satu pemilik");
    await db.batch([
      db
        .update(schema.memberships)
        .set({ ...(input.role ? { role: input.role } : {}), ...(input.permissions ? { permissions: JSON.stringify(input.permissions) } : {}) })
        .where(and(eq(schema.memberships.tenantId, c.var.tenant.id), eq(schema.memberships.userId, m.userId))),
      auditInsert(db, { tenantId: c.var.tenant.id, actorId: c.var.user.id, action: "team.update", entityType: "member", entityId: m.userId, data: input }),
    ]);
    return c.json({ ok: true });
  });

  /** Owners remove anyone; everyone else can only leave. The last owner can't go. */
  r.delete("/:tenantId/team/:userId", async (c) => {
    const db = c.var.db;
    const target = c.req.param("userId");
    if (target !== c.var.user.id && c.var.tenant.role !== "owner") throw new HttpError(403, "forbidden", "Kamu tidak punya akses untuk ini");
    const m = await db.select().from(schema.memberships).where(and(eq(schema.memberships.tenantId, c.var.tenant.id), eq(schema.memberships.userId, target))).get();
    if (!m) throw notFound("Anggota tim");
    if (m.role === "owner" && (await ownerCount(db, c.var.tenant.id)) < 2) throw conflict("Tambahkan pemilik lain dulu sebelum keluar");
    await db.batch([
      db.delete(schema.memberships).where(and(eq(schema.memberships.tenantId, c.var.tenant.id), eq(schema.memberships.userId, target))),
      auditInsert(db, { tenantId: c.var.tenant.id, actorId: c.var.user.id, action: "team.remove", entityType: "member", entityId: target }),
    ]);
    return c.json({ ok: true });
  });
}

/** Lives under /api/tenants because the invitee isn't a member of the store yet. */
export async function acceptInvite(db: DB, user: { id: string; email: string }, token: string) {
  const inv = await db.select().from(schema.invites).where(eq(schema.invites.tokenHash, await sha256(token))).get();
  if (!inv || inv.acceptedAt || inv.expiresAt < Date.now()) throw new HttpError(404, "not_found", "Undangan tidak berlaku atau sudah dipakai");
  if (inv.email.toLowerCase() !== user.email.toLowerCase()) throw new HttpError(403, "forbidden", `Undangan ini untuk ${inv.email}. Masuk dengan akun Google itu.`);
  const tenant = (await db.select({ id: schema.tenants.id, name: schema.tenants.name }).from(schema.tenants).where(eq(schema.tenants.id, inv.tenantId)).get())!;
  await assertCanAddMember(db, inv.tenantId, inv.role);
  await db.batch([
    db
      .insert(schema.memberships)
      .values({ tenantId: inv.tenantId, userId: user.id, role: inv.role, permissions: inv.permissions })
      .onConflictDoUpdate({ target: [schema.memberships.tenantId, schema.memberships.userId], set: { role: inv.role, permissions: inv.permissions } }),
    db.update(schema.invites).set({ acceptedAt: Date.now() }).where(eq(schema.invites.id, inv.id)),
    auditInsert(db, { tenantId: inv.tenantId, actorId: user.id, action: "team.join", entityType: "member", entityId: user.id, data: { role: inv.role } }),
  ]);
  return { tenantId: tenant.id, name: tenant.name };
}
