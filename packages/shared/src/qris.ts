/** CRC-16/CCITT-FALSE, the checksum QRIS puts in tag 63. */
export function qrisCrc(data: string): string {
  let crc = 0xffff;
  for (let i = 0; i < data.length; i++) {
    crc ^= data.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

function parseTlv(payload: string): [string, string][] {
  const out: [string, string][] = [];
  for (let i = 0; i < payload.length; ) {
    const tag = payload.slice(i, i + 2);
    const len = Number(payload.slice(i + 2, i + 4));
    if (!/^\d{2}$/.test(tag) || !Number.isInteger(len) || i + 4 + len > payload.length) throw new Error("QRIS tidak valid");
    out.push([tag, payload.slice(i + 4, i + 4 + len)]);
    i += 4 + len;
  }
  return out;
}

export function qrisMerchantName(payload: string): string | null {
  return parseTlv(payload).find(([t]) => t === "59")?.[1] ?? null;
}

/**
 * Turns a merchant's static QRIS into a dynamic one for an exact amount: point of initiation
 * becomes "12" (single use) and tag 54 carries the amount. The CRC has to be recomputed.
 */
export function qrisWithAmount(staticPayload: string, amountIdr: number): string {
  const payload = staticPayload.trim();
  if (!Number.isInteger(amountIdr) || amountIdr <= 0) throw new Error("Nominal QRIS harus bilangan bulat positif");
  if (qrisCrc(payload.slice(0, -4)) !== payload.slice(-4).toUpperCase()) throw new Error("Checksum QRIS tidak cocok");
  const fields = parseTlv(payload).filter(([t]) => t !== "54" && t !== "63");
  const set = (tag: string, value: string) => {
    const i = fields.findIndex(([t]) => t === tag);
    if (i >= 0) fields[i] = [tag, value];
    else fields.push([tag, value]);
  };
  set("01", "12");
  set("54", String(amountIdr));
  fields.sort(([a], [b]) => Number(a) - Number(b));
  const body = fields.map(([t, v]) => `${t}${String(v.length).padStart(2, "0")}${v}`).join("") + "6304";
  return body + qrisCrc(body);
}
