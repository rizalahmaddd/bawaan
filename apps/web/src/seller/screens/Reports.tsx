import { formatRupiah } from "@bawaan/shared";
import { BarChart3, Download, Plane } from "lucide-react";
import { errorMessage } from "../../lib/api";
import { fmtDate, kursToText } from "../../lib/format";
import { navigate } from "../../lib/router";
import { EmptyState, ErrorState, SkeletonRows } from "../../ui/Feedback";
import { ListRow, ListSection } from "../../ui/List";
import { Pill } from "../../ui/Pill";
import { cx } from "../../ui/cx";
import { ORDER_STATUS } from "../common";
import { useTenant } from "../context";
import { useTenantQuery } from "../hooks";
import { Screen } from "../Screen";

type ReportIndex = { trips: Array<{ id: string; title: string; status: string; closesAt: number }>; saldoLiability: number; saldoCustomers: number };

type TripReport = {
  trip: { id: string; title: string; currency: string; kursMicro: number; actualKursMicro: number | null; status: string };
  counts: { orders: number; items: number; obtained: number; unavailable: number; forfeited: number };
  money: {
    goodsRevenue: number;
    forfeitKept: number;
    fees: number;
    cogs: number;
    foreignSpent: number;
    kursDiff: number | null;
    cargoBilled: number;
    cargoCost: number;
    dutyBilled: number;
    dutyCost: number;
    domesticBilled: number;
    collected: number;
    unpaid: number;
    refunded: number;
    grossProfit: number;
  };
  orders: Array<{ code: string; customer: string; status: string; items: number; obtained: number; billed: number; paid: number; unpaid: number }>;
};

const TRIP_STATUS: Record<string, string> = { draft: "Draf", open: "Buka", closed: "Tutup", done: "Selesai" };

export function Reports() {
  const q = useTenantQuery<ReportIndex>(["reports"], "/reports");
  return (
    <Screen title="Laporan">
      {q.isPending && <SkeletonRows />}
      {q.isError && <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />}
      {q.data && (
        <>
          <ListSection header="Saldo pelanggan" footer="Uang pelanggan yang kamu pegang (kelebihan bayar, refund ke saldo). Ini kewajibanmu, bukan pendapatan.">
            <ListRow title="Total saldo" value={formatRupiah(q.data.saldoLiability)} />
            <ListRow title="Pelanggan bersaldo" value={q.data.saldoCustomers} />
          </ListSection>
          {q.data.trips.length === 0 ? (
            <EmptyState icon={<BarChart3 />} title="Belum ada trip" body="Laporan untung-rugi muncul per trip." />
          ) : (
            <ListSection header="Per trip">
              {q.data.trips.map((t) => (
                <ListRow key={t.id} icon={<Plane />} title={t.title} subtitle={`${TRIP_STATUS[t.status] ?? t.status} · tutup ${fmtDate(t.closesAt)}`} chevron onClick={() => navigate(`/laporan/${t.id}`)} />
              ))}
            </ListSection>
          )}
        </>
      )}
    </Screen>
  );
}

function Money({ label, value, hint, strong, tone }: { label: string; value: number | null; hint?: string; strong?: boolean; tone?: "pos" | "neg" }) {
  return (
    <div className="flex min-h-[var(--tap)] items-center gap-3 px-4 py-2 [&+&]:border-t-[0.5px] [&+&]:border-separator">
      <span className="min-w-0 flex-1">
        <span className={cx("block text-body", strong && "font-semibold")}>{label}</span>
        {hint && <span className="block text-footnote text-label-2">{hint}</span>}
      </span>
      <span className={cx("text-body tabular", strong ? "font-semibold" : "text-label-2", tone === "pos" && "text-green-text", tone === "neg" && "text-red-text")}>
        {value === null ? "—" : formatRupiah(value)}
      </span>
    </div>
  );
}

export function TripReportScreen({ id }: { id: string }) {
  const t = useTenant();
  const q = useTenantQuery<TripReport>(["reports", id], `/reports/trips/${id}`);
  const back = { label: "Laporan", to: "/laporan" };
  if (q.isPending) return <Screen title="Laporan" back={back} largeTitle={false}><SkeletonRows rows={6} /></Screen>;
  if (q.isError) return <Screen title="Laporan" back={back} largeTitle={false}><ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} /></Screen>;
  const { trip, counts, money: m, orders } = q.data;
  const tone = (n: number) => (n > 0 ? "pos" : n < 0 ? "neg" : undefined);

  return (
    <Screen title={trip.title} back={back}>
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Pesanan", counts.orders],
          ["Barang dapat", `${counts.obtained}/${counts.items}`],
          ["Terkumpul", formatRupiah(m.collected)],
          ["Belum dibayar", formatRupiah(m.unpaid)],
        ].map(([label, value]) => (
          <div key={label} className="rounded-[var(--radius-card)] bg-elevated p-4">
            <p className="text-footnote text-label-2">{label}</p>
            <p className="mt-1 text-title3 tabular">{value}</p>
          </div>
        ))}
      </div>

      <ListSection header="Barang">
        <Money label="Nilai barang didapat" value={m.goodsRevenue} hint="Harga jual barang berstatus dapat, termasuk fee" />
        {m.forfeitKept > 0 && <Money label="DP hangus" value={m.forfeitKept} hint="Pesanan yang tidak dilunasi sampai batas waktu" />}
        <Money label="Modal belanja" value={-m.cogs} hint={trip.actualKursMicro ? `Harga asli × kurs asli Rp ${kursToText(trip.actualKursMicro)}` : `Harga asli × kurs trip Rp ${kursToText(trip.kursMicro)}`} />
        <Money label="Termasuk fee jasa" value={m.fees} />
        <Money
          label="Selisih kurs"
          value={m.kursDiff}
          hint={trip.actualKursMicro ? "Kurs tagihan dibanding kurs yang kamu dapat" : "Isi kurs asli di pengaturan trip untuk menghitung"}
          tone={m.kursDiff === null ? undefined : tone(m.kursDiff)}
        />
      </ListSection>

      <ListSection header="Kargo & bea">
        <Money label="Ongkir kargo ditagih" value={m.cargoBilled} />
        <Money label="Biaya forwarder" value={-m.cargoCost} />
        <Money label="Bea masuk ditagih" value={m.dutyBilled} />
        <Money label="Bea masuk dibayar" value={-m.dutyCost} />
        <Money label="Ongkir domestik ditagih" value={m.domesticBilled} hint="Diteruskan ke kurir, tidak dihitung laba" />
        <Money label="Dikembalikan ke saldo pelanggan" value={m.refunded} hint="Barang tidak dapat atau kelebihan DP; sudah tidak termasuk di atas" />
      </ListSection>

      <ListSection footer="Perkiraan kasar dari tagihan dan biaya yang tercatat. Belum termasuk biaya lain seperti tiket atau hotel.">
        <Money label="Laba kotor" value={m.grossProfit} strong tone={tone(m.grossProfit)} />
      </ListSection>

      <ListSection header={`Per pesanan · ${orders.length}`}>
        {orders.map((o) => (
          <ListRow
            key={o.code}
            title={o.customer}
            subtitle={`${o.code} · ${o.obtained}/${o.items} dapat · dibayar ${formatRupiah(o.paid)}`}
            value={o.unpaid > 0 ? formatRupiah(o.unpaid) : undefined}
            trailing={<Pill tone={ORDER_STATUS[o.status]?.tone ?? "gray"}>{ORDER_STATUS[o.status]?.label ?? o.status}</Pill>}
          />
        ))}
        <ListRow icon={<Download />} title="Unduh CSV" href={`${t.base}/reports/trips/${trip.id}/export.csv`} />
      </ListSection>
    </Screen>
  );
}
