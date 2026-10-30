import { formatRupiah } from "@bawaan/shared";
import { Bell, ChevronLeft, Landmark, MessageCircle, Plus, Search, Shapes } from "lucide-react";
import { useState, type ReactNode } from "react";
import { REGULAR, useMediaQuery } from "../lib/useMediaQuery";
import { AppShell, SplitView, type NavItem } from "../ui/AppShell";
import { Button, IconButton } from "../ui/Button";
import { ListRow, ListSection } from "../ui/List";
import { Wordmark } from "../ui/Logo";
import { NavBar } from "../ui/NavBar";
import { Pill } from "../ui/Pill";
import { Segmented } from "../ui/Segmented";
import { Sheet } from "../ui/Sheet";
import { Switch } from "../ui/Switch";
import { demoOrders, itemStatus, waitingPill, type DemoOrder } from "./demo-data";
import { sellerNav, sidebarNav } from "./nav";

const galleryNav: NavItem[] = [{ id: "components", label: "Komponen", icon: <Shapes />, inTabBar: true, section: "Galeri" }];

export default function Gallery() {
  const regular = useMediaQuery(REGULAR);
  const [active, setActive] = useState("components");
  const items = regular
    ? [...galleryNav, ...sidebarNav]
    : [...galleryNav, ...sellerNav.filter((i) => i.id === "orders" || i.id === "shopping" || i.id === "customers" || i.id === "more")];

  return (
    <AppShell items={items} active={active} onNavigate={setActive} sidebarHeader={<Wordmark />}>
      {({ sidebarToggle }) =>
        active === "orders" ? (
          <OrdersDemo sidebarToggle={sidebarToggle} />
        ) : active === "components" ? (
          <ComponentsDemo sidebarToggle={sidebarToggle} />
        ) : (
          <div className="mx-auto max-w-[760px]">
            <NavBar title={items.find((i) => i.id === active)?.label ?? ""} leading={sidebarToggle} />
            <p className="px-[var(--gutter)] text-body text-label-2">Layar ini dibangun di tahap berikutnya.</p>
          </div>
        )
      }
    </AppShell>
  );
}

function Swatch({ name, color }: { name: string; color: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="size-7 rounded-full ring-1 ring-separator" style={{ background: `var(${color})` }} />
      <span className="text-footnote text-label-2">{name}</span>
    </div>
  );
}

function ComponentsDemo({ sidebarToggle }: { sidebarToggle: ReactNode }) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [view, setView] = useState<"semua" | "aksi" | "selesai">("semua");
  const [decision, setDecision] = useState<"dapat" | "sebagian" | "tidak">("dapat");
  const [push, setPush] = useState(true);

  return (
    <div className="mx-auto max-w-[760px]">
      <NavBar
        title="Komponen"
        leading={sidebarToggle}
        trailing={
          <IconButton label="Buka sheet" onClick={() => setSheetOpen(true)}>
            <Plus className="size-5" />
          </IconButton>
        }
        accessory={
          <Segmented
            label="Filter"
            value={view}
            onChange={setView}
            options={[
              { value: "semua", label: "Semua" },
              { value: "aksi", label: "Perlu aksi" },
              { value: "selesai", label: "Selesai" },
            ]}
          />
        }
      />
      <div className="px-[var(--gutter)]">
        <ListSection header="Tombol">
          <div className="flex flex-wrap gap-3 p-4">
            <Button>Filled</Button>
            <Button variant="tinted">Tinted</Button>
            <Button variant="gray">Gray</Button>
            <Button variant="plain">Plain</Button>
            <Button variant="glass">Glass</Button>
            <Button variant="destructive">Hapus</Button>
            <Button size="sm">Kecil</Button>
            <Button size="lg" block onClick={() => setSheetOpen(true)}>Tandai barang</Button>
          </div>
        </ListSection>

        <ListSection header="Status barang" footer="Selalu ikon + teks, tidak hanya warna.">
          <div className="flex flex-wrap gap-2 p-4">
            {Object.values(itemStatus).map((s) => (
              <Pill key={s.label} tone={s.tone} icon={s.icon}>{s.label}</Pill>
            ))}
            <Pill tone={waitingPill.tone} icon={waitingPill.icon}>{waitingPill.label}</Pill>
            <Pill tone="gray">Draft</Pill>
          </div>
        </ListSection>

        <ListSection header="Pengaturan toko" footer="Contoh baris inset grouped: ikon, nilai, toggle, dan chevron.">
          <ListRow icon={<Landmark />} iconBg="var(--green)" title="Rekening & QRIS" value="BCA" chevron onClick={() => setSheetOpen(true)} />
          <ListRow icon={<MessageCircle />} iconBg="#25d366" title="Nomor WhatsApp" subtitle="+62 812•••890" chevron onClick={() => {}} />
          <ListRow icon={<Bell />} iconBg="var(--red)" title="Notifikasi push" trailing={<Switch checked={push} onChange={(e) => setPush(e.target.checked)} aria-label="Notifikasi push" />} />
          <ListRow title="Keluar dari toko" destructive onClick={() => {}} />
        </ListSection>

        <ListSection header="Tipografi">
          <div className="space-y-1 p-4">
            <div className="text-large-title">Large Title</div>
            <div className="text-title1">Title 1</div>
            <div className="text-title2">Title 2</div>
            <div className="text-title3">Title 3</div>
            <div className="text-headline">Headline</div>
            <div className="text-body">Body — Rp 1.250.317 untuk 3 barang</div>
            <div className="text-callout">Callout</div>
            <div className="text-subhead">Subheadline</div>
            <div className="text-footnote text-label-2">Footnote</div>
            <div className="text-caption1 text-label-2">Caption 1</div>
            <div className="text-caption2 text-label-2">Caption 2</div>
          </div>
        </ListSection>

        <ListSection header="Warna sistem">
          <div className="grid grid-cols-2 gap-3 p-4 regular:grid-cols-4">
            <Swatch name="Tint" color="--tint" />
            <Swatch name="Green" color="--green" />
            <Swatch name="Orange" color="--orange" />
            <Swatch name="Red" color="--red" />
            <Swatch name="Indigo" color="--indigo" />
            <Swatch name="Teal" color="--teal" />
            <Swatch name="Gray" color="--gray" />
            <Swatch name="Fill" color="--fill" />
          </div>
        </ListSection>
      </div>

      <Sheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        title="Tandai barang"
        trailing={<Button size="sm" onClick={() => setSheetOpen(false)}>Simpan</Button>}
      >
        <ListSection header="Uniqlo Airism Tee · M · Putih" footer="Pelanggan memesan 3. Sisa DP masuk ke saldo pelanggan.">
          <div className="p-4">
            <Segmented
              label="Hasil belanja"
              value={decision}
              onChange={setDecision}
              options={[
                { value: "dapat", label: "Dapat" },
                { value: "sebagian", label: "Sebagian" },
                { value: "tidak", label: "Tidak dapat" },
              ]}
            />
          </div>
          <label className="flex items-center gap-3 px-4 pb-3">
            <span className="flex-1 text-body">Harga di toko (¥)</span>
            <input inputMode="numeric" defaultValue="1990" className="w-28 rounded-[10px] bg-fill-4 px-3 py-2 text-right tabular outline-none focus:ring-2 focus:ring-tint" />
          </label>
        </ListSection>
        <Button block size="lg" variant="tinted">Ambil foto struk</Button>
      </Sheet>
    </div>
  );
}

function OrdersDemo({ sidebarToggle }: { sidebarToggle: ReactNode }) {
  const regular = useMediaQuery(REGULAR);
  const [selected, setSelected] = useState<string | null>(regular ? demoOrders[0]!.code : null);
  const order = demoOrders.find((o) => o.code === selected) ?? (regular ? demoOrders[0]! : null);

  const list = (
    <div>
      <NavBar
        title="Pesanan"
        leading={sidebarToggle}
        accessory={
          <label className="flex h-10 items-center gap-2 rounded-full bg-fill-3 px-3 text-label-2">
            <Search className="size-[18px]" />
            <input className="min-w-0 flex-1 bg-transparent text-label outline-none placeholder:text-label-2" placeholder="Cari nama, kode, nomor HP" />
          </label>
        }
      />
      <div className="px-[var(--gutter)] regular:px-3">
        <ListSection>
          {demoOrders.map((o) => (
            <ListRow
              key={o.code}
              title={o.customer}
              subtitle={`${o.code} · ${o.items.length} barang`}
              value={formatRupiah(o.total)}
              chevron={!regular}
              selected={regular && o.code === order?.code}
              onClick={() => setSelected(o.code)}
            />
          ))}
        </ListSection>
      </div>
    </div>
  );

  return <SplitView showDetail={!!selected} list={list} detail={order ? <OrderDetail order={order} onBack={regular ? undefined : () => setSelected(null)} /> : null} />;
}

function OrderDetail({ order, onBack }: { order: DemoOrder; onBack?: () => void }) {
  return (
    <div className="mx-auto max-w-[720px]">
      <NavBar
        title={order.customer}
        largeTitle
        leading={
          onBack && (
            <button type="button" onClick={onBack} className="glass -ml-1 inline-flex h-11 items-center gap-0.5 rounded-full pl-2 pr-4 text-body text-tint-text">
              <ChevronLeft className="size-6" />
              Pesanan
            </button>
          )
        }
      />
      <div className="px-[var(--gutter)]">
        <p className="-mt-1 mb-5 text-subhead text-label-2">{order.code} · {order.trip}</p>
        <ListSection header="Barang">
          {order.items.map((it) => {
            const s = itemStatus[it.status];
            return (
              <div key={it.title} className="flex items-center gap-3 border-b-[0.5px] border-separator px-4 py-3 last:border-0">
                <div className="squircle size-12 shrink-0 rounded-[12px]" style={{ background: `oklch(0.86 0.09 ${it.hue})` }} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-body">{it.title}</div>
                  <div className="text-footnote text-label-2">{it.variant} · {it.qty}×</div>
                  <Pill tone={s.tone} icon={s.icon} className="mt-1.5">{s.label}</Pill>
                </div>
                <div className="text-subhead tabular text-label-2">{formatRupiah(it.price)}</div>
              </div>
            );
          })}
        </ListSection>
        <ListSection header="Pembayaran">
          <ListRow title="Total" value={formatRupiah(order.total)} />
          <ListRow title="DP 50%" value={formatRupiah(order.total - order.due)} trailing={<Pill tone="green">Lunas</Pill>} />
          <ListRow title="Sisa pelunasan" value={formatRupiah(order.due)} trailing={order.due ? <Pill tone={waitingPill.tone}>Belum</Pill> : undefined} />
        </ListSection>
      </div>
    </div>
  );
}
