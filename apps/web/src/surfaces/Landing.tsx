import { formatRupiah } from "@bawaan/shared";
import { useEffect, useState } from "react";
import { Boxes, Check, ClipboardList, FileText, Plane, Store as StoreIcon } from "lucide-react";
import { LinkButton } from "../ui/Button";
import { surfaceUrl } from "../lib/links";
import { Wordmark } from "../ui/Logo";
import { Pill } from "../ui/Pill";
import { demoOrders, itemStatus } from "./demo-data";

const features = [
  { icon: <ClipboardList />, title: "Pelanggan pesan sendiri", body: "Bagikan link toko. Pesanan masuk rapi lengkap dengan varian dan nomor WhatsApp, tanpa salin dari DM ke Excel." },
  { icon: <Check />, title: "Status per barang", body: "Tandai Dapat, Dapat sebagian, atau Tidak dapat langsung dari toko. Foto barang dan struk ikut tampil ke pelanggan." },
  { icon: <Plane />, title: "Satu update, semua tahu", body: "Ubah status satu batch kargo, dan semua pelanggan di dalamnya langsung melihat posisi barangnya." },
  { icon: <FileText />, title: "Invoice otomatis", body: "DP, pelunasan, ongkir kargo per kg, sampai selisih harga. Kode unik bikin cek transfer lebih cepat." },
];

const steps = [
  { title: "Masuk pakai Gmail", body: "Pilih nama toko dan dapatkan alamat namatoko.bawaan.my.id." },
  { title: "Buka trip PO", body: "Isi negara, kurs, tanggal tutup, dan daftar barang." },
  { title: "Bagikan link", body: "Pelanggan pesan, bayar, dan pantau barangnya sendiri." },
];

export default function Landing() {
  const order = demoOrders[0]!;
  return (
    <div className="min-h-dvh overflow-x-clip bg-bg">
      <header className="sticky top-0 z-30 pt-[var(--safe-top)]">
        <div className="glass mx-auto mt-2 flex h-14 w-[min(1100px,calc(100%-24px))] items-center justify-between rounded-full pl-4 pr-2">
          <Wordmark />
          <LinkButton href={surfaceUrl("app")} size="sm">Masuk</LinkButton>
        </div>
      </header>

      <main className="mx-auto w-[min(1100px,calc(100%-32px))]">
        <section className="grid items-center gap-10 py-14 regular:py-20 min-[1024px]:grid-cols-[1.1fr_1fr]">
          <div>
            <p className="mb-3 text-subhead font-semibold text-tint-text">Aplikasi untuk seller jastip & PO luar negeri</p>
            <h1 className="text-[clamp(2.2rem,6vw,3.6rem)] font-bold leading-[1.05] tracking-[-0.035em]">
              Jastip rapi,
              <br />
              pelanggan tenang.
            </h1>
            <p className="mt-5 max-w-[34rem] text-[1.1rem] leading-relaxed text-label-2">
              Pesanan, invoice, dan status kargo dalam satu link. Pelanggan cek sendiri barangnya dapat atau tidak, tanpa tanya admin berulang kali.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <LinkButton href={surfaceUrl("app")} size="lg">Buat toko gratis</LinkButton>
              <LinkButton href={surfaceUrl("demo")} size="lg" variant="gray" icon={<StoreIcon className="size-5" />}>Lihat contoh toko</LinkButton>
            </div>
            <p className="mt-4 text-footnote text-label-2">Daftar pakai Gmail. Tanpa kartu kredit.</p>
          </div>

          <div className="relative mx-auto w-full max-w-[380px]" aria-label="Contoh halaman lacak pesanan" role="img">
            <div className="absolute -inset-10 -z-0 rounded-full bg-[radial-gradient(closest-side,color-mix(in_srgb,var(--tint)_22%,transparent),transparent)]" aria-hidden />
            <div className="relative rounded-[44px] bg-grouped p-4 shadow-[0_30px_80px_-20px_rgb(0_0_0/0.35)] ring-1 ring-separator">
              <div className="px-1 pb-3 pt-2">
                <div className="text-footnote text-label-2">{order.trip}</div>
                <div className="text-title2">Pesanan {order.code}</div>
              </div>
              <div className="overflow-hidden rounded-[var(--radius-card)] bg-elevated">
                {order.items.map((it) => {
                  const s = itemStatus[it.status];
                  return (
                    <div key={it.title} className="flex items-center gap-3 border-b-[0.5px] border-separator px-3 py-2.5 last:border-0">
                      <div className="size-11 shrink-0 rounded-[10px]" style={{ background: `oklch(0.86 0.09 ${it.hue})` }} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-subhead font-semibold">{it.title}</div>
                        <Pill tone={s.tone} icon={s.icon} className="mt-1">{s.label}</Pill>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="mt-3 flex items-center justify-between rounded-[var(--radius-card)] bg-elevated px-4 py-3">
                <div>
                  <div className="text-footnote text-label-2">Sisa pelunasan</div>
                  <div className="text-headline tabular">{formatRupiah(order.due)}</div>
                </div>
                <span className="rounded-full bg-tint px-3 py-1.5 text-subhead font-semibold text-white">Bayar</span>
              </div>
            </div>
          </div>
        </section>

        <section className="py-10" aria-labelledby="fitur">
          <h2 id="fitur" className="text-title1">Yang biasanya bikin repot, sekarang beres</h2>
          <div className="mt-6 grid gap-4 regular:grid-cols-2 wide:grid-cols-4">
            {features.map((f) => (
              <div key={f.title} className="rounded-[var(--radius-card)] bg-card p-5">
                <div className="mb-4 inline-flex size-10 items-center justify-center rounded-[12px] bg-tint text-white [&_svg]:size-5">{f.icon}</div>
                <h3 className="text-headline">{f.title}</h3>
                <p className="mt-2 text-subhead text-label-2">{f.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="py-10" aria-labelledby="cara">
          <h2 id="cara" className="text-title1">Mulai dalam 10 menit</h2>
          <ol className="mt-6 grid gap-4 regular:grid-cols-3">
            {steps.map((s, i) => (
              <li key={s.title} className="flex gap-4 rounded-[var(--radius-card)] bg-card p-5">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-fill-3 text-headline text-tint-text tabular">{i + 1}</span>
                <div>
                  <h3 className="text-headline">{s.title}</h3>
                  <p className="mt-1 text-subhead text-label-2">{s.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <ReadyStock />

        <section className="py-10" aria-labelledby="harga">
          <h2 id="harga" className="text-title1">Harga</h2>
          <div className="mt-6 grid gap-4 regular:grid-cols-2">
            <div className="rounded-[var(--radius-card)] bg-card p-6">
              <h3 className="text-title3">Gratis</h3>
              <p className="mt-1 text-large-title tabular">Rp 0</p>
              <ul className="mt-4 space-y-2 text-subhead text-label-2">
                <li>1 trip aktif</li>
                <li>100 barang pesanan per bulan</li>
                <li>Halaman lacak & invoice untuk pelanggan</li>
              </ul>
            </div>
            <div className="rounded-[var(--radius-card)] bg-card p-6 ring-2 ring-tint">
              <h3 className="text-title3">Pro</h3>
              <p className="mt-1 text-large-title tabular">
                {formatRupiah(49_000)}
                <span className="text-body font-normal text-label-2">/bulan</span>
              </p>
              <ul className="mt-4 space-y-2 text-subhead text-label-2">
                <li>Trip & pesanan tanpa batas</li>
                <li>Sampai 5 admin</li>
                <li>Laporan untung per trip & ekspor data</li>
                <li>Tanpa label “Dibuat dengan Bawaan”</li>
              </ul>
            </div>
          </div>
        </section>
      </main>

      <footer className="mx-auto mt-10 flex w-[min(1100px,calc(100%-32px))] flex-wrap items-center justify-between gap-3 border-t-[0.5px] border-separator py-8 pb-[max(var(--safe-bottom),32px)] text-footnote text-label-2">
        <span className="inline-flex items-center gap-2"><Boxes className="size-4" /> Bawaan · bawaan.my.id</span>
        <span className="flex flex-wrap gap-x-5 gap-y-2">
          <a href={surfaceUrl("landing", "/privasi")}>Kebijakan privasi</a>
          <a href={surfaceUrl("landing", "/syarat")}>Syarat layanan</a>
        </span>
      </footer>
    </div>
  );
}

type MarketItem = { id: string; title: string; price: number; photoKey: string | null; store: string; url: string; left: number | null };

/** Ready stock from every store, so a buyer can find something available today without waiting for a PO. */
function ReadyStock() {
  const [items, setItems] = useState<MarketItem[]>([]);
  useEffect(() => {
    const ctrl = new AbortController();
    fetch("/api/market", { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d: { items: MarketItem[] }) => setItems(d.items))
      .catch(() => {});
    return () => ctrl.abort();
  }, []);
  if (!items.length) return null;
  return (
    <section className="py-10" aria-labelledby="ready">
      <h2 id="ready" className="text-title1">Ready stock hari ini</h2>
      <p className="mt-2 text-body text-label-2">Barang yang sudah ada di Indonesia dari toko-toko jastip di Bawaan. Bayar penuh, langsung dikirim.</p>
      <div className="mt-6 grid grid-cols-2 gap-3 regular:grid-cols-3 wide:grid-cols-4">
        {items.slice(0, 12).map((i) => (
          <a key={i.id} href={i.url} className="overflow-hidden rounded-[20px] bg-card">
            <div className="aspect-square bg-fill-4">{i.photoKey && <img src={`/media/${i.photoKey}`} alt="" loading="lazy" className="size-full object-cover" />}</div>
            <div className="p-3">
              <p className="line-clamp-2 text-subhead font-semibold">{i.title}</p>
              <p className="mt-1 text-body font-semibold tabular text-tint-text">{formatRupiah(i.price)}</p>
              <p className="truncate text-footnote text-label-2">{i.store}</p>
            </div>
          </a>
        ))}
      </div>
    </section>
  );
}
