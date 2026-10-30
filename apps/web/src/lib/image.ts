const MAX_SIDE = 1600;

/**
 * Shrinks a photo before upload: phone photos are 3–8 MB and R2 + mobile data both care.
 * Safari can't encode WebP from canvas, so JPEG is the safe common format.
 */
export async function compressImage(file: File, maxSide = MAX_SIDE, quality = 0.82): Promise<File> {
  if (!file.type.startsWith("image/")) throw new Error("File harus berupa foto");
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error("Foto tidak bisa dibaca. Coba pilih foto lain.");
  }
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", quality));
  if (!blob) throw new Error("Gagal memproses foto");
  return new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" });
}
