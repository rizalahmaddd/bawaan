import { feature } from "../lib/features";
import { HttpError } from "../lib/http";

const API = "https://api.biteship.com/v1";
export const courierEnabled = (env: Env) => feature(env, "courier") && !!env.BITESHIP_API_KEY;

/** Sellers type courier names freely ("J&T", "Sicepat REG"); the API wants its own codes. */
export function courierCode(name: string | null | undefined): string | null {
  const n = (name ?? "").toLowerCase().replace(/[^a-z]/g, "");
  const map: Array<[RegExp, string]> = [
    [/^jne/, "jne"],
    [/^(jnt|jt)/, "jnt"],
    [/^sicepat/, "sicepat"],
    [/^anteraja/, "anteraja"],
    [/^(pos|posindonesia)/, "pos"],
    [/^tiki/, "tiki"],
    [/^ninja/, "ninja"],
    [/^lion/, "lion"],
    [/^idexpress|^ide/, "ide"],
    [/^sap/, "sap"],
    [/^gojek|^gosend/, "gojek"],
    [/^grab/, "grab"],
  ];
  return map.find(([re]) => re.test(n))?.[1] ?? null;
}

async function call<T>(env: Env, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, { ...init, headers: { Authorization: env.BITESHIP_API_KEY!, "Content-Type": "application/json", ...(init.headers ?? {}) } });
  const data = await res.json<T & { success?: boolean; error?: string }>().catch(() => null);
  if (!res.ok || !data || data.success === false) throw new HttpError(502, "courier", data?.error ?? "Layanan kurir sedang tidak bisa dihubungi");
  return data;
}

export async function courierRates(env: Env, input: { origin: string; destination: string; weightG: number; value: number }) {
  if (!courierEnabled(env)) throw new HttpError(503, "unavailable", "Cek ongkir belum tersedia");
  const data = await call<{ pricing: Array<{ courier_name: string; courier_code: string; courier_service_name: string; price: number; duration: string }> }>(env, "/rates/couriers", {
    method: "POST",
    body: JSON.stringify({
      origin_postal_code: Number(input.origin),
      destination_postal_code: Number(input.destination),
      couriers: "jne,jnt,sicepat,anteraja,pos,ninja,lion,ide",
      items: [{ name: "Paket jastip", value: input.value, weight: Math.max(1, input.weightG), quantity: 1 }],
    }),
  });
  return data.pricing
    .map((p) => ({ courier: p.courier_name, code: p.courier_code, service: p.courier_service_name, price: p.price, duration: p.duration }))
    .sort((a, b) => a.price - b.price);
}

export type TrackingEvent = { at: string; note: string; status: string };

/** Cached for 30 minutes: customers refresh the tracking page far more often than couriers update. */
export async function courierTracking(env: Env, courier: string, waybill: string) {
  if (!courierEnabled(env)) return null;
  const code = courierCode(courier);
  if (!code) return null;
  const cacheKey = new Request(`https://courier.cache/${code}/${encodeURIComponent(waybill)}`);
  const hit = await caches.default.match(cacheKey);
  if (hit) return hit.json<{ status: string; history: TrackingEvent[] }>();
  const data = await call<{ status: string; history: Array<{ note: string; updated_at: string; status: string }> }>(env, `/trackings/${encodeURIComponent(waybill)}/couriers/${code}`).catch(() => null);
  if (!data) return null;
  const out = { status: data.status, history: data.history.map((h) => ({ at: h.updated_at, note: h.note, status: h.status })).reverse() };
  await caches.default.put(cacheKey, new Response(JSON.stringify(out), { headers: { "Cache-Control": "max-age=1800", "Content-Type": "application/json" } }));
  return out;
}
