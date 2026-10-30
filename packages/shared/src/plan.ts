export type PlanId = "free" | "pro";

export const PRO_PRICE_IDR = 49_000;

export const PLAN_LIMITS: Record<PlanId, { activeTrips: number; itemsPerMonth: number; staff: number; branding: boolean; customDomain: boolean }> = {
  free: { activeTrips: 1, itemsPerMonth: 100, staff: 0, branding: true, customDomain: false },
  pro: { activeTrips: Number.POSITIVE_INFINITY, itemsPerMonth: Number.POSITIVE_INFINITY, staff: 5, branding: false, customDomain: true },
};

export const PLAN_LABEL: Record<PlanId, string> = { free: "Gratis", pro: "Pro" };

/** Pro lapses back to Gratis when its paid period ends; nothing is deleted. */
export function effectivePlan(plan: string, planUntil: number | null | undefined, now = Date.now()): PlanId {
  if (plan === "pro" && (planUntil === null || planUntil === undefined || planUntil > now)) return "pro";
  return "free";
}
