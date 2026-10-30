/**
 * Normalises Indonesian and international numbers to E.164.
 * Local "08…" / "8…" / "62…" all become "+62…" so one customer is one row per store.
 */
export function normalizePhone(input: string): string | null {
  const trimmed = input.trim();
  const hasPlus = trimmed.startsWith("+");
  let digits = trimmed.replace(/\D/g, "");
  if (!digits) return null;

  if (hasPlus) {
    if (digits.startsWith("620")) digits = "62" + digits.slice(3);
  } else if (digits.startsWith("0")) {
    digits = "62" + digits.slice(1);
  } else if (digits.startsWith("8")) {
    digits = "62" + digits;
  } else if (digits.startsWith("620")) {
    digits = "62" + digits.slice(3);
  }

  if (digits.startsWith("62")) {
    const national = digits.slice(2);
    if (!/^8\d{7,11}$/.test(national)) return null;
  } else if (digits.length < 8 || digits.length > 15) {
    return null;
  }
  return "+" + digits;
}

export function phoneLast4(e164: string): string {
  return e164.slice(-4);
}

export function maskPhone(e164: string): string {
  return e164.length <= 7 ? e164 : `${e164.slice(0, 5)}•••${e164.slice(-3)}`;
}

/** Click-to-chat link; wa.me wants digits only. */
export function waLink(e164: string, text?: string): string {
  const base = `https://wa.me/${e164.replace(/\D/g, "")}`;
  return text ? `${base}?text=${encodeURIComponent(text)}` : base;
}
