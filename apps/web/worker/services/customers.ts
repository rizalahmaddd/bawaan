import { and, eq } from "drizzle-orm";
import type { DB } from "../db";
import { schema } from "../db";
import { conflict, notFound } from "../lib/http";
import { auditInsert } from "./events";
import { ledgerChange } from "./ledger";

/**
 * Folds a duplicate customer (usually a second phone number) into another. The duplicate row stays
 * so its phone keeps resolving to the surviving customer on the next checkout.
 */
export async function mergeCustomers(db: DB, tenantId: string, fromId: string, intoId: string, actorId: string) {
  if (fromId === intoId) throw conflict("Pilih pelanggan lain");
  const [from, into] = await Promise.all(
    [fromId, intoId].map((id) => db.select().from(schema.customers).where(and(eq(schema.customers.id, id), eq(schema.customers.tenantId, tenantId))).get()),
  );
  if (!from || !into) throw notFound("Pelanggan");
  if (from.mergedInto || into.mergedInto) throw conflict("Pelanggan ini sudah digabung sebelumnya");
  await db.batch([
    db.update(schema.orders).set({ customerId: into.id }).where(and(eq(schema.orders.tenantId, tenantId), eq(schema.orders.customerId, from.id))),
    db.update(schema.invoices).set({ customerId: into.id }).where(and(eq(schema.invoices.tenantId, tenantId), eq(schema.invoices.customerId, from.id))),
    db.update(schema.payments).set({ customerId: into.id }).where(and(eq(schema.payments.tenantId, tenantId), eq(schema.payments.customerId, from.id))),
    db.update(schema.ledgerEntries).set({ customerId: into.id }).where(and(eq(schema.ledgerEntries.tenantId, tenantId), eq(schema.ledgerEntries.customerId, from.id))),
    db.update(schema.addresses).set({ customerId: into.id }).where(and(eq(schema.addresses.tenantId, tenantId), eq(schema.addresses.customerId, from.id))),
    db.update(schema.deliveries).set({ customerId: into.id }).where(and(eq(schema.deliveries.tenantId, tenantId), eq(schema.deliveries.customerId, from.id))),
    db.update(schema.parcels).set({ customerId: into.id }).where(and(eq(schema.parcels.tenantId, tenantId), eq(schema.parcels.customerId, from.id))),
    db
      .update(schema.customers)
      .set({
        mergedInto: into.id,
        balance: 0,
        notes: [from.notes, `Digabung ke ${into.name}`].filter(Boolean).join("\n"),
      })
      .where(eq(schema.customers.id, from.id)),
    db
      .update(schema.customers)
      .set({
        notes: [into.notes, `Nomor lain: ${from.phone}`].filter(Boolean).join("\n"),
        email: into.email ?? from.email,
        userId: into.userId ?? from.userId,
        tags: [...new Set([...(into.tags ?? "").split(","), ...(from.tags ?? "").split(",")].map((t) => t.trim()).filter(Boolean))].join(", ") || null,
      })
      .where(eq(schema.customers.id, into.id)),
    ...(from.balance
      ? ledgerChange(db, { tenantId, customerId: into.id, delta: from.balance, reason: `Saldo dari ${from.name} (${from.phone})`, refType: "customer", refId: from.id, actorId })
      : []),
    auditInsert(db, { tenantId, actorId, action: "customer.merge", entityType: "customer", entityId: into.id, data: { from: from.id } }),
  ]);
}
