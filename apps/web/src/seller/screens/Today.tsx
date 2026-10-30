import { formatRupiah } from "@bawaan/shared";
import { AlertTriangle, BellRing, CheckCircle2, ClipboardList, CreditCard, HelpCircle, Package, Scale, Search, Truck } from "lucide-react";
import { useState } from "react";
import { api, errorMessage } from "../../lib/api";
import { fmtRelative } from "../../lib/format";
import { pushState, subscribePush } from "../../lib/push";
import { navigate } from "../../lib/router";
import type { Settings } from "../../lib/types";
import { Button } from "../../ui/Button";
import { ask, EmptyState, ErrorState, SkeletonRows, useHud } from "../../ui/Feedback";
import { ListRow, ListSection } from "../../ui/List";
import { useTenant } from "../context";
import { useTenantAction, useTenantQuery } from "../hooks";
import { Screen } from "../Screen";

type TodayData = {
  newOrders: Array<{ id: string; code: string; createdAt: number; customer: string }>;
  pendingPayments: Array<{ id: string; amount: number; createdAt: number; customer: string; expected: number | null }>;
  toDecide: number;
  approvals: Array<{ id: string; title: string; deadline: number | null; orderId: string }>;
  overdue: Array<{ id: string; number: string; dueAt: number; orderId: string | null; customer: string; amount: number; paid: number; uniqueCode: number }>;
  staleShipments: Array<{ id: string; name: string; status: string; updatedAt: number }>;
  readyToShip: number;
  cargoToBill: Array<{ id: string; name: string }>;
};

function PushCard() {
  const t = useTenant();
  const hud = useHud();
  const settings = useTenantQuery<Settings>(["settings"], "/settings");
  const [state, setState] = useState(pushState());
  if (state === "granted" || state === "unsupported" || state === "denied" || !settings.data?.vapidPublicKey) return null;
  return (
    <ListSection>
      <div className="flex items-start gap-3 p-4">
        <BellRing className="mt-0.5 size-6 shrink-0 text-tint" />
        <div className="flex-1">
          <p className="text-headline">Nyalakan notifikasi</p>
          <p className="mt-1 text-subhead text-label-2">
            {state === "needs-install"
              ? "Di iPhone, tambahkan Bawaan ke Layar Utama dulu (Bagikan → Tambah ke Layar Utama), lalu buka dari ikonnya."
              : "Dapat kabar saat ada pesanan baru atau bukti bayar masuk."}
          </p>
          {state === "default" && (
            <Button
              size="sm"
              className="mt-3"
              onClick={async () => {
                try {
                  const endpoint = await subscribePush(settings.data!.vapidPublicKey!);
                  await api.post(`${t.base}/push`, { endpoint });
                  setState("granted");
                  hud("Notifikasi aktif");
                } catch (e) {
                  hud(errorMessage(e), "error");
                  setState(pushState());
                }
              }}
            >
              Nyalakan
            </Button>
          )}
        </div>
      </div>
    </ListSection>
  );
}

export function Today() {
  const q = useTenantQuery<TodayData>(["today"], "/today");
  const d = q.data;
  const t = useTenant();
  const verify = useTenantAction<{ id: string; body: object }>("post", (i) => `/payments/${i.id}/verify`, "Pembayaran diterima");
  const nothing =
    d && !d.newOrders.length && !d.pendingPayments.length && !d.toDecide && !d.approvals.length && !d.overdue.length && !d.staleShipments.length && !d.readyToShip && !d.cargoToBill.length;

  return (
    <Screen title="Hari ini">
      <PushCard />
      {q.isPending && <SkeletonRows />}
      {q.isError && <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />}
      {nothing && (
        <EmptyState
          icon={<CheckCircle2 />}
          title="Semua beres"
          body="Tidak ada pesanan, pembayaran, atau barang yang menunggu kamu."
          action={<Button onClick={() => navigate("/trip")}>Lihat trip</Button>}
        />
      )}
      {d && !nothing && (
        <>
          {d.newOrders.length > 0 && (
            <ListSection header={`Pesanan baru · ${d.newOrders.length}`} footer="Cek isi pesanan lalu konfirmasi supaya tagihan DP terbit.">
              {d.newOrders.map((o) => (
                <ListRow key={o.id} icon={<ClipboardList />} title={o.customer} subtitle={`${o.code} · ${fmtRelative(o.createdAt)}`} chevron onClick={() => navigate(`/pesanan/${o.id}`)} />
              ))}
            </ListSection>
          )}
          {d.pendingPayments.length > 0 && (
            <ListSection header={`Bukti bayar · ${d.pendingPayments.length}`} footer="Cocokkan dengan mutasi rekening sebelum diterima.">
              {d.pendingPayments.map((p) => {
                const exact = p.expected !== null && p.expected === p.amount;
                const quick = exact && t.canMoney;
                return (
                  <ListRow
                    key={p.id}
                    icon={<CreditCard />}
                    iconBg="var(--green)"
                    title={p.customer}
                    subtitle={`${fmtRelative(p.createdAt)}${exact ? " · nominal pas" : p.expected !== null ? ` · tagihan ${formatRupiah(p.expected)}` : ""}`}
                    value={formatRupiah(p.amount)}
                    trailing={
                      quick ? (
                        <Button
                          size="sm"
                          variant="tinted"
                          disabled={verify.isPending}
                          onClick={async () => (await ask(`Sudah cek mutasi? Terima ${formatRupiah(p.amount)} dari ${p.customer}.`, { action: "Terima" })) && verify.mutate({ id: p.id, body: {} })}
                        >
                          Terima
                        </Button>
                      ) : undefined
                    }
                    chevron={!quick}
                    onClick={quick ? undefined : () => navigate("/pembayaran")}
                  />
                );
              })}
            </ListSection>
          )}
          {(d.toDecide > 0 || d.approvals.length > 0) && (
            <ListSection header="Belanja">
              {d.toDecide > 0 && <ListRow icon={<Search />} iconBg="var(--indigo)" title="Barang sedang dicari" value={d.toDecide} chevron onClick={() => navigate("/belanja")} />}
              {d.approvals.map((a) => (
                <ListRow
                  key={a.id}
                  icon={<HelpCircle />}
                  iconBg="var(--orange)"
                  title={a.title}
                  subtitle={a.deadline ? `Menunggu persetujuan · batas ${fmtRelative(a.deadline)}` : "Menunggu persetujuan pelanggan"}
                  chevron
                  onClick={() => navigate(`/pesanan/${a.orderId}`)}
                />
              ))}
            </ListSection>
          )}
          {d.overdue.length > 0 && (
            <ListSection header="Tagihan lewat jatuh tempo">
              {d.overdue.map((i) => (
                <ListRow
                  key={i.id}
                  icon={<AlertTriangle />}
                  iconBg="var(--red)"
                  title={i.customer}
                  subtitle={`${i.number} · ${fmtRelative(i.dueAt)}`}
                  value={formatRupiah(i.amount + i.uniqueCode - i.paid)}
                  chevron
                  onClick={() => i.orderId && navigate(`/pesanan/${i.orderId}`)}
                />
              ))}
            </ListSection>
          )}
          {(d.readyToShip > 0 || d.cargoToBill.length > 0) && (
            <ListSection header="Pengiriman">
              {d.cargoToBill.map((s) => (
                <ListRow key={s.id} icon={<Scale />} iconBg="var(--teal)" title={`Tagih ongkir ${s.name}`} subtitle="Kargo sudah tiba, ongkir per pelanggan belum ditagih" chevron onClick={() => navigate(`/pengiriman/${s.id}`)} />
              ))}
              {d.readyToShip > 0 && <ListRow icon={<Package />} iconBg="var(--indigo)" title="Siap dikirim ke pelanggan" value={`${d.readyToShip} orang`} chevron onClick={() => navigate("/pengiriman?tab=domestic")} />}
            </ListSection>
          )}
          {d.staleShipments.length > 0 && (
            <ListSection header="Kargo belum di-update 5 hari" footer="Pelanggan lebih tenang kalau statusnya rutin diperbarui.">
              {d.staleShipments.map((s) => (
                <ListRow key={s.id} icon={<Truck />} iconBg="var(--teal)" title={s.name} subtitle={fmtRelative(s.updatedAt)} chevron onClick={() => navigate(`/pengiriman/${s.id}`)} />
              ))}
            </ListSection>
          )}
        </>
      )}
    </Screen>
  );
}
