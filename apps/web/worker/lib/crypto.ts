const enc = new TextEncoder();

export function base64url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const b of arr) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64url(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export function randomToken(bytes = 32): string {
  return base64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function sha256(input: string | ArrayBuffer): Promise<string> {
  const data = typeof input === "string" ? enc.encode(input) : input;
  return base64url(await crypto.subtle.digest("SHA-256", data));
}

async function hmacKey(secret: string) {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function hmac(secret: string, message: string): Promise<string> {
  return base64url(await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(message)));
}

export async function hmacVerify(secret: string, message: string, signature: string): Promise<boolean> {
  try {
    return await crypto.subtle.verify("HMAC", await hmacKey(secret), fromBase64url(signature), enc.encode(message));
  } catch {
    return false;
  }
}

/** An empty or short APP_SECRET would make order links guessable, so refuse to run with one. */
export function appSecret(env: Env): string {
  const s = env.APP_SECRET ?? "";
  if (s.length < 32) throw new Error("APP_SECRET is missing or shorter than 32 characters; set it with `wrangler secret put APP_SECRET`");
  return s;
}
