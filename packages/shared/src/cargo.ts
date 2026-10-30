export type CargoRule = { ratePerKg: number; roundG: number; minIdr: number };
export type Dimensions = { lengthCm?: number | null; widthCm?: number | null; heightCm?: number | null };

/** Air-freight volumetric weight, L×W×H/6000 in kg, returned in whole grams (rounded up). */
export function volumetricG(d: Dimensions): number {
  if (!d.lengthCm || !d.widthCm || !d.heightCm) return 0;
  return Math.ceil((d.lengthCm * d.widthCm * d.heightCm) / 6);
}

export function roundWeightUp(grams: number, stepG: number): number {
  if (grams <= 0) return 0;
  const step = Math.max(1, stepG);
  return Math.ceil(grams / step) * step;
}

/** Forwarders bill whichever is larger, actual or volumetric, then round up to their step. */
export function cargoCharge(rule: CargoRule, weightG: number, dims: Dimensions = {}) {
  const chargeableG = Math.max(weightG, volumetricG(dims));
  const billedG = roundWeightUp(chargeableG, rule.roundG);
  const byWeight = Math.ceil((billedG * rule.ratePerKg) / 1000);
  return { chargeableG, billedG, volumetric: chargeableG > weightG, amount: billedG > 0 ? Math.max(rule.minIdr, byWeight) : 0 };
}

export function formatKg(grams: number): string {
  return `${(grams / 1000).toLocaleString("id-ID", { maximumFractionDigits: 2 })} kg`;
}
