const dateFmt = new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", year: "numeric" });
const dateTimeFmt = new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const rel = new Intl.RelativeTimeFormat("id-ID", { numeric: "auto" });

export const fmtDate = (ms: number | null | undefined) => (ms ? dateFmt.format(ms) : "—");
export const fmtDateTime = (ms: number | null | undefined) => (ms ? dateTimeFmt.format(ms) : "—");

export function fmtRelative(ms: number, now = Date.now()) {
  const diff = ms - now;
  const abs = Math.abs(diff);
  if (abs < 60_000) return "baru saja";
  if (abs < 3_600_000) return rel.format(Math.round(diff / 60_000), "minute");
  if (abs < 86_400_000) return rel.format(Math.round(diff / 3_600_000), "hour");
  return rel.format(Math.round(diff / 86_400_000), "day");
}

/** For <input type="datetime-local">, which wants local time without a zone. */
export function toLocalInput(ms: number) {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export const kursToText = (micro: number) => (micro / 1_000_000).toLocaleString("id-ID", { maximumFractionDigits: 6 });
export const textToMinor = (v: string, exponent: number) => {
  const n = Number(v.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? Math.round(n * 10 ** exponent) : NaN;
};
export const minorToText = (minor: number | null | undefined, exponent: number) =>
  minor === null || minor === undefined ? "" : (minor / 10 ** exponent).toLocaleString("id-ID", { maximumFractionDigits: exponent, useGrouping: false });
