import { currencyExponent, formatForeign, formatRupiah, parseKurs, splitVariants, supportedCurrencies, toRupiah, waLink, type ProductInput, type Rounding, type TripInput } from "@bawaan/shared";
import { BarChart3, ClipboardList, Package, Plane, Plus, Share } from "lucide-react";
import { useState } from "react";
import { errorMessage } from "../../lib/api";
import { fmtDate, fmtRelative, kursToText, minorToText, textToMinor, toLocalInput } from "../../lib/format";
import { surfaceUrl } from "../../lib/links";
import { navigate, useLocation } from "../../lib/router";
import { media, type Product, type Trip } from "../../lib/types";
import { Button, IconButton } from "../../ui/Button";
import { EmptyState, ErrorState, SkeletonRows, useHud } from "../../ui/Feedback";
import { Field, Input, PhotoPicker, Select, TextArea } from "../../ui/Form";
import { ListRow, ListSection } from "../../ui/List";
import { Pill } from "../../ui/Pill";
import { Segmented } from "../../ui/Segmented";
import { Sheet } from "../../ui/Sheet";
import { useUpload } from "../common";
import { useTenant } from "../context";
import { useTenantAction, useTenantQuery } from "../hooks";
import { Screen } from "../Screen";

const TRIP_STATUS: Record<Trip["status"], { label: string; tone: "gray" | "green" | "orange" | "blue" }> = {
  draft: { label: "Draf", tone: "gray" },
  open: { label: "Dibuka", tone: "green" },
  closed: { label: "Ditutup", tone: "orange" },
  done: { label: "Selesai", tone: "blue" },
};

export function Trips() {
  const { search } = useLocation();
  const [creating, setCreating] = useState(search.has("baru"));
  const q = useTenantQuery<Trip[]>(["trips"], "/trips");
  const shelf = useTenantAction<void, { id: string }>("post", "/ready-stock");
  const hasShelf = q.data?.some((t) => t.kind === "ready");
  return (
    <Screen
      title="Trip & katalog"
      trailing={
        <IconButton label="Trip baru" onClick={() => setCreating(true)}>
          <Plus className="size-5" />
        </IconButton>
      }
    >
      {q.isPending && <SkeletonRows />}
      {q.isError && <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />}
      {q.data?.length === 0 && (
        <EmptyState
          icon={<Plane />}
          title="Belum ada trip"
          body="Buat trip untuk perjalanan belanjamu, isi katalog, lalu buka supaya pelanggan bisa pesan."
          action={<Button onClick={() => setCreating(true)}>Buat trip pertama</Button>}
        />
      )}
      {!!q.data?.length && (
        <ListSection>
          {q.data.map((t) => (
            <ListRow
              key={t.id}
              icon={t.kind === "ready" ? <Package /> : <Plane />}
              iconBg={t.kind === "ready" ? "var(--green)" : undefined}
              title={t.title}
              subtitle={t.kind === "ready" ? `Selalu buka · ${t.productCount ?? 0} barang · ${t.orderCount ?? 0} pesanan` : `${t.country} · tutup ${fmtDate(t.closesAt)} · ${t.productCount ?? 0} barang · ${t.orderCount ?? 0} pesanan`}
              trailing={<Pill tone={TRIP_STATUS[t.status].tone}>{TRIP_STATUS[t.status].label}</Pill>}
              chevron
              onClick={() => navigate(`/trip/${t.id}`)}
            />
          ))}
        </ListSection>
      )}
      {q.data && !hasShelf && (
        <ListSection footer="Untuk barang yang sudah ada di tanganmu, misalnya sisa belanja atau pesanan yang hangus. Pembeli bayar penuh dan barang langsung dikirim.">
          <ListRow icon={<Package />} iconBg="var(--green)" title="Buka rak Ready stock" onClick={() => !shelf.isPending && shelf.mutate(undefined, { onSuccess: (t) => navigate(`/trip/${t.id}`) })} />
        </ListSection>
      )}
      <TripSheet open={creating} onClose={() => setCreating(false)} />
    </Screen>
  );
}

function TripSheet({ open, onClose, trip }: { open: boolean; onClose: () => void; trip?: Trip }) {
  const weekAhead = Date.now() + 7 * 86_400_000;
  const [f, setF] = useState(() => ({
    title: trip?.title ?? "",
    country: trip?.country ?? "Jepang",
    currency: trip?.currency ?? "JPY",
    kurs: trip ? kursToText(trip.kursMicro) : "",
    rounding: String(trip?.rounding ?? 1000),
    defaultFee: trip?.defaultFee ? String(trip.defaultFee) : "",
    dpPercent: String(trip?.dpPercent ?? 50),
    closesAt: toLocalInput(trip?.closesAt ?? weekAhead),
    etaAt: trip?.etaAt ? toLocalInput(trip.etaAt).slice(0, 10) : "",
    mode: trip?.mode ?? "cargo",
    note: trip?.note ?? "",
    kursLock: trip?.kursLock ?? "confirm",
    actualKurs: trip?.actualKursMicro ? kursToText(trip.actualKursMicro) : "",
    cargoRate: trip?.cargoRatePerKg ? String(trip.cargoRatePerKg) : "",
    cargoRoundG: String(trip?.cargoRoundG ?? 100),
    cargoMin: trip?.cargoMinIdr ? String(trip.cargoMinIdr) : "",
  }));
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const create = useTenantAction<TripInput, { id: string }>("post", "/trips", "Trip dibuat");
  const update = useTenantAction<Partial<TripInput>>("patch", `/trips/${trip?.id}`, "Trip disimpan");

  let kursMicro: number | null = null;
  let actualKursMicro: number | null | undefined = null;
  try {
    kursMicro = f.kurs ? Number(parseKurs(f.kurs)) : null;
  } catch {}
  try {
    actualKursMicro = f.actualKurs.trim() ? Number(parseKurs(f.actualKurs)) : null;
  } catch {
    actualKursMicro = undefined;
  }
  const cargoRate = f.cargoRate.trim() ? textToMinor(f.cargoRate, 0) : null;
  const cargoMin = f.cargoMin.trim() ? textToMinor(f.cargoMin, 0) : 0;
  const valid =
    f.title.trim().length >= 3 &&
    f.country.trim().length >= 2 &&
    kursMicro !== null &&
    kursMicro > 0 &&
    f.closesAt &&
    actualKursMicro !== undefined &&
    !Number.isNaN(cargoRate) &&
    !Number.isNaN(cargoMin);

  function submit() {
    const body: TripInput = {
      title: f.title.trim(),
      country: f.country.trim(),
      currency: f.currency,
      kursMicro: kursMicro!,
      rounding: Number(f.rounding) as Rounding,
      defaultFee: f.defaultFee ? textToMinor(f.defaultFee, 0) : 0,
      dpPercent: Number(f.dpPercent),
      closesAt: new Date(f.closesAt).getTime(),
      etaAt: f.etaAt ? new Date(f.etaAt).getTime() : null,
      mode: f.mode,
      note: f.note.trim() || null,
      kursLock: f.kursLock,
      actualKursMicro: actualKursMicro ?? null,
      cargoRatePerKg: cargoRate,
      cargoRoundG: Number(f.cargoRoundG) as 100 | 500 | 1000,
      cargoMinIdr: cargoMin,
    };
    if (trip) update.mutate(body, { onSuccess: onClose });
    else create.mutate(body, { onSuccess: (r) => (onClose(), navigate(`/trip/${r.id}`)) });
  }

  const sample = kursMicro ? toRupiah(10 ** currencyExponent(f.currency) * (f.currency === "JPY" || f.currency === "KRW" ? 1000 : 10), f.currency, BigInt(kursMicro), Number(f.rounding) as Rounding) : null;

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()} title={trip ? "Ubah trip" : "Trip baru"} detents={["large"]}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) submit();
        }}
      >
        <ListSection>
          <Field label="Nama trip">{(id) => <Input id={id} value={f.title} onChange={set("title")} placeholder="Tokyo Desember" autoFocus={!trip} maxLength={80} />}</Field>
          <Field label="Negara">{(id) => <Input id={id} value={f.country} onChange={set("country")} maxLength={40} />}</Field>
          <Field label="Mata uang">
            {(id) => (
              <Select id={id} value={f.currency} onChange={set("currency")}>
                {supportedCurrencies.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </Select>
            )}
          </Field>
        </ListSection>
        <ListSection
          header="Kurs & harga"
          footer={sample !== null ? `Contoh: ${formatForeign(10 ** currencyExponent(f.currency) * (f.currency === "JPY" || f.currency === "KRW" ? 1000 : 10), f.currency)} = ${formatRupiah(sample)} (dibulatkan ke atas).` : "Kurs Rupiah untuk 1 unit mata uang asing."}
        >
          <Field label={`Kurs 1 ${f.currency}`}>{(id) => <Input id={id} value={f.kurs} onChange={set("kurs")} inputMode="decimal" placeholder="108,5" />}</Field>
          <Field label="Pembulatan">
            {(id) => (
              <Select id={id} value={f.rounding} onChange={set("rounding")}>
                <option value="1">Tanpa</option>
                <option value="100">Rp 100</option>
                <option value="500">Rp 500</option>
                <option value="1000">Rp 1.000</option>
              </Select>
            )}
          </Field>
          <Field label="Fee jasa / barang">{(id) => <Input id={id} value={f.defaultFee} onChange={set("defaultFee")} inputMode="numeric" placeholder="Rp 0" />}</Field>
          <Field label="Kurs dikunci saat">
            {(id) => (
              <Select id={id} value={f.kursLock} onChange={set("kursLock")}>
                <option value="confirm">Pesanan dikonfirmasi</option>
                <option value="settle">Pelunasan</option>
              </Select>
            )}
          </Field>
        </ListSection>
        <ListSection header="Ongkir kargo" footer="Dipakai untuk menghitung tagihan ongkir per pelanggan dari berat paket. Kosongkan kalau ongkir sudah termasuk harga.">
          <Field label="Tarif per kg (Rp)">{(id) => <Input id={id} value={f.cargoRate} onChange={set("cargoRate")} inputMode="numeric" placeholder="150000" />}</Field>
          <Field label="Pembulatan berat">
            {(id) => (
              <Select id={id} value={f.cargoRoundG} onChange={set("cargoRoundG")}>
                <option value="100">0,1 kg</option>
                <option value="500">0,5 kg</option>
                <option value="1000">1 kg</option>
              </Select>
            )}
          </Field>
          <Field label="Minimal (Rp)">{(id) => <Input id={id} value={f.cargoMin} onChange={set("cargoMin")} inputMode="numeric" placeholder="0" />}</Field>
        </ListSection>
        <ListSection header="DP">
          <div className="p-4">
            <Segmented
              label="DP"
              value={f.dpPercent}
              onChange={(v) => setF({ ...f, dpPercent: v })}
              options={[
                { value: "0", label: "Tanpa" },
                { value: "30", label: "30%" },
                { value: "50", label: "50%" },
                { value: "100", label: "Lunas" },
              ]}
            />
          </div>
        </ListSection>
        <ListSection header="Jadwal">
          <Field label="Tutup PO">{(id) => <Input id={id} type="datetime-local" value={f.closesAt} onChange={set("closesAt")} />}</Field>
          <Field label="Perkiraan tiba">{(id) => <Input id={id} type="date" value={f.etaAt} onChange={set("etaAt")} />}</Field>
          <Field label="Pengiriman">
            {(id) => (
              <Select id={id} value={f.mode} onChange={set("mode")}>
                <option value="cargo">Kargo</option>
                <option value="hand_carry">Hand carry</option>
                <option value="mixed">Campur</option>
              </Select>
            )}
          </Field>
        </ListSection>
        {trip && (
          <ListSection header="Untuk laporan" footer="Kurs yang benar-benar kamu dapat saat tukar uang. Hanya untuk menghitung untung-rugi kurs, tidak ditampilkan ke pelanggan.">
            <Field label={`Kurs asli 1 ${f.currency}`}>{(id) => <Input id={id} value={f.actualKurs} onChange={set("actualKurs")} inputMode="decimal" placeholder="Opsional" />}</Field>
          </ListSection>
        )}
        <ListSection header="Catatan untuk pelanggan">
          <div className="px-4 py-2">
            <TextArea value={f.note} onChange={set("note")} aria-label="Catatan" maxLength={1000} placeholder="Contoh: belanja di Ginza & Shibuya, kargo udara ±2 minggu." />
          </div>
        </ListSection>
        <Button type="submit" size="lg" block disabled={!valid || create.isPending || update.isPending}>
          {trip ? "Simpan" : "Buat trip"}
        </Button>
      </form>
    </Sheet>
  );
}

export function TripDetail({ id }: { id: string }) {
  const t = useTenant();
  const hud = useHud();
  const q = useTenantQuery<{ trip: Trip; products: Product[] }>(["trip", id], `/trips/${id}`);
  const status = useTenantAction<{ status: Trip["status"] }>("patch", `/trips/${id}`, "Status trip diubah");
  const [editing, setEditing] = useState(false);
  const [product, setProduct] = useState<Product | "new" | null>(null);
  const back = { label: "Trip", to: "/trip" };

  if (q.isPending) return <Screen title="Trip" back={back} largeTitle={false}><SkeletonRows /></Screen>;
  if (q.isError) return <Screen title="Trip" back={back} largeTitle={false}><ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} /></Screen>;

  const { trip, products } = q.data;
  const storeUrl = new URL(surfaceUrl(t.slug), location.href).toString();
  const closed = trip.closesAt < Date.now();

  return (
    <Screen
      title={trip.title}
      back={back}
      trailing={
        <Button variant="glass" onClick={() => setEditing(true)}>
          Ubah
        </Button>
      }
    >
      <ListSection
        header="Status"
        footer={
          trip.status === "open"
            ? closed
              ? "Batas PO sudah lewat, pelanggan tidak bisa pesan lagi. Perpanjang lewat Ubah."
              : `Pelanggan bisa pesan sampai ${fmtDate(trip.closesAt)} (${fmtRelative(trip.closesAt)}).`
            : trip.status === "draft"
              ? "Trip draf belum terlihat di toko."
              : undefined
        }
      >
        <div className="p-4">
          <Segmented
            label="Status trip"
            value={trip.status}
            onChange={(v) => status.mutate({ status: v })}
            options={(["draft", "open", "closed", "done"] as const).map((s) => ({ value: s, label: TRIP_STATUS[s].label }))}
          />
        </div>
        {trip.status === "open" && (
          <ListRow
            icon={<Share />}
            title="Bagikan link toko"
            onClick={() =>
              typeof navigator.share === "function"
                ? navigator.share({ url: storeUrl, title: trip.title }).catch(() => {})
                : navigator.clipboard?.writeText(storeUrl).then(() => hud("Link disalin"))
            }
          />
        )}
      </ListSection>

      <ListSection header="Ringkasan">
        <ListRow title="Kurs" value={`1 ${trip.currency} = Rp ${kursToText(trip.kursMicro)}`} />
        <ListRow title="DP" value={trip.dpPercent ? `${trip.dpPercent}%` : "Tanpa DP"} />
        {trip.defaultFee > 0 && <ListRow title="Fee jasa" value={formatRupiah(trip.defaultFee)} />}
        {trip.etaAt && <ListRow title="Perkiraan tiba" value={fmtDate(trip.etaAt)} />}
        {trip.cargoRatePerKg && <ListRow title="Ongkir kargo" value={`${formatRupiah(trip.cargoRatePerKg)}/kg`} />}
        <ListRow icon={<ClipboardList />} title="Pesanan trip ini" chevron onClick={() => navigate(`/pesanan?trip=${trip.id}`)} />
        {t.canReports && <ListRow icon={<BarChart3 />} iconBg="var(--indigo)" title="Laporan trip" chevron onClick={() => navigate(`/laporan/${trip.id}`)} />}
      </ListSection>

      <ListSection
        header={`Katalog · ${products.length}`}
        footer="Pelanggan juga bisa titip barang di luar katalog lewat formulir request."
      >
        {products.map((p) => (
          <ListRow
            key={p.id}
            icon={p.photoKey ? <img src={media(p.photoKey)!} alt="" className="size-full rounded-[8px] object-cover" /> : <Package />}
            iconBg={p.photoKey ? "transparent" : "var(--gray)"}
            title={p.title}
            subtitle={`${formatForeign(p.priceMinor, trip.currency)} · ${formatRupiah(toRupiah(p.priceMinor, trip.currency, BigInt(trip.kursMicro), trip.rounding as Rounding) + p.fee)}${p.quota !== null ? ` · ${p.reserved}/${p.quota}` : ""}`}
            trailing={p.status !== "active" ? <Pill tone="gray">{p.status === "hidden" ? "Disembunyikan" : "Habis"}</Pill> : undefined}
            chevron
            onClick={() => setProduct(p)}
          />
        ))}
        <ListRow icon={<Plus />} title="Tambah barang" onClick={() => setProduct("new")} />
      </ListSection>

      {editing && <TripSheet open onClose={() => setEditing(false)} trip={trip} />}
      {product && <ProductSheet trip={trip} product={product === "new" ? undefined : product} onClose={() => setProduct(null)} />}
    </Screen>
  );
}

function ProductSheet({ trip, product, onClose }: { trip: Trip; product?: Product; onClose: () => void }) {
  const exp = currencyExponent(trip.currency);
  const [f, setF] = useState({
    title: product?.title ?? "",
    description: product?.description ?? "",
    price: minorToText(product?.priceMinor, exp),
    fee: product ? String(product.fee || "") : trip.defaultFee ? String(trip.defaultFee) : "",
    quota: product?.quota !== null && product?.quota !== undefined ? String(product.quota) : "",
    weight: product?.estWeightG ? String(product.estWeightG) : "",
    variants: product?.variants.join(", ") ?? "",
    status: product?.status ?? "active",
    photoKey: product?.photoKey ?? null,
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const photo = useUpload();
  const create = useTenantAction<ProductInput>("post", `/trips/${trip.id}/products`, "Barang ditambahkan");
  const update = useTenantAction<Partial<ProductInput>>("patch", `/products/${product?.id}`, "Barang disimpan");
  const priceMinor = textToMinor(f.price, exp);
  const valid = f.title.trim().length >= 2 && f.price && !Number.isNaN(priceMinor);

  function submit() {
    const body: ProductInput = {
      title: f.title.trim(),
      description: f.description.trim() || null,
      priceMinor,
      fee: f.fee ? textToMinor(f.fee, 0) : 0,
      quota: f.quota ? Number(f.quota) : null,
      estWeightG: f.weight ? Number(f.weight) : null,
      variants: splitVariants(f.variants),
      photoKey: f.photoKey,
      status: f.status as ProductInput["status"],
    };
    (product ? update : create).mutate(body, { onSuccess: onClose });
  }

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()} title={product ? "Ubah barang" : "Barang baru"} detents={["large"]}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) submit();
        }}
      >
        <div className="mb-6 flex justify-center">
          <PhotoPicker label="Foto barang" value={media(f.photoKey)} busy={photo.busy} onPick={async (file) => {
            const key = await photo.upload(file, "product");
            if (key) setF((x) => ({ ...x, photoKey: key }));
          }} className="w-32" />
        </div>
        <ListSection>
          <Field label="Nama">{(id) => <Input id={id} value={f.title} onChange={set("title")} placeholder="Tokyo Banana 8 pcs" maxLength={120} />}</Field>
          <Field label={`Harga (${trip.currency})`}>{(id) => <Input id={id} value={f.price} onChange={set("price")} inputMode="decimal" />}</Field>
          <Field label="Fee jasa (Rp)">{(id) => <Input id={id} value={f.fee} onChange={set("fee")} inputMode="numeric" placeholder="0" />}</Field>
        </ListSection>
        <ListSection footer="Pisahkan varian dengan koma, misalnya: S, M, L. Kosongkan kuota kalau tidak dibatasi.">
          <Field label="Varian">{(id) => <Input id={id} value={f.variants} onChange={set("variants")} placeholder="S, M, L" />}</Field>
          <Field label="Kuota">{(id) => <Input id={id} value={f.quota} onChange={set("quota")} inputMode="numeric" placeholder="Tidak dibatasi" />}</Field>
          <Field label="Berat (gram)">{(id) => <Input id={id} value={f.weight} onChange={set("weight")} inputMode="numeric" placeholder="Opsional" />}</Field>
        </ListSection>
        <ListSection header="Deskripsi">
          <div className="px-4 py-2">
            <TextArea value={f.description} onChange={set("description")} aria-label="Deskripsi" maxLength={1000} />
          </div>
        </ListSection>
        {product && (
          <ListSection header="Tampil di toko">
            <div className="p-4">
              <Segmented
                label="Status barang"
                value={f.status}
                onChange={(v) => setF({ ...f, status: v })}
                options={[
                  { value: "active", label: "Tampil" },
                  { value: "sold_out", label: "Habis" },
                  { value: "hidden", label: "Sembunyi" },
                ]}
              />
            </div>
          </ListSection>
        )}
        {product && <Waitlist productId={product.id} />}
        <Button type="submit" size="lg" block disabled={!valid || photo.busy || create.isPending || update.isPending}>
          {product ? "Simpan" : "Tambah"}
        </Button>
      </form>
    </Sheet>
  );
}

type WaitlistEntry = { id: string; name: string; phone: string; createdAt: number; notifiedAt: number | null };

/** People who asked to be told when this product frees up. The seller reaches out by WhatsApp. */
function Waitlist({ productId }: { productId: string }) {
  const q = useTenantQuery<WaitlistEntry[]>(["waitlist", productId], `/products/${productId}/waitlist`);
  if (!q.data?.length) return null;
  return (
    <ListSection header={`Daftar tunggu · ${q.data.length}`} footer="Kabari mereka saat ada pesanan yang batal atau kuota ditambah.">
      {q.data.map((w) => (
        <ListRow key={w.id} title={w.name} subtitle={`${w.phone} · ${fmtRelative(w.createdAt)}`} href={waLink(w.phone, `Halo Kak ${w.name}, slot yang kamu tunggu sudah ada lagi.`)} />
      ))}
    </ListSection>
  );
}
