import { z } from "zod";

// Minor-unit exponent per ISO 4217. IDR is stored as whole rupiah everywhere.
const EXPONENT: Record<string, number> = {
  IDR: 0, JPY: 0, KRW: 0, VND: 0,
  USD: 2, SGD: 2, EUR: 2, GBP: 2, AUD: 2, HKD: 2, MYR: 2, THB: 2, CNY: 2, TWD: 2, SAR: 2, AED: 2,
};

export const currencySchema = z.string().regex(/^[A-Z]{3}$/).refine((c) => c in EXPONENT, "Mata uang belum didukung");
export type Currency = z.infer<typeof currencySchema>;

export const supportedCurrencies = Object.keys(EXPONENT);

export function currencyExponent(currency: string): number {
  const e = EXPONENT[currency];
  if (e === undefined) throw new Error(`Unsupported currency: ${currency}`);
  return e;
}

/** Kurs is stored as integer micro-rupiah per 1 major unit of the foreign currency. */
export const KURS_SCALE = 1_000_000n;

export function parseKurs(input: string): bigint {
  const s = input.trim().replace(/\./g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,6})?$/.test(s)) throw new Error(`Invalid kurs: ${input}`);
  const [whole = "0", frac = ""] = s.split(".");
  return BigInt(whole) * KURS_SCALE + BigInt(frac.padEnd(6, "0"));
}

export type Rounding = 1 | 100 | 500 | 1000;

/**
 * Converts a foreign minor-unit amount to rupiah, rounding up to `step`.
 * Rounding up is deliberate: rounding down makes the seller lose money on every item.
 */
export function toRupiah(amountMinor: number, currency: string, kursMicro: bigint, step: Rounding = 1): number {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) throw new Error("amountMinor must be a non-negative integer");
  const divisor = KURS_SCALE * 10n ** BigInt(currencyExponent(currency));
  const numerator = BigInt(amountMinor) * kursMicro;
  const rupiah = (numerator + divisor - 1n) / divisor;
  const s = BigInt(step);
  return Number(((rupiah + s - 1n) / s) * s);
}

export function itemPriceRupiah(input: {
  priceMinor: number;
  currency: string;
  kursMicro: bigint;
  feeRupiah: number;
  rounding?: Rounding;
}): number {
  const base = input.currency === "IDR" ? input.priceMinor : toRupiah(input.priceMinor, input.currency, input.kursMicro, input.rounding);
  return base + input.feeRupiah;
}

const groupFormat = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 });

/** "Rp 1.250.317" with a non-breaking space. Built by hand because ICU versions disagree on the space. */
export function formatRupiah(amount: number): string {
  const sign = amount < 0 ? "-" : "";
  return `${sign}Rp\u00a0${groupFormat.format(Math.abs(amount))}`;
}

export function formatForeign(amountMinor: number, currency: string): string {
  const e = currencyExponent(currency);
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency,
    minimumFractionDigits: e,
    maximumFractionDigits: e,
  }).format(amountMinor / 10 ** e);
}

/** Splits `total` across weights proportionally; remainders go to the largest shares so the sum is exact. */
export function allocateProportionally(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0) return weights.map(() => 0);
  const raw = weights.map((w) => (total * w) / sum);
  const floored = raw.map(Math.floor);
  let rest = total - floored.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => [r - Math.floor(r), i] as const).sort((a, b) => b[0] - a[0]);
  for (const [, i] of order) {
    if (rest <= 0) break;
    floored[i]! += 1;
    rest -= 1;
  }
  return floored;
}
