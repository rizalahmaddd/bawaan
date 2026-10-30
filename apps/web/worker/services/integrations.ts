import { eq } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "../db";
import { schema } from "../db";
import { appSecret } from "../lib/crypto";
import { feature } from "../lib/features";
import { HttpError } from "../lib/http";
import { seal, unseal } from "../lib/secrets";

export const integrationsSchema = z.object({
  xendit: z.object({ secretKey: z.string().min(10).max(200), callbackToken: z.string().min(10).max(200) }).nullable().optional(),
  waCloud: z
    .object({
      phoneNumberId: z.string().regex(/^\d{5,30}$/, "Phone number ID berupa angka"),
      accessToken: z.string().min(20).max(1000),
      templateName: z.string().regex(/^[a-z0-9_]{1,512}$/, "Nama template huruf kecil, angka, garis bawah"),
      language: z.string().min(2).max(10).default("id"),
    })
    .nullable()
    .optional(),
});
export type Integrations = z.infer<typeof integrationsSchema>;

export async function loadIntegrations(env: Env, db: DB, tenantId: string): Promise<Integrations> {
  const row = await db.select({ s: schema.tenants.integrationsSealed }).from(schema.tenants).where(eq(schema.tenants.id, tenantId)).get();
  const all = (await unseal<Integrations>(appSecret(env), row?.s)) ?? {};
  // Credentials saved before a feature was switched off stay sealed in D1 but are ignored.
  return { xendit: feature(env, "qris") ? all.xendit : undefined, waCloud: feature(env, "wa_cloud") ? all.waCloud : undefined };
}

export const integrationFeatures = (env: Env) => ({ qris: feature(env, "qris"), waCloud: feature(env, "wa_cloud") });

export async function saveIntegrations(env: Env, db: DB, tenantId: string, patch: Integrations) {
  if ((patch.xendit !== undefined && !feature(env, "qris")) || (patch.waCloud !== undefined && !feature(env, "wa_cloud"))) {
    throw new HttpError(404, "not_found", "Fitur ini belum tersedia");
  }
  const row = await db.select({ s: schema.tenants.integrationsSealed }).from(schema.tenants).where(eq(schema.tenants.id, tenantId)).get();
  const current = (await unseal<Integrations>(appSecret(env), row?.s)) ?? {};
  const next = { ...current, ...patch };
  await db.update(schema.tenants).set({ integrationsSealed: await seal(appSecret(env), next) }).where(eq(schema.tenants.id, tenantId));
  return next;
}

/** What the settings screen may see: whether something is connected, never the secrets themselves. */
export function describeIntegrations(i: Integrations) {
  return {
    xendit: i.xendit ? { connected: true, keyHint: `…${i.xendit.secretKey.slice(-4)}` } : { connected: false },
    waCloud: i.waCloud ? { connected: true, phoneNumberId: i.waCloud.phoneNumberId, templateName: i.waCloud.templateName } : { connected: false },
  };
}
