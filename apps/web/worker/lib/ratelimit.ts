import { HttpError } from "./http";

export async function limit(binding: RateLimit | undefined, key: string) {
  if (!binding) return;
  const { success } = await binding.limit({ key });
  if (!success) throw new HttpError(429, "rate_limited", "Terlalu banyak percobaan. Coba lagi sebentar lagi.");
}

export function clientIp(req: Request) {
  return req.headers.get("cf-connecting-ip") ?? "local";
}

export function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifyTurnstile(env: Env, token: string | undefined, ip: string) {
  if (!env.TURNSTILE_SECRET) return;
  if (!token) throw new HttpError(400, "captcha", "Verifikasi keamanan belum selesai");
  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body: new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token, remoteip: ip }),
  });
  const data = await res.json<{ success: boolean }>();
  if (!data.success) throw new HttpError(400, "captcha", "Verifikasi keamanan gagal, coba lagi");
}
