const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function base32(bytes: Uint8Array, length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) out += CROCKFORD[bytes[i]! % 32];
  return out;
}

/** Time-sortable id with a type prefix, e.g. ord_0KZ3M8Q4F2A7XJ9W. */
export function newId(prefix: string): string {
  let t = Date.now();
  let time = "";
  for (let i = 0; i < 9; i++) {
    time = CROCKFORD[t % 32] + time;
    t = Math.floor(t / 32);
  }
  return `${prefix}_${time}${base32(crypto.getRandomValues(new Uint8Array(8)), 8)}`;
}

/** Human-friendly order code: JPN-2611-K7QD. The suffix is random so codes can't be enumerated. */
export function orderCode(country: string, at = new Date()): string {
  const prefix = country.replace(/[^a-z]/gi, "").slice(0, 3).toUpperCase().padEnd(3, "X");
  const yymm = `${String(at.getUTCFullYear()).slice(2)}${String(at.getUTCMonth() + 1).padStart(2, "0")}`;
  return `${prefix}-${yymm}-${base32(crypto.getRandomValues(new Uint8Array(5)), 5)}`;
}
