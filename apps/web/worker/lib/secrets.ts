import { base64url, fromBase64url } from "./crypto";

const enc = new TextEncoder();
const keys = new Map<string, Promise<CryptoKey>>();

function keyFor(secret: string) {
  let k = keys.get(secret);
  if (!k) {
    k = crypto.subtle
      .digest("SHA-256", enc.encode(`bawaan-seal:${secret}`))
      .then((raw) => crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]));
    keys.set(secret, k);
  }
  return k;
}

/** Seller credentials (gateway keys, WhatsApp tokens) never sit in D1 in the clear. */
export async function seal(secret: string, value: unknown): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await keyFor(secret), enc.encode(JSON.stringify(value)));
  return `${base64url(iv)}.${base64url(data)}`;
}

export async function unseal<T>(secret: string, sealed: string | null | undefined): Promise<T | null> {
  if (!sealed) return null;
  const [iv, data] = sealed.split(".");
  if (!iv || !data) return null;
  try {
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64url(iv) }, await keyFor(secret), fromBase64url(data));
    return JSON.parse(new TextDecoder().decode(plain)) as T;
  } catch {
    return null;
  }
}
