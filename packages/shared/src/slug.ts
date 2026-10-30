import { z } from "zod";

export const RESERVED_SLUGS = new Set([
  "app", "api", "www", "accounts", "auth", "login", "admin", "cdn", "static", "assets", "img", "images",
  "mail", "email", "smtp", "help", "support", "status", "blog", "docs", "dev", "staging", "test", "preview", "demo",
  "billing", "pay", "payment", "payments", "invoice", "invoices", "toko", "shop", "store", "jastip", "bawaan",
  "m", "mobile", "id", "ns1", "ns2", "official", "resmi", "security", "abuse", "legal", "privacy", "terms",
]);

// Lookalike names used for phishing; matched as substrings.
export const BLOCKED_SLUG_PARTS = [
  "bca", "mandiri", "bri", "bni", "btn", "cimb", "permata", "danamon", "jenius", "jago", "seabank", "bsi",
  "dana", "ovo", "gopay", "shopeepay", "linkaja", "qris", "shopee", "tokopedia", "lazada", "blibli", "bukalapak",
  "tiktok", "instagram", "whatsapp", "google", "apple", "icloud", "paypal", "beacukai", "bea-cukai", "polri", "pajak",
];

export { isSlugShape } from "./slug-shape";

export const slugFormatSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "Minimal 3 karakter")
  .max(30, "Maksimal 30 karakter")
  .regex(/^[a-z0-9-]+$/, "Hanya huruf kecil, angka, dan tanda -")
  .regex(/^[a-z0-9].*[a-z0-9]$/, "Tidak boleh diawali atau diakhiri tanda -")
  .refine((s) => !s.includes("--"), "Tidak boleh ada -- berurutan")
  .refine((s) => !s.startsWith("xn-"), "Nama ini tidak bisa dipakai");

/** Shape plus reserved and lookalike rules. Used when a seller claims or renames a subdomain. */
export const slugSchema = slugFormatSchema
  .refine((s) => !RESERVED_SLUGS.has(s), "Nama ini dipakai sistem")
  .refine((s) => !BLOCKED_SLUG_PARTS.some((p) => s.includes(p)), "Nama ini mirip merek lain dan tidak bisa dipakai");

export type SlugCheck = { ok: true; slug: string } | { ok: false; reason: string };

export function checkSlug(input: string): SlugCheck {
  const r = slugSchema.safeParse(input);
  return r.success ? { ok: true, slug: r.data } : { ok: false, reason: r.error.issues[0]?.message ?? "Tidak valid" };
}

export function suggestSlug(storeName: string): string {
  return storeName
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30)
    .replace(/-+$/g, "");
}
