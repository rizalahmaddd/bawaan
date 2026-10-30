import { currencyExponent, formatForeign, type DecideItemInput } from "@bawaan/shared";
import { useEffect, useState } from "react";
import { minorToText, textToMinor } from "../lib/format";
import { media } from "../lib/types";
import { Button } from "../ui/Button";
import { Field, Input, PhotoPicker, Stepper, TextArea } from "../ui/Form";
import { ListSection } from "../ui/List";
import { Segmented } from "../ui/Segmented";
import { Sheet } from "../ui/Sheet";
import { useUpload } from "./common";
import { useTenant } from "./context";
import { useTenantAction } from "./hooks";
import { ApiError } from "../lib/api";
import { compressImage } from "../lib/image";
import { enqueue, isOffline } from "../lib/outbox";
import { useHud } from "../ui/Feedback";

export type DecideTarget = {
  id: string;
  title: string;
  variant: string | null;
  qty: number;
  currency: string;
  priceMinor: number | null;
  maxPriceMinor: number | null;
  photoKey?: string | null;
  customer?: string;
};

type Result = DecideItemInput["result"];

/** Shopping-mode style sheet: Dapat / Sebagian / Tidak dapat / Tanya pelanggan, with price and photos. */
export function DecideSheet({ item, onClose }: { item: DecideTarget | null; onClose: () => void }) {
  const [result, setResult] = useState<Result>("obtained");
  const [price, setPrice] = useState("");
  const [qtyObtained, setQtyObtained] = useState(1);
  const [note, setNote] = useState("");
  const [photoKey, setPhotoKey] = useState<string | undefined>();
  const [receiptKey, setReceiptKey] = useState<string | undefined>();
  // Kept so a decision can still be queued with its photos when the upload has no signal.
  const [photoFile, setPhotoFile] = useState<File | undefined>();
  const [receiptFile, setReceiptFile] = useState<File | undefined>();
  const photo = useUpload();
  const receipt = useUpload();
  const t = useTenant();
  const hud = useHud();
  const decide = useTenantAction<{ id: string; body: DecideItemInput }>("post", (i) => `/items/${i.id}/decide`, "Tersimpan", { silentOffline: true });

  useEffect(() => {
    if (!item) return;
    setResult("obtained");
    setPrice(minorToText(item.priceMinor, currencyExponent(item.currency)));
    setQtyObtained(Math.max(1, item.qty - 1));
    setNote("");
    setPhotoKey(undefined);
    setReceiptKey(undefined);
    setPhotoFile(undefined);
    setReceiptFile(undefined);
  }, [item]);

  if (!item) return null;

  const exp = currencyExponent(item.currency);
  const actual = price.trim() ? textToMinor(price, exp) : undefined;
  const limit = item.maxPriceMinor ?? item.priceMinor;
  const overLimit = actual !== undefined && limit !== null && actual > limit;

  function submit() {
    if (!item) return;
    let body: DecideItemInput;
    if (result === "obtained") body = { result, actualPriceMinor: actual, photoKey, receiptKey };
    else if (result === "partial") body = { result, qtyObtained, actualPriceMinor: actual, photoKey, receiptKey };
    else if (result === "unavailable") body = { result, note: note.trim() || undefined };
    else body = { result, actualPriceMinor: actual, note: note.trim(), photoKey };
    const queue = async () => {
      await enqueue({
        tenantBase: t.base,
        itemId: item.id,
        title: `${item.title}${item.customer ? ` · ${item.customer}` : ""}`,
        body,
        photo: !photoKey && result !== "unavailable" ? photoFile : undefined,
        receipt: !receiptKey && (result === "obtained" || result === "partial") ? receiptFile : undefined,
      });
      hud("Tersimpan di HP, dikirim saat ada sinyal");
      onClose();
    };
    const missingUpload = (photoFile && !photoKey) || (receiptFile && !receiptKey);
    if (isOffline() || missingUpload) return void queue();
    decide.mutate({ id: item.id, body }, { onSuccess: onClose, onError: (e) => e instanceof ApiError && e.status === 0 && void queue() });
  }

  const invalid = (actual !== undefined && Number.isNaN(actual)) || (result === "approval" && note.trim().length < 3);

  return (
    <Sheet open={!!item} onOpenChange={(o) => !o && onClose()} title={item.title} detents={["large"]}>
      <p className="mb-4 text-center text-subhead text-label-2">
        {[item.variant, `${item.qty} pcs`, item.customer].filter(Boolean).join(" · ")}
        {limit !== null && <> · maks {formatForeign(limit, item.currency)}</>}
      </p>
      <Segmented
        label="Hasil belanja"
        value={result}
        onChange={setResult}
        className="mb-6"
        options={[
          { value: "obtained", label: "Dapat" },
          ...(item.qty > 1 ? [{ value: "partial" as const, label: "Sebagian" }] : []),
          { value: "unavailable", label: "Tidak dapat" },
          { value: "approval", label: "Tanya" },
        ]}
      />

      {result !== "unavailable" && (
        <ListSection
          footer={
            overLimit && result !== "approval"
              ? "Harga di atas batas pelanggan. Barang otomatis menunggu persetujuan pelanggan."
              : result === "approval"
                ? "Pelanggan diminta setuju atau menolak sebelum batas waktu."
                : undefined
          }
        >
          <Field label={`Harga asli (${item.currency})`}>
            {(id) => <Input id={id} value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" placeholder="Sesuai label" />}
          </Field>
          {result === "partial" && (
            <Field label="Jumlah dapat">{() => <div className="flex justify-end"><Stepper value={qtyObtained} onChange={setQtyObtained} min={1} max={item.qty - 1} label="Jumlah dapat" /></div>}</Field>
          )}
        </ListSection>
      )}

      {(result === "unavailable" || result === "approval") && (
        <ListSection header={result === "approval" ? "Pesan ke pelanggan" : "Catatan (opsional)"}>
          <div className="px-4 py-2">
            <TextArea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              aria-label="Catatan"
              maxLength={300}
              placeholder={result === "approval" ? "Contoh: warna navy habis, adanya hitam. Mau diganti?" : "Contoh: sold out di semua toko"}
            />
          </div>
        </ListSection>
      )}

      {result !== "unavailable" && (
        <ListSection header="Foto" footer="Foto barang & struk tampil di halaman lacak pelanggan.">
          <div className="flex gap-4 p-4">
            <div className="text-center">
              <PhotoPicker label="Foto barang" value={media(item.photoKey)} busy={photo.busy} onPick={async (f) => {
                  setPhotoFile(await compressImage(f).catch(() => f));
                  if (!isOffline()) setPhotoKey(await photo.upload(f, "item", { quiet: true }));
                }} />
              <span className="mt-1 block text-footnote text-label-2">Barang</span>
            </div>
            {result !== "approval" && (
              <div className="text-center">
                <PhotoPicker label="Foto struk" busy={receipt.busy} onPick={async (f) => {
                  setReceiptFile(await compressImage(f).catch(() => f));
                  if (!isOffline()) setReceiptKey(await receipt.upload(f, "receipt", { quiet: true }));
                }} />
                <span className="mt-1 block text-footnote text-label-2">Struk</span>
              </div>
            )}
          </div>
        </ListSection>
      )}

      <Button size="lg" block disabled={decide.isPending || photo.busy || receipt.busy || invalid} onClick={submit}>
        {decide.isPending ? "Menyimpan…" : "Simpan"}
      </Button>
    </Sheet>
  );
}
