import { sha256 } from "../lib/crypto";
import { HttpError } from "../lib/http";
import { newId } from "../lib/ids";

const MAX_BYTES = 5 * 1024 * 1024;
const PUBLIC_KINDS = ["product", "item", "receipt", "logo", "qris"] as const;
const PRIVATE_KINDS = ["proof", "billing"] as const;
type Kind = (typeof PUBLIC_KINDS)[number] | (typeof PRIVATE_KINDS)[number];

/** Trust the bytes, not the filename or the browser's content type. */
function sniff(bytes: Uint8Array): { type: string; ext: string } | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { type: "image/jpeg", ext: "jpg" };
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return { type: "image/png", ext: "png" };
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50)
    return { type: "image/webp", ext: "webp" };
  return null;
}

export async function storeUpload(env: Env, req: Request, tenantId: string, who: "seller" | "customer") {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  const kind = String(form?.get("kind") ?? "") as Kind;
  const allowed: readonly Kind[] = who === "customer" ? ["proof"] : [...PUBLIC_KINDS, ...PRIVATE_KINDS];
  if (!allowed.includes(kind)) throw new HttpError(422, "invalid", "Jenis file tidak dikenal");
  if (!(file instanceof File)) throw new HttpError(422, "invalid", "File tidak ada");
  if (file.size > MAX_BYTES) throw new HttpError(413, "too_large", "Ukuran foto maksimal 5 MB");
  const buf = await file.arrayBuffer();
  const type = sniff(new Uint8Array(buf.slice(0, 16)));
  if (!type) throw new HttpError(415, "unsupported", "Format foto harus JPG, PNG, atau WebP");

  const key = `t/${tenantId}/${kind}/${newId("f")}.${type.ext}`;
  const isPublic = (PUBLIC_KINDS as readonly string[]).includes(kind);
  const bucket = isPublic ? env.PUBLIC_BUCKET : env.PRIVATE_BUCKET;
  const hash = await sha256(buf);
  // The hash rides along in metadata so a resubmitted screenshot is caught without trusting the client.
  await bucket.put(key, buf, {
    httpMetadata: { contentType: type.type, cacheControl: isPublic ? "public, max-age=31536000, immutable" : "private" },
    customMetadata: { hash },
  });
  return { key, url: isPublic ? `/media/${key}` : null, hash };
}
