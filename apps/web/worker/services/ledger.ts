import { eq, sql } from "drizzle-orm";
import type { DB } from "../db";
import { schema } from "../db";
import { newId } from "../lib/ids";

/** Balance and its entry change together; the UPDATE is relative so concurrent writers can't lose money. */
export function ledgerChange(
  db: DB,
  e: { tenantId: string; customerId: string; delta: number; reason: string; refType?: string; refId?: string; actorId?: string | null },
) {
  return [
    db.insert(schema.ledgerEntries).values({
      id: newId("led"),
      tenantId: e.tenantId,
      customerId: e.customerId,
      delta: e.delta,
      reason: e.reason,
      refType: e.refType ?? null,
      refId: e.refId ?? null,
      createdBy: e.actorId ?? null,
    }),
    db
      .update(schema.customers)
      .set({ balance: sql`${schema.customers.balance} + ${e.delta}` })
      .where(eq(schema.customers.id, e.customerId)),
  ] as const;
}
