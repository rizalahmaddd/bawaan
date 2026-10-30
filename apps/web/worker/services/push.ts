import { base64url } from "../lib/crypto";

let keyCache: { jwk: string; key: CryptoKey } | null = null;

async function signingKey(jwk: string) {
  if (keyCache?.jwk === jwk) return keyCache.key;
  const key = await crypto.subtle.importKey("jwk", JSON.parse(jwk), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  keyCache = { jwk, key };
  return key;
}

async function vapidJwt(env: Env, audience: string) {
  const enc = new TextEncoder();
  const header = base64url(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = base64url(enc.encode(JSON.stringify({ aud: audience, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: env.VAPID_SUBJECT })));
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, await signingKey(env.VAPID_PRIVATE_JWK), enc.encode(`${header}.${claims}`));
  return `${header}.${claims}.${base64url(sig)}`;
}

/**
 * Sends an empty push. The service worker then fetches the message itself, which skips payload
 * encryption (aes128gcm) and keeps us well inside the free plan's CPU budget.
 * Returns false when the subscription is gone and should be deleted.
 */
export async function sendEmptyPush(env: Env, endpoint: string): Promise<boolean> {
  if (!env.VAPID_PRIVATE_JWK || !env.VAPID_PUBLIC_KEY) return true;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      TTL: "86400",
      Urgency: "normal",
      "Content-Length": "0",
      Authorization: `vapid t=${await vapidJwt(env, new URL(endpoint).origin)}, k=${env.VAPID_PUBLIC_KEY}`,
    },
  });
  return !(res.status === 404 || res.status === 410);
}
