import { parsePolicy, formatRupiah } from "@bawaan/shared";
import { and, eq, gt, inArray, isNotNull, isNull, lt, lte, sql } from "drizzle-orm";
import { getDb, schema, type DB } from "./db";
import { eventInsert } from "./services/events";
import { notify } from "./services/notify";
import { respondApproval } from "./services/orders";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Hourly housekeeping. Each step is independent so one failure doesn't block the rest. */
export async function runCron(env: Env, now = Date.now()) {
  const db = getDb(env);
  const steps = [expireApprovals, expireUnpaidDp, forfeitUnpaidSettlements, remindSettlements, remindPlanRenewal, finishDeletions, cleanup];
  const results: Record<string, unknown> = {};
  for (const step of steps) {
    try {
      results[step.name] = await step(db, env, now);
    } catch (e) {
      console.error(`cron ${step.name} failed`, e);
      results[step.name] = "error";
    }
  }
  return results;
}

/** No answer by the deadline counts as "no": we never charge a higher price without a yes. */
async function expireApprovals(db: DB, env: Env, now: number) {
  const items = await db
    .select({ id: schema.orderItems.id, orderId: schema.orderItems.orderId, tenantId: schema.orderItems.tenantId })
    .from(schema.orderItems)
    .where(and(eq(schema.orderItems.status, "needs_approval"), isNotNull(schema.orderItems.approvalDeadline), lt(schema.orderItems.approvalDeadline, now)))
    .limit(200)
    .all();
  for (const i of items) await respondApproval(db, env, i.tenantId, i.orderId, i.id, false);
  return items.length;
}

/** DP never paid a day after its due date: free the PO slot. */
async function expireUnpaidDp(db: DB, _env: Env, now: number) {
  const invs = await db
    .select()
    .from(schema.invoices)
    .where(and(inArray(schema.invoices.type, ["dp", "full"]), eq(schema.invoices.status, "open"), eq(schema.invoices.paid, 0), isNull(schema.invoices.combinedInto), lt(schema.invoices.dueAt, now - DAY)))
    .limit(200)
    .all();
  for (const inv of invs) {
    if (!inv.orderId) continue;
    const items = await db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, inv.orderId)).all();
    await db.batch([
      db.update(schema.invoices).set({ status: "expired" }).where(eq(schema.invoices.id, inv.id)),
      db.update(schema.orders).set({ status: "cancelled", closedAt: now, closeReason: "DP tidak dibayar" }).where(and(eq(schema.orders.id, inv.orderId), eq(schema.orders.status, "active"))),
      db.update(schema.orderItems).set({ status: "cancelled" }).where(and(eq(schema.orderItems.orderId, inv.orderId), eq(schema.orderItems.status, "awaiting_dp"))),
      eventInsert(db, { tenantId: inv.tenantId, entityType: "order", entityId: inv.orderId, status: "cancelled", message: "Dibatalkan otomatis karena DP tidak dibayar" }),
    ]);
    for (const i of items.filter((x) => x.productId && x.status === "awaiting_dp")) {
      await db.update(schema.products).set({ reserved: sql`max(0, ${schema.products.reserved} - ${i.qty})` }).where(eq(schema.products.id, i.productId!));
    }
  }
  return invs.length;
}

/** Settlement past due: per store policy the DP is kept and the goods become ready stock. */
async function forfeitUnpaidSettlements(db: DB, env: Env, now: number) {
  const rows = await db
    .select({ inv: schema.invoices, policy: schema.tenants.policyJson, tenantName: schema.tenants.name, code: schema.orders.code })
    .from(schema.invoices)
    .innerJoin(schema.tenants, eq(schema.tenants.id, schema.invoices.tenantId))
    .innerJoin(schema.orders, eq(schema.orders.id, schema.invoices.orderId))
    .where(and(eq(schema.invoices.type, "settlement"), inArray(schema.invoices.status, ["open", "partially_paid"]), isNull(schema.invoices.combinedInto), lt(schema.invoices.dueAt, now)))
    .limit(200)
    .all();
  let forfeited = 0;
  for (const { inv, policy, tenantName, code } of rows) {
    if (!parsePolicy(policy).forfeitOnExpiry || !inv.orderId) continue;
    await db.batch([
      db.update(schema.invoices).set({ status: "expired" }).where(eq(schema.invoices.id, inv.id)),
      db
        .update(schema.orderItems)
        .set({ status: "forfeited" })
        .where(and(eq(schema.orderItems.orderId, inv.orderId), inArray(schema.orderItems.status, ["obtained", "partial"]), sql`${schema.orderItems.deliveryId} is null`)),
      db.update(schema.orders).set({ status: "cancelled", closedAt: now, closeReason: "Tidak dilunasi sampai batas waktu" }).where(eq(schema.orders.id, inv.orderId)),
      eventInsert(db, { tenantId: inv.tenantId, entityType: "order", entityId: inv.orderId, status: "forfeited", message: "Pelunasan lewat batas waktu, DP hangus sesuai kebijakan toko" }),
    ]);
    await notify(env, db, [{ audience: "seller", targetId: inv.tenantId }], { title: "Pesanan hangus", body: `${code}: pelunasan lewat batas, barang jadi ready stock.`, url: `/pesanan/${inv.orderId}` });
    await notify(env, db, [{ audience: "customer", targetId: inv.customerId }], { title: tenantName, body: `Pesanan ${code} dibatalkan karena pelunasan lewat batas waktu.`, url: `/o/${code}` });
    forfeited++;
  }
  return forfeited;
}

/** One reminder a day before the deadline. The hourly window makes it fire exactly once. */
async function remindSettlements(db: DB, env: Env, now: number) {
  const rows = await db
    .select({ inv: schema.invoices, tenantName: schema.tenants.name, code: schema.orders.code })
    .from(schema.invoices)
    .innerJoin(schema.tenants, eq(schema.tenants.id, schema.invoices.tenantId))
    .innerJoin(schema.orders, eq(schema.orders.id, schema.invoices.orderId))
    .where(and(inArray(schema.invoices.status, ["open", "partially_paid"]), isNull(schema.invoices.combinedInto), gt(schema.invoices.dueAt, now + 23 * HOUR), lte(schema.invoices.dueAt, now + 24 * HOUR)))
    .all();
  for (const { inv, tenantName, code } of rows) {
    await notify(env, db, [{ audience: "customer", targetId: inv.customerId }], {
      title: tenantName,
      body: `Pengingat: tagihan ${code} ${formatRupiah(inv.amount + inv.uniqueCode - inv.paid)} jatuh tempo besok.`,
      url: `/o/${code}`,
    });
  }
  return rows.length;
}

/** Three days before Pro runs out, once (the hourly window makes it fire exactly once). */
async function remindPlanRenewal(db: DB, env: Env, now: number) {
  const rows = await db
    .select({ id: schema.tenants.id })
    .from(schema.tenants)
    .where(and(eq(schema.tenants.plan, "pro"), gt(schema.tenants.planUntil, now + 71 * HOUR), lte(schema.tenants.planUntil, now + 72 * HOUR)))
    .all();
  for (const t of rows) {
    await notify(env, db, [{ audience: "seller", targetId: t.id }], { title: "Paket Pro hampir habis", body: "Paket Pro tokomu berakhir 3 hari lagi. Perpanjang supaya trip dan staf tetap aktif.", url: "/paket" });
  }
  return rows.length;
}

/**
 * Deletion runs in two steps: after the 7-day grace the store closes for good and its name is held
 * for 180 days; after 30 days customer personal data is wiped. Money records stay for the books.
 */
async function finishDeletions(db: DB, _env: Env, now: number) {
  const due = await db
    .select()
    .from(schema.tenants)
    .where(
      and(
        isNotNull(schema.tenants.deletedAt),
        lt(schema.tenants.deletedAt, now - 7 * DAY),
        inArray(schema.tenants.status, ["readonly", "deleted"]),
        sql`coalesce(${schema.tenants.statusReason}, '') != 'purged'`,
      ),
    )
    .limit(20)
    .all();
  let done = 0;
  for (const t of due) {
    if (t.status === "readonly") {
      await db.batch([
        db
          .insert(schema.slugHistory)
          .values({ slug: t.slug, tenantId: t.id, releasedAt: now, redirectUntil: now, quarantineUntil: now + 180 * DAY })
          .onConflictDoUpdate({ target: schema.slugHistory.slug, set: { tenantId: t.id, releasedAt: now, redirectUntil: now, quarantineUntil: now + 180 * DAY } }),
        db.update(schema.tenants).set({ status: "deleted", slug: `deleted-${t.id.toLowerCase()}`, customDomain: null }).where(eq(schema.tenants.id, t.id)),
        db.delete(schema.pushSubscriptions).where(eq(schema.pushSubscriptions.tenantId, t.id)),
      ]);
      if (t.customDomain) await _env.HOSTS.delete(`host:${t.customDomain}`);
      done++;
    } else if (t.deletedAt! < now - 30 * DAY && t.statusReason !== "purged") {
      await db.batch([
        db.update(schema.customers).set({ name: "Dihapus", phone: sql`'deleted:' || ${schema.customers.id}`, email: null, notes: null, userId: null }).where(eq(schema.customers.tenantId, t.id)),
        db.delete(schema.addresses).where(eq(schema.addresses.tenantId, t.id)),
        db.update(schema.deliveries).set({ addressSnapshot: null }).where(eq(schema.deliveries.tenantId, t.id)),
        db.delete(schema.waitlist).where(eq(schema.waitlist.tenantId, t.id)),
        db.update(schema.tenants).set({ statusReason: "purged", integrationsSealed: null }).where(eq(schema.tenants.id, t.id)),
      ]);
      done++;
    }
  }
  return done;
}

async function cleanup(db: DB, _env: Env, now: number) {
  await db.batch([
    db.delete(schema.idempotency).where(lt(schema.idempotency.createdAt, now - 2 * DAY)),
    db.delete(schema.oauthStates).where(lt(schema.oauthStates.createdAt, now - DAY)),
    db.delete(schema.authHandoffs).where(lt(schema.authHandoffs.expiresAt, now)),
    db.delete(schema.sessions).where(lt(schema.sessions.expiresAt, now)),
    db.delete(schema.notifications).where(lt(schema.notifications.createdAt, now - 60 * DAY)),
    db.update(schema.gatewayCharges).set({ status: "expired" }).where(and(eq(schema.gatewayCharges.status, "pending"), lt(schema.gatewayCharges.expiresAt, now))),
  ]);
  return "ok";
}
