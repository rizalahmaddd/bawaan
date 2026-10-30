import { can } from "@bawaan/shared";
import { createContext, useContext } from "react";
import type { Me } from "../lib/types";

export type TenantCtx = Me["tenants"][number];
export const TenantContext = createContext<TenantCtx | null>(null);

export function useTenant() {
  const t = useContext(TenantContext);
  if (!t) throw new Error("useTenant outside seller app");
  return {
    ...t,
    base: `/api/t/${t.id}`,
    canMoney: can(t.role, t.grants, "money"),
    canReports: can(t.role, t.grants, "reports"),
    canSettings: can(t.role, t.grants, "settings"),
    canTeam: can(t.role, t.grants, "team"),
  };
}

const KEY = "bawaan.tenant";
export const rememberTenant = (id: string) => {
  try {
    localStorage.setItem(KEY, id);
  } catch {}
};
export const rememberedTenant = () => {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
};
