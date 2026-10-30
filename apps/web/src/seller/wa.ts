import { DEFAULT_TEMPLATES, formatRupiah, renderTemplate, waLink, type Policy, type TemplateKey } from "@bawaan/shared";
import { fmtDate } from "../lib/format";

export function waMessage(
  policy: Policy | undefined,
  key: TemplateKey,
  vars: { nama: string; kode: string; link: string; total?: number; tagihan?: number; batas?: number | null; status?: string; kurir?: string; resi?: string },
) {
  const template = policy?.templates[key] || DEFAULT_TEMPLATES[key];
  return renderTemplate(template, {
    nama: vars.nama,
    kode: vars.kode,
    link: vars.link,
    total: vars.total !== undefined ? formatRupiah(vars.total) : "",
    tagihan: vars.tagihan !== undefined ? formatRupiah(vars.tagihan) : "",
    batas: vars.batas ? fmtDate(vars.batas) : "",
    status: vars.status ?? "",
    kurir: vars.kurir ?? "",
    resi: vars.resi ?? "",
  });
}

export const openWa = (phone: string, text: string) => window.open(waLink(phone, text), "_blank", "noopener");
