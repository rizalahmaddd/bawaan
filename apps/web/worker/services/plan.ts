import { PLAN_LIMITS, effectivePlan, type PlanId } from "@bawaan/shared";
import { and, eq, gte, inArray, ne, sql } from "drizzle-orm";
import type { DB } from "../db";
import { schema } from "../db";
import { HttpError } from "../lib/http";

const monthStart = (now = new Date()) => Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);

export async function planOf(db: DB, tenantId: string): Promise<PlanId> {
  const t = await db.select({ plan: schema.tenants.plan, until: schema.tenants.planUntil }).from(schema.tenants).where(eq(schema.tenants.id, tenantId)).get();
  return effectivePlan(t?.plan ?? "free", t?.until);
}

export async function usage(db: DB, tenantId: string) {
  const [trips, items, staff] = await Promise.all([
    db.select({ n: sql<number>`count(*)` }).from(schema.trips).where(and(eq(schema.trips.tenantId, tenantId), eq(schema.trips.status, "open"), eq(schema.trips.kind, "po"))).get(),
    db
      .select({ n: sql<number>`coalesce(sum(${schema.orderItems.qty}), 0)` })
      .from(schema.orderItems)
      .where(and(eq(schema.orderItems.tenantId, tenantId), gte(schema.orderItems.createdAt, monthStart()), ne(schema.orderItems.status, "cancelled")))
      .get(),
    db.select({ n: sql<number>`count(*)` }).from(schema.memberships).where(and(eq(schema.memberships.tenantId, tenantId), inArray(schema.memberships.role, ["admin", "staff"]))).get(),
  ]);
  return { activeTrips: trips?.n ?? 0, itemsThisMonth: items?.n ?? 0, staff: staff?.n ?? 0 };
}

export async function planStatus(db: DB, tenantId: string) {
  const [plan, used] = await Promise.all([planOf(db, tenantId), usage(db, tenantId)]);
  const limits = PLAN_LIMITS[plan];
  const ratio = Number.isFinite(limits.itemsPerMonth) ? used.itemsThisMonth / limits.itemsPerMonth : 0;
  return { plan, limits: { ...limits, activeTrips: Number.isFinite(limits.activeTrips) ? limits.activeTrips : null, itemsPerMonth: Number.isFinite(limits.itemsPerMonth) ? limits.itemsPerMonth : null }, used, warn: ratio >= 0.8 };
}

const upgrade = (message: string) => new HttpError(402, "plan_limit", message);

/** Soft limits: existing data always stays reachable; only new trips, orders and seats are held back. */
export async function assertCanOpenTrip(db: DB, tenantId: string, tripId: string) {
  const plan = await planOf(db, tenantId);
  const limit = PLAN_LIMITS[plan].activeTrips;
  if (!Number.isFinite(limit)) return;
  const open = await db
    .select({ n: sql<number>`count(*)` })
    .from(schema.trips)
    .where(and(eq(schema.trips.tenantId, tenantId), eq(schema.trips.status, "open"), eq(schema.trips.kind, "po"), ne(schema.trips.id, tripId)))
    .get();
  if ((open?.n ?? 0) >= limit) throw upgrade(`Paket Gratis hanya bisa membuka ${limit} trip sekaligus. Tutup trip lain atau upgrade ke Pro.`);
}

export async function assertCanTakeItems(db: DB, tenantId: string, qty: number) {
  const plan = await planOf(db, tenantId);
  const limit = PLAN_LIMITS[plan].itemsPerMonth;
  if (!Number.isFinite(limit)) return;
  const { itemsThisMonth } = await usage(db, tenantId);
  if (itemsThisMonth + qty > limit) throw upgrade("Toko ini sedang tidak bisa menerima pesanan baru bulan ini. Hubungi seller lewat WhatsApp.");
}

export async function assertCanAddMember(db: DB, tenantId: string, role: string) {
  if (role === "owner") return;
  const plan = await planOf(db, tenantId);
  const { staff } = await usage(db, tenantId);
  if (staff >= PLAN_LIMITS[plan].staff) throw upgrade(plan === "free" ? "Tambah staf atau admin butuh paket Pro." : `Paket Pro maksimal ${PLAN_LIMITS.pro.staff} staf.`);
}
