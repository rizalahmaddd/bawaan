import { z } from "zod";

export const DEFAULT_POLICY_TEXT = [
  "DP 50% dibayar setelah pesanan dikonfirmasi. Barang baru dicarikan setelah DP masuk.",
  "Kalau barang tidak dapat, DP untuk barang itu dikembalikan penuh, ke saldo atau ke rekeningmu (sesuai pilihan saat pesan).",
  "Kalau barang dapat, pelunasan paling lambat 3 hari sejak status berubah jadi Dapat. Kami kirim pengingat sebelum batas waktu.",
  "Kalau sampai batas waktu belum lunas, pesanan dianggap batal: DP tidak dikembalikan dan barang dijual sebagai ready stock.",
  "Butuh waktu tambahan? Hubungi kami sebelum batas waktu.",
].join("\n");

export const TEMPLATE_KEYS = ["confirmed", "dp", "settlement", "reminder", "approval", "shipment", "delivery"] as const;
export type TemplateKey = (typeof TEMPLATE_KEYS)[number];

export const DEFAULT_TEMPLATES: Record<TemplateKey, string> = {
  confirmed: "Halo Kak {nama}, pesanan {kode} sudah kami konfirmasi. Total sementara {total}. Pantau status barangnya di sini: {link}",
  dp: "Halo Kak {nama}, tagihan DP pesanan {kode} sebesar {tagihan} ya. Detail & cara bayar: {link}",
  settlement: "Halo Kak {nama}, barang pesanan {kode} sudah ada hasilnya. Sisa pelunasan {tagihan}, paling lambat {batas}. Detail: {link}",
  reminder: "Halo Kak {nama}, pengingat pelunasan pesanan {kode} sebesar {tagihan}, batasnya {batas}. Detail: {link}",
  approval: "Halo Kak {nama}, ada barang di pesanan {kode} yang butuh persetujuanmu. Cek di sini ya: {link}",
  shipment: "Halo Kak {nama}, update kargo pesanan {kode}: {status}. Pantau di: {link}",
  delivery: "Halo Kak {nama}, pesanan {kode} sudah dikirim via {kurir}, resi {resi}. Detail: {link}",
};

export const policySchema = z.object({
  dpPercent: z.number().int().min(0).max(100).default(50),
  settleDays: z.number().int().min(1).max(30).default(3),
  forfeitOnExpiry: z.boolean().default(true),
  refundDefault: z.enum(["saldo", "transfer"]).default("saldo"),
  uniqueCode: z.boolean().default(true),
  approvalHours: z.number().int().min(1).max(168).default(24),
  policyText: z.string().max(3000).default(DEFAULT_POLICY_TEXT),
  templates: z.partialRecord(z.enum(TEMPLATE_KEYS), z.string().max(1000)).default({}),
  /** Where domestic parcels leave from, for courier rate checks. */
  originPostalCode: z.string().regex(/^\d{5}$/).optional(),
});
export type Policy = z.infer<typeof policySchema>;

export function parsePolicy(json: string | null | undefined): Policy {
  try {
    return policySchema.parse(json ? JSON.parse(json) : {});
  } catch {
    return policySchema.parse({});
  }
}

export function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => vars[k] ?? m);
}
