import { and, eq, inArray, sql } from "drizzle-orm";
import type { DB } from "../db";
import { schema } from "../db";
import { newId } from "../lib/ids";

export type InvoiceLine = { label: string; qty?: number; unit?: number; amount: number };
export type InvoiceType = "dp" | "full" | "settlement" | "domestic" | "adjustment" | "cargo" | "combined";

const OPEN = ["open", "partially_paid"] as const;

export async function nextInvoiceNumber(db: DB, tenantId: string, at = new Date()): Promise<string> {
  const yyyy = at.getUTCFullYear();
  const mm = String(at.getUTCMonth() + 1).padStart(2, "0");
  const row = await db
    .insert(schema.counters)
    .values({ tenantId, name: `inv-${yyyy}${mm}`, value: 1 })
    .onConflictDoUpdate({ target: [schema.counters.tenantId, schema.counters.name], set: { value: sql`${schema.counters.value} + 1` } })
    .returning({ value: schema.counters.value })
    .get();
  return `INV/${yyyy}/${mm}/${String(row.value).padStart(4, "0")}`;
}

/** 1–999 added to the amount so a bank mutation points at exactly one open invoice. */
export async function pickUniqueCode(db: DB, tenantId: string): Promise<number> {
  const used = new Set(
    (
      await db
        .select({ code: schema.invoices.uniqueCode })
        .from(schema.invoices)
        .where(and(eq(schema.invoices.tenantId, tenantId), inArray(schema.invoices.status, [...OPEN])))
        .all()
    ).map((r) => r.code),
  );
  for (let i = 0; i < 20; i++) {
    const code = 1 + (crypto.getRandomValues(new Uint16Array(1))[0]! % 999);
    if (!used.has(code)) return code;
  }
  return 0;
}

export async function createInvoice(
  db: DB,
  input: {
    tenantId: string;
    customerId: string;
    orderId: string | null;
    type: InvoiceType;
    lines: InvoiceLine[];
    dueAt: number | null;
    uniqueCode: boolean;
    note?: string;
    shipmentId?: string | null;
  },
) {
  const amount = input.lines.reduce((s, l) => s + l.amount, 0);
  const row = {
    id: newId("inv"),
    tenantId: input.tenantId,
    number: await nextInvoiceNumber(db, input.tenantId),
    customerId: input.customerId,
    orderId: input.orderId,
    type: input.type,
    amount,
    uniqueCode: input.uniqueCode && amount > 0 ? await pickUniqueCode(db, input.tenantId) : 0,
    dueAt: input.dueAt,
    lines: JSON.stringify(input.lines),
    note: input.note ?? null,
    shipmentId: input.shipmentId ?? null,
  };
  await db.insert(schema.invoices).values(row);
  return { ...row, paid: 0, status: "open" as const, combinedInto: null };
}

export const totalDue = (inv: { amount: number; uniqueCode: number }) => inv.amount + inv.uniqueCode;
export const remaining = (inv: { amount: number; uniqueCode: number; paid: number }) => Math.max(0, totalDue(inv) - inv.paid);

export function statusAfterPayment(inv: { amount: number; uniqueCode: number }, paid: number) {
  return paid >= totalDue(inv) ? ("paid" as const) : paid > 0 ? ("partially_paid" as const) : ("open" as const);
}
