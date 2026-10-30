import { currencyExponent, formatForeign, formatRupiah, itemPriceRupiah, type CheckoutInput, type Rounding } from "@bawaan/shared";
import { Flag, ImageOff, MessageCircle, PackagePlus, PackageSearch, ShoppingBag, Trash2 } from "lucide-react";
import { useCallback, useState } from "react";
import { api, errorMessage } from "../lib/api";
import { fmtDate, fmtRelative, textToMinor } from "../lib/format";
import { ROOT_DOMAIN, surfaceUrl } from "../lib/links";
import { navigate } from "../lib/router";
import { media } from "../lib/types";
import { Button } from "../ui/Button";
import { EmptyState, useHud } from "../ui/Feedback";
import { Field, Input, Select, Stepper, TextArea, TextInput } from "../ui/Form";
import { ListRow, ListSection } from "../ui/List";
import { Pill } from "../ui/Pill";
import { Segmented } from "../ui/Segmented";
import { Sheet } from "../ui/Sheet";
import { Switch } from "../ui/Switch";
import { cartCount, knownOrders, saveOrderToken, useCart, type Cart, type StoreData, type StoreProduct, type StoreTrip } from "./data";
import { Turnstile } from "./Turnstile";

export const priceOf = (trip: StoreTrip, priceMinor: number, fee: number) =>
  itemPriceRupiah({ priceMinor, currency: trip.currency, kursMicro: BigInt(trip.kursMicro), feeRupiah: fee, rounding: trip.rounding as Rounding });

const newKey = () => crypto.randomUUID();

export function Catalog({ data }: { data: StoreData }) {
  // PO trips come first; the ready-stock shelf is always open, so it'd otherwise crowd the list.
  const trips = [...data.trips.filter((t) => t.kind !== "ready"), ...data.trips.filter((t) => t.kind === "ready")];
  const [tripId, setTripId] = useState(trips[0]?.id ?? "");
  const trip = trips.find((t) => t.id === tripId) ?? trips[0];
  const orders = knownOrders();

  return (
    <>
      {data.store.paused && <p className="mb-4 rounded-[14px] bg-[color-mix(in_srgb,var(--orange)_14%,transparent)] p-4 text-subhead">Toko sedang tutup sementara dan belum menerima pesanan baru. Pesanan yang sudah ada tetap bisa dilacak.</p>}
      {data.store.demo && (
        <p className="mb-4 rounded-[14px] bg-[color-mix(in_srgb,var(--tint)_12%,transparent)] p-4 text-subhead">
          Ini toko contoh. Silakan lihat katalog dan coba keranjangnya, tapi pesanan tidak diproses.{" "}
          <a href={surfaceUrl("app")} className="font-semibold text-tint-text">Buat toko gratis</a>
        </p>
      )}
      {data.store.isNew && !data.store.demo && (
        <p className="mb-4 flex items-start gap-2 text-footnote text-label-2">
          <Pill tone="blue">Toko baru</Pill> Baru bergabung di Bawaan. Pastikan transfer hanya ke rekening yang tertera di tagihan.
        </p>
      )}
      {orders.length > 0 && (
        <ListSection header="Pesananmu">
          {orders.slice(-3).reverse().map((code) => (
            <ListRow key={code} icon={<PackageSearch />} title={code} chevron onClick={() => navigate(`/o/${code}`)} />
          ))}
        </ListSection>
      )}
      {!trip ? (
        <EmptyState icon={<ShoppingBag />} title="Belum ada PO yang dibuka" body="Trip berikutnya akan muncul di sini. Tanya seller lewat WhatsApp untuk jadwalnya." />
      ) : (
        <>
          {trips.length > 1 && <Segmented label="Pilih trip" value={trip.id} onChange={setTripId} className="mb-5" options={trips.map((t) => ({ value: t.id, label: t.title }))} />}
          <TripView key={trip.id} trip={trip} data={data} />
        </>
      )}
      <StoreFooter data={data} />
    </>
  );
}

function StoreFooter({ data }: { data: StoreData }) {
  const [reporting, setReporting] = useState(false);
  return (
    <footer className="mt-10 flex flex-col items-center gap-2 pb-6 text-center text-footnote text-label-2">
      {data.store.branding && (
        <a href={`https://${ROOT_DOMAIN}`} className="text-label-2">
          Dibuat dengan <span className="font-semibold text-tint-text">Bawaan</span>
        </a>
      )}
      <button type="button" className="inline-flex items-center gap-1 text-label-2 underline-offset-2 hover:underline" onClick={() => setReporting(true)}>
        <Flag className="size-3.5" /> Laporkan toko ini
      </button>
      {reporting && <ReportSheet onClose={() => setReporting(false)} />}
    </footer>
  );
}

function ReportSheet({ onClose }: { onClose: () => void }) {
  const hud = useHud();
  const [reason, setReason] = useState("");
  const [contact, setContact] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()} title="Laporkan toko" detents={["medium"]}>
      <ListSection footer="Contoh: memakai nama bank atau brand untuk minta transfer, barang tidak pernah dikirim. Laporan dibaca tim Bawaan, bukan oleh toko.">
        <div className="px-4 py-2">
          <TextArea value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Apa yang terjadi" placeholder="Apa yang terjadi?" maxLength={1000} />
        </div>
        <Field label="Kontakmu (opsional)">{(id) => <Input id={id} value={contact} onChange={(e) => setContact(e.target.value)} placeholder="Email atau WhatsApp" />}</Field>
      </ListSection>
      <Button
        block
        size="lg"
        variant="destructive"
        disabled={reason.trim().length < 10 || busy}
        onClick={async () => {
          setBusy(true);
          try {
            await api.post("/api/store/report", { reason: reason.trim(), contact: contact.trim() || undefined });
            hud("Terima kasih, laporanmu sudah kami terima");
            onClose();
          } catch (e) {
            hud(errorMessage(e), "error");
          } finally {
            setBusy(false);
          }
        }}
      >
        Kirim laporan
      </Button>
    </Sheet>
  );
}

function WaitlistForm({ productId, onDone }: { productId: string; onDone: () => void }) {
  const hud = useHud();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <ListSection header="Kabari aku kalau ada slot" footer="Seller akan menghubungimu lewat WhatsApp kalau ada pesanan yang batal.">
      <Field label="Nama">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />}</Field>
      <Field label="WhatsApp">{(id) => <Input id={id} value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" autoComplete="tel" />}</Field>
      <div className="p-4">
        <Button
          block
          disabled={busy || name.trim().length < 2 || phone.replace(/\D/g, "").length < 9}
          onClick={async () => {
            setBusy(true);
            try {
              await api.post("/api/store/waitlist", { productId, name: name.trim(), phone });
              hud("Kamu masuk daftar tunggu");
              onDone();
            } catch (e) {
              hud(errorMessage(e), "error");
            } finally {
              setBusy(false);
            }
          }}
        >
          Masuk daftar tunggu
        </Button>
      </div>
    </ListSection>
  );
}

function TripView({ trip, data }: { trip: StoreTrip; data: StoreData }) {
  const [cart, setCart] = useCart(trip.id);
  const [product, setProduct] = useState<StoreProduct | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const count = cartCount(cart);
  const closed = trip.closesAt < Date.now() || data.store.paused;
  const ready = trip.kind === "ready";

  return (
    <>
      <section className="mb-6 rounded-[var(--radius-card)] bg-elevated p-5">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-title2">{trip.title}</h2>
          {ready ? <Pill tone="green">Langsung kirim</Pill> : <Pill tone={closed ? "red" : "green"}>{closed ? "PO ditutup" : `Tutup ${fmtRelative(trip.closesAt)}`}</Pill>}
        </div>
        <p className="mt-1 text-subhead text-label-2">
          {ready ? (
            "Barang sudah di Indonesia · bayar penuh, langsung dikirim"
          ) : (
            <>
              {trip.country} · PO sampai {fmtDate(trip.closesAt)}
              {trip.etaAt && ` · perkiraan tiba ${fmtDate(trip.etaAt)}`}
              {trip.dpPercent > 0 && trip.dpPercent < 100 && ` · DP ${trip.dpPercent}%`}
            </>
          )}
        </p>
        {trip.note && <p className="mt-3 whitespace-pre-line text-body">{trip.note}</p>}
      </section>

      <div className="mb-8 grid grid-cols-2 gap-3 regular:grid-cols-3 wide:grid-cols-4">
        {trip.products.map((p) => (
          <button key={p.id} type="button" onClick={() => setProduct(p)} className="overflow-hidden rounded-[20px] bg-elevated text-left transition-transform active:scale-[0.98]">
            <div className="relative aspect-square bg-fill-4">
              {p.photoKey ? <img src={media(p.photoKey)!} alt="" loading="lazy" className="size-full object-cover" /> : <ImageOff className="absolute inset-0 m-auto size-8 text-label-3" />}
              {p.status === "sold_out" && <span className="absolute inset-x-0 bottom-0 bg-black/55 py-1 text-center text-footnote font-semibold text-white">Habis</span>}
            </div>
            <div className="p-3">
              <p className="line-clamp-2 text-subhead font-semibold">{p.title}</p>
              <p className="mt-1 text-body font-semibold tabular text-tint-text">{formatRupiah(priceOf(trip, p.priceMinor, p.fee))}</p>
              <p className="text-footnote text-label-2 tabular">
                {ready ? "Ready" : formatForeign(p.priceMinor, trip.currency)}
                {p.left !== null && p.status === "active" && ` · sisa ${p.left}`}
              </p>
            </div>
          </button>
        ))}
        {!closed && !ready && (
          <button type="button" onClick={() => setRequesting(true)} className="flex min-h-48 flex-col items-center justify-center gap-2 rounded-[20px] border-2 border-dashed border-separator p-4 text-center text-tint-text">
            <PackagePlus className="size-8" />
            <span className="text-subhead font-semibold">Titip barang lain</span>
            <span className="text-footnote text-label-2">Kirim link atau nama barangnya</span>
          </button>
        )}
      </div>

      {count > 0 && (
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-[max(var(--safe-bottom),16px)]">
          <Button size="lg" className="pointer-events-auto w-full max-w-[480px] shadow-xl" icon={<ShoppingBag className="size-5" />} onClick={() => setCartOpen(true)}>
            Keranjang · {count} barang
          </Button>
        </div>
      )}

      {product && <ProductSheet trip={trip} product={product} closed={closed} cart={cart} setCart={setCart} onClose={() => setProduct(null)} />}
      {requesting && <RequestSheet trip={trip} cart={cart} setCart={setCart} onClose={() => setRequesting(false)} />}
      {cartOpen && <CheckoutSheet trip={trip} data={data} cart={cart} setCart={setCart} onClose={() => setCartOpen(false)} />}
    </>
  );
}

function ProductSheet({ trip, product: p, closed, cart, setCart, onClose }: { trip: StoreTrip; product: StoreProduct; closed: boolean; cart: Cart; setCart: (c: Cart) => void; onClose: () => void }) {
  const hud = useHud();
  const [variant, setVariant] = useState(p.variants[0] ?? "");
  const [qty, setQty] = useState(1);
  const [onUnavailable, setOnUnavailable] = useState<"refund" | "substitute" | "ask">("refund");
  const [note, setNote] = useState("");
  const max = Math.min(99, p.left ?? 99);
  const ready = trip.kind === "ready";
  const [waited, setWaited] = useState(false);
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()} title={p.title} detents={["large"]}>
      {p.photoKey && <img src={media(p.photoKey)!} alt={p.title} className="mb-4 aspect-square w-full rounded-[20px] object-cover" />}
      <p className="text-title2 tabular">{formatRupiah(priceOf(trip, p.priceMinor, p.fee))}</p>
      <p className="mb-4 text-subhead text-label-2 tabular">
        {ready ? (
          "Barang ready, bayar penuh lalu langsung dikirim"
        ) : (
          <>
            {formatForeign(p.priceMinor, trip.currency)}
            {p.fee > 0 && ` + jasa ${formatRupiah(p.fee)}`} · harga final mengikuti struk
          </>
        )}
      </p>
      {p.description && <p className="mb-6 whitespace-pre-line text-body">{p.description}</p>}
      {p.status === "sold_out" || closed ? (
        <>
          <p className="mb-4 rounded-[14px] bg-fill-4 p-4 text-center text-body text-label-2">{closed ? "PO trip ini sudah ditutup." : "Kuota barang ini sudah habis."}</p>
          {!closed && !waited && <WaitlistForm productId={p.id} onDone={() => setWaited(true)} />}
        </>
      ) : (
        <>
          <ListSection>
            {p.variants.length > 0 && (
              <Field label="Varian">
                {(id) => (
                  <Select id={id} value={variant} onChange={(e) => setVariant(e.target.value)}>
                    {p.variants.map((v) => (
                      <option key={v}>{v}</option>
                    ))}
                  </Select>
                )}
              </Field>
            )}
            <Field label="Jumlah">{() => <div className="flex justify-end"><Stepper value={qty} onChange={setQty} max={max} label="Jumlah" /></div>}</Field>
            {!ready && <Field label="Kalau tidak dapat">
              {(id) => (
                <Select id={id} value={onUnavailable} onChange={(e) => setOnUnavailable(e.target.value as typeof onUnavailable)}>
                  <option value="refund">Uang kembali</option>
                  <option value="substitute">Boleh diganti mirip</option>
                  <option value="ask">Tanya aku dulu</option>
                </Select>
              )}
            </Field>}
          </ListSection>
          <ListSection header="Catatan (opsional)">
            <div className="px-4 py-2">
              <TextArea value={note} onChange={(e) => setNote(e.target.value)} aria-label="Catatan" maxLength={300} placeholder="Contoh: warna yang paling terang" className="min-h-14" />
            </div>
          </ListSection>
          <Button
            size="lg"
            block
            onClick={() => {
              setCart({ ...cart, lines: [...cart.lines, { key: newKey(), productId: p.id, variant: variant || undefined, qty, onUnavailable, note: note.trim() || undefined }] });
              hud("Masuk keranjang");
              onClose();
            }}
          >
            Tambah ke keranjang · {formatRupiah(priceOf(trip, p.priceMinor, p.fee) * qty)}
          </Button>
        </>
      )}
    </Sheet>
  );
}

function RequestSheet({ trip, cart, setCart, onClose }: { trip: StoreTrip; cart: Cart; setCart: (c: Cart) => void; onClose: () => void }) {
  const [f, setF] = useState({ title: "", link: "", note: "", max: "" });
  const [qty, setQty] = useState(1);
  const exp = currencyExponent(trip.currency);
  const maxMinor = f.max.trim() ? textToMinor(f.max, exp) : undefined;
  const linkOk = !f.link.trim() || /^https?:\/\/\S+$/i.test(f.link.trim());
  const valid = f.title.trim().length >= 2 && linkOk && (maxMinor === undefined || !Number.isNaN(maxMinor));
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()} title="Titip barang" detents={["large"]}>
      <p className="mb-4 text-center text-subhead text-label-2">Seller akan mengisi harganya sebelum pesanan dikonfirmasi.</p>
      <ListSection>
        <Field label="Nama barang">{(id) => <Input id={id} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Sanrio pouch Kuromi" autoFocus />}</Field>
        <Field label="Link" error={linkOk ? null : "Link harus diawali https://"}>{(id) => <Input id={id} value={f.link} onChange={(e) => setF({ ...f, link: e.target.value })} inputMode="url" placeholder="Opsional" />}</Field>
        <Field label="Jumlah">{() => <div className="flex justify-end"><Stepper value={qty} onChange={setQty} label="Jumlah" /></div>}</Field>
        <Field label={`Harga maks (${trip.currency})`}>{(id) => <Input id={id} value={f.max} onChange={(e) => setF({ ...f, max: e.target.value })} inputMode="decimal" placeholder="Opsional" />}</Field>
      </ListSection>
      <ListSection header="Detail (ukuran, warna, dll.)">
        <div className="px-4 py-2">
          <TextArea value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} aria-label="Detail" maxLength={300} className="min-h-14" />
        </div>
      </ListSection>
      <Button
        size="lg"
        block
        disabled={!valid}
        onClick={() => {
          setCart({ ...cart, requests: [...cart.requests, { key: newKey(), title: f.title.trim(), link: f.link.trim() || undefined, note: f.note.trim() || undefined, qty, maxPriceMinor: maxMinor }] });
          onClose();
        }}
      >
        Tambah ke keranjang
      </Button>
    </Sheet>
  );
}

function CheckoutSheet({ trip, data, cart, setCart, onClose }: { trip: StoreTrip; data: StoreData; cart: Cart; setCart: (c: Cart) => void; onClose: () => void }) {
  const [step, setStep] = useState<"cart" | "form">("cart");
  const [customer, setCustomer] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("bawaan.me") ?? "null") ?? { name: "", phone: "" };
    } catch {
      return { name: "", phone: "" };
    }
  });
  const [withAddress, setWithAddress] = useState<"later" | "ship">("later");
  const [addr, setAddr] = useState({ line: "", city: "", province: "", postalCode: "" });
  const [notes, setNotes] = useState("");
  const [hold, setHold] = useState(false);
  const [agree, setAgree] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [idem] = useState(newKey);
  const onToken = useCallback((t: string | null) => setToken(t), []);

  const byId = new Map(trip.products.map((p) => [p.id, p]));
  const lines = cart.lines.filter((l) => byId.has(l.productId));
  const subtotal = lines.reduce((s, l) => s + priceOf(trip, byId.get(l.productId)!.priceMinor, byId.get(l.productId)!.fee) * l.qty, 0);
  const dp = trip.dpPercent > 0 && trip.dpPercent < 100 ? Math.ceil((subtotal * trip.dpPercent) / 100) : null;
  const policy = data.store.policyText.split("\n").filter((l) => l.trim());
  const needsToken = !!data.turnstileSiteKey;
  const formValid = customer.name.trim().length >= 2 && customer.phone.replace(/\D/g, "").length >= 9 && agree && (!needsToken || token) && (withAddress === "later" || (addr.line.trim().length >= 5 && addr.city.trim().length >= 2));

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const body: CheckoutInput = {
        tripId: trip.id,
        customer: { name: customer.name.trim(), phone: customer.phone },
        address:
          withAddress === "ship"
            ? { recipient: customer.name.trim(), phone: customer.phone, line: addr.line.trim(), city: addr.city.trim(), province: addr.province.trim() || undefined, postalCode: addr.postalCode.trim() || undefined }
            : undefined,
        items: lines.map((l) => ({ productId: l.productId, variant: l.variant, qty: l.qty, onUnavailable: l.onUnavailable, note: l.note })),
        requests: cart.requests.map((r) => ({ title: r.title, link: r.link, note: r.note, qty: r.qty, maxPriceMinor: r.maxPriceMinor })),
        notes: notes.trim() || undefined,
        holdForCombine: hold,
        idempotencyKey: idem,
        turnstileToken: token ?? undefined,
      };
      const res = await api.post<{ code: string; token: string }>("/api/store/checkout", body);
      try {
        localStorage.setItem("bawaan.me", JSON.stringify({ name: customer.name.trim(), phone: customer.phone }));
      } catch {}
      saveOrderToken(res.code, res.token);
      setCart({ lines: [], requests: [] });
      onClose();
      navigate(`/o/${res.code}?baru=1`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()} title={step === "cart" ? "Keranjang" : "Data pemesan"} detents={["large"]}>
      {step === "cart" ? (
        <>
          <ListSection>
            {lines.map((l) => {
              const p = byId.get(l.productId)!;
              return (
                <ListRow
                  key={l.key}
                  title={`${p.title}${l.variant ? ` · ${l.variant}` : ""}`}
                  subtitle={`${l.qty} × ${formatRupiah(priceOf(trip, p.priceMinor, p.fee))}`}
                  trailing={
                    <button type="button" aria-label={`Hapus ${p.title}`} className="flex size-8 items-center justify-center text-red-text" onClick={() => setCart({ ...cart, lines: cart.lines.filter((x) => x.key !== l.key) })}>
                      <Trash2 className="size-4" />
                    </button>
                  }
                />
              );
            })}
            {cart.requests.map((r) => (
              <ListRow
                key={r.key}
                title={r.title}
                subtitle={`${r.qty} pcs · titipan, harga dari seller${r.maxPriceMinor !== undefined ? ` · maks ${formatForeign(r.maxPriceMinor, trip.currency)}` : ""}`}
                trailing={
                  <button type="button" aria-label={`Hapus ${r.title}`} className="flex size-8 items-center justify-center text-red-text" onClick={() => setCart({ ...cart, requests: cart.requests.filter((x) => x.key !== r.key) })}>
                    <Trash2 className="size-4" />
                  </button>
                }
              />
            ))}
          </ListSection>
          <ListSection footer="Harga final mengikuti struk belanja. Tagihan dikirim setelah seller mengonfirmasi pesananmu.">
            <ListRow title="Perkiraan total katalog" value={formatRupiah(subtotal)} />
            {dp !== null && <ListRow title={`DP ${trip.dpPercent}%`} value={`± ${formatRupiah(dp)}`} />}
            {cart.requests.length > 0 && <ListRow title="Barang titipan" value={`${cart.requests.length} jenis`} />}
          </ListSection>
          <Button size="lg" block disabled={!lines.length && !cart.requests.length} onClick={() => setStep("form")}>
            Lanjut
          </Button>
        </>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (formValid && !busy) submit();
          }}
        >
          <ListSection footer="Nomor ini dipakai untuk melacak pesanan dan dihubungi seller.">
            <Field label="Nama">{(id) => <Input id={id} value={customer.name} onChange={(e) => setCustomer({ ...customer, name: e.target.value })} autoComplete="name" />}</Field>
            <Field label="WhatsApp">{(id) => <Input id={id} value={customer.phone} onChange={(e) => setCustomer({ ...customer, phone: e.target.value })} inputMode="tel" autoComplete="tel" placeholder="0812…" />}</Field>
          </ListSection>
          <ListSection header="Alamat kirim">
            <div className="p-4">
              <Segmented label="Alamat" value={withAddress} onChange={setWithAddress} options={[{ value: "later", label: "Nanti saja" }, { value: "ship", label: "Isi sekarang" }]} />
            </div>
            {withAddress === "ship" && (
              <>
                <Field label="Alamat" stacked>{(id) => <TextInput id={id} value={addr.line} onChange={(e) => setAddr({ ...addr, line: e.target.value })} autoComplete="street-address" />}</Field>
                <Field label="Kota">{(id) => <Input id={id} value={addr.city} onChange={(e) => setAddr({ ...addr, city: e.target.value })} autoComplete="address-level2" />}</Field>
                <Field label="Provinsi">{(id) => <Input id={id} value={addr.province} onChange={(e) => setAddr({ ...addr, province: e.target.value })} autoComplete="address-level1" />}</Field>
                <Field label="Kode pos">{(id) => <Input id={id} value={addr.postalCode} onChange={(e) => setAddr({ ...addr, postalCode: e.target.value })} inputMode="numeric" autoComplete="postal-code" />}</Field>
              </>
            )}
          </ListSection>
          <ListSection footer="Kalau kamu juga pesan di trip lain, seller menahan paket ini supaya dikirim bareng dan ongkirnya sekali.">
            <Field label="Gabung kirim">
              {(id) => (
                <div className="flex justify-end">
                  <Switch id={id} checked={hold} onChange={(e) => setHold(e.target.checked)} />
                </div>
              )}
            </Field>
          </ListSection>
          <ListSection header="Catatan untuk seller">
            <div className="px-4 py-2">
              <TextArea value={notes} onChange={(e) => setNotes(e.target.value)} aria-label="Catatan" maxLength={500} className="min-h-14" />
            </div>
          </ListSection>
          <ListSection header="Kebijakan toko">
            <ul className="list-disc space-y-1.5 py-4 pl-9 pr-4 text-subhead text-label-2">
              {policy.map((l, i) => (
                <li key={i}>{l.replace(/^[-•]\s*/, "")}</li>
              ))}
            </ul>
            <label className="flex cursor-pointer items-center gap-3 border-t-[0.5px] border-separator px-4 py-3">
              <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="size-5 accent-[var(--tint)]" />
              <span className="text-body">Aku setuju dengan kebijakan ini</span>
            </label>
          </ListSection>
          {data.turnstileSiteKey && (
            <div className="mb-4">
              <Turnstile siteKey={data.turnstileSiteKey} onToken={onToken} />
            </div>
          )}
          {error && (
            <p role="alert" className="mb-4 text-center text-subhead text-red-text">
              {error}
            </p>
          )}
          <Button type="submit" size="lg" block disabled={!formValid || busy}>
            {busy ? "Mengirim…" : "Kirim pesanan"}
          </Button>
        </form>
      )}
    </Sheet>
  );
}

export function TrackForm() {
  const [code, setCode] = useState("");
  const [last4, setLast4] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <ListSection header="Lacak pesanan" footer="Kode pesanan ada di pesan konfirmasi dari seller.">
      <form
        className="flex flex-col gap-3 p-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            const res = await api.post<{ code: string; token: string }>("/api/store/track", { code: code.trim().toUpperCase(), last4 });
            saveOrderToken(res.code, res.token);
            navigate(`/o/${res.code}`);
          } catch (x) {
            setError(errorMessage(x));
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="flex flex-col gap-1">
          <span className="text-footnote text-label-2">Kode pesanan</span>
          <input value={code} onChange={(e) => setCode(e.target.value)} className="min-h-[var(--tap)] rounded-[12px] bg-fill-4 px-3 uppercase outline-none focus:ring-2 focus:ring-tint" placeholder="JPN-2611-K7QD" autoComplete="off" autoCapitalize="characters" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-footnote text-label-2">4 digit terakhir nomor WhatsApp</span>
          <input value={last4} onChange={(e) => setLast4(e.target.value.replace(/\D/g, ""))} className="min-h-[var(--tap)] rounded-[12px] bg-fill-4 px-3 outline-none focus:ring-2 focus:ring-tint" inputMode="numeric" maxLength={4} placeholder="7890" autoComplete="off" />
        </label>
        {error && <p role="alert" className="text-subhead text-red-text">{error}</p>}
        <Button type="submit" icon={<PackageSearch className="size-5" />} disabled={busy || code.trim().length < 6 || last4.length !== 4}>
          Lacak
        </Button>
      </form>
    </ListSection>
  );
}

export function ChatSeller({ wa, text }: { wa: string; text?: string }) {
  return (
    <a href={`https://wa.me/${wa.replace(/\D/g, "")}${text ? `?text=${encodeURIComponent(text)}` : ""}`} target="_blank" rel="noopener noreferrer" className="glass inline-flex h-11 items-center gap-1.5 rounded-full px-4 text-body font-semibold text-green-text">
      <MessageCircle className="size-5" /> Chat
    </a>
  );
}
