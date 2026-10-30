import type { DB } from "../db";
import { schema } from "../db";
import { newId } from "../lib/ids";

type EventInput = {
  tenantId: string;
  entityType: "order" | "item" | "shipment" | "delivery" | "invoice" | "payment";
  entityId: string;
  status: string;
  message?: string | null;
  photoKey?: string | null;
  visibility?: "public" | "internal";
  actorId?: string | null;
};

/** Returns the insert so callers can put it in the same D1 batch as the change it describes. */
export function eventInsert(db: DB, e: EventInput) {
  return db.insert(schema.statusEvents).values({ id: newId("evt"), visibility: "public", ...e });
}

export function auditInsert(db: DB, a: { tenantId: string; actorId: string | null; action: string; entityType: string; entityId: string; data?: unknown }) {
  return db.insert(schema.auditLog).values({
    id: newId("aud"),
    tenantId: a.tenantId,
    actorId: a.actorId,
    action: a.action,
    entityType: a.entityType,
    entityId: a.entityId,
    data: a.data === undefined ? null : JSON.stringify(a.data),
  });
}
