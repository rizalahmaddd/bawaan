/** RFC 4180-ish: quoted fields, doubled quotes, CRLF, and ; or , as the separator (Excel in id-ID exports with ;). */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.slice(0, src.indexOf("\n") >>> 0);
  const sep = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c.trim())) rows.push(row);
  return rows;
}

const ALIASES: Record<"name" | "phone" | "email" | "notes" | "tags", string[]> = {
  name: ["nama", "name", "nama pelanggan", "customer"],
  phone: ["whatsapp", "wa", "no wa", "nomor", "no hp", "hp", "phone", "telepon", "no. hp", "no. wa"],
  email: ["email", "e-mail"],
  notes: ["catatan", "notes", "note", "keterangan"],
  tags: ["tag", "tags", "label"],
};

export type ColumnMap = Partial<Record<keyof typeof ALIASES, number>>;

export function guessColumns(header: string[]): ColumnMap {
  const map: ColumnMap = {};
  header.forEach((h, i) => {
    const key = h.trim().toLowerCase();
    for (const [field, names] of Object.entries(ALIASES) as Array<[keyof typeof ALIASES, string[]]>) {
      if (map[field] === undefined && names.includes(key)) map[field] = i;
    }
  });
  return map;
}
