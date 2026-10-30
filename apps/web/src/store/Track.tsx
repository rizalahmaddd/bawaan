import { INVOICE_TYPE_LABEL, SHIPMENT_FLOW, SHIPMENT_LABEL, formatForeign, formatRupiah, type ItemStatus } from "@bawaan/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, Check, Copy, FileText, ImageOff, QrCode, Share, Upload } from "lucide-react";
import qrcode from "qrcode-generator";
import { useEffect, useMemo, useState } from "react";
import { api, errorMessage, request } from "../lib/api";
import { fmtDate, fmtDateTime, fmtRelative } from "../lib/format";
import { compressImage } from "../lib/image";
import { pushState, subscribePush } from "../lib/push";
import { Link, navigate, useLocation } from "../lib/router";
import { media, type CustomerOrderView, type Invoice } from "../lib/types";
import { Button, LinkButton } from "../ui/Button";
import { ErrorState, PageSpinner, useHud } from "../ui/Feedback";
import { PhotoPicker } from "../ui/Form";
import { ListRow, ListSection } from "../ui/List";
import { Pill } from "../ui/Pill";
import { Sheet } from "../ui/Sheet";
import { DeliveryPill, InvoicePill, ItemPill, ShipmentPill } from "../seller/common";
import { OrderAccountCard } from "./Account";
import { ChatSeller } from "./Catalog";
import { orderToken, saveOrderToken } from "./data";

/** Reads ?t= once, keeps it on this device, and drops it from the address bar so screenshots don't leak it. */
export function useOrderToken(code: string) {
  const { search } = useLocation();
  const fromUrl = search.get("t");
  useEffect(() => {
    if (!fromUrl) return;
    saveOrderToken(code, fromUrl);
    const url = new URL(location.href);
    url.searchParams.delete("t");
    history.replaceState(null, "", url.pathname + url.search);
  }, [code, fromUrl]);
  return fromUrl ?? orderToken(code);
}

export function useOrder(code: string) {
  const token = useOrderToken(code);
  const q = useQuery({
    queryKey: ["order", code, token],
    queryFn: ({ signal }) => request<CustomerOrderView>(`/api/store/orders/${encodeURIComponent(code)}`, { headers: { "x-order-token": token ?? "" }, signal }),
    enabled: !!token,
    refetchInterval: 60_000,
  });
  return { q, token };
}

const DONE: ItemStatus[] = ["obtained", "partial", "unavailable", "cancelled", "forfeited"];

export function Track({ code }: { code: string }) {
  const { q, token } = useOrder(code);
  const { search } = useLocation();
  const [paying, setPaying] = useState<Invoice | null>(null);

  if (!token)
    return (
      <ErrorState
        message="Link pesanan ini tidak lengkap. Buka lagi dari pesan seller, atau lacak pakai kode pesanan dan 4 digit nomor WhatsApp."
        onRetry={() => navigate("/", { direction: "back" })}
      />
    );
  if (q.isPending) return <PageSpinner />;
  if (q.isError) return <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />;

  const o = q.data;
  const decided = o.items.filter((i) => DONE.includes(i.status)).length;
  const progress = o.items.length ? decided / o.items.length : 0;
  const approvals = o.items.filter((i) => i.status === "needs_approval");
  const openInvoices = o.invoices.filter((i) => (i.status === "open" || i.status === "partially_paid") && !i.combinedInto);
  const pendingPayments = o.payments.filter((p) => p.status === "pending");
  const waText = `Halo Kak, aku mau tanya pesanan ${o.order.code}`;

  return (
    <>
      {search.has("baru") && (
        <div className="mb-6 rounded-[var(--radius-card)] bg-[color-mix(in_srgb,var(--green)_14%,transparent)] p-5">
          <p className="text-headline text-green-text">Pesanan terkirim</p>
          <p className="mt-1 text-subhead">Seller akan mengecek dan mengonfirmasi pesananmu. Simpan halaman ini untuk memantau statusnya.</p>
        </div>
      )}

      <section className="mb-6 flex items-center gap-4 rounded-[var(--radius-card)] bg-elevated p-5">
        <ProgressRing value={progress} />
        <div className="min-w-0 flex-1">
          <p className="text-footnote text-label-2">{o.trip?.title}</p>
          <h2 className="text-headline tabular [overflow-wrap:anywhere]">{o.order.code}</h2>
          <p className="text-subhead text-label-2">
            {o.order.status === "requested"
              ? "Menunggu konfirmasi seller"
              : o.order.status === "rejected"
                ? "Pesanan ditolak"
                : o.order.status === "cancelled"
                  ? "Pesanan dibatalkan"
                  : `${decided} dari ${o.items.length} barang sudah ada hasilnya`}
          </p>
        </div>
        <ChatSeller wa={o.store.waNumber} text={waText} />
      </section>

      {o.order.closeReason && (
        <ListSection header="Keterangan seller">
          <p className="p-4 text-body">{o.order.closeReason}</p>
        </ListSection>
      )}

      {approvals.map((i) => (
        <ApprovalCard key={i.id} code={o.order.code} token={token} item={i} currency={i.currency} />
      ))}

      {openInvoices.map((inv) => (
        <section key={inv.id} className="mb-6 rounded-[var(--radius-card)] border-2 border-[color-mix(in_srgb,var(--orange)_45%,transparent)] bg-elevated p-5">
          <div className="flex items-start gap-2">
            <div className="flex-1">
              <p className="text-footnote font-semibold uppercase text-orange-text">Perlu dibayar</p>
              <p className="text-headline">Tagihan {INVOICE_TYPE_LABEL[inv.type]}</p>
              {inv.dueAt && <p className="text-subhead text-label-2">Batas {fmtDateTime(inv.dueAt)} ({fmtRelative(inv.dueAt)})</p>}
            </div>
            <p className="text-title2 tabular">{formatRupiah(inv.remaining)}</p>
          </div>
          {pendingPayments.some((p) => p.invoiceId === inv.id) ? (
            <p className="mt-4 rounded-[14px] bg-fill-4 p-3 text-subhead">Bukti bayar sudah dikirim, sedang dicek seller.</p>
          ) : (
            <Button block className="mt-4" onClick={() => setPaying(inv)}>
              Bayar
            </Button>
          )}
        </section>
      ))}

      <ListSection header={`Barang · ${o.items.length}`}>
        {o.items.map((i) => (
          <div key={i.id} className="flex gap-3 border-b-[0.5px] border-separator p-4 last:border-0">
            <div className="size-16 shrink-0 overflow-hidden rounded-[12px] bg-fill-4">
              {i.photoKey ? <img src={media(i.photoKey)!} alt="" className="size-full object-cover" loading="lazy" /> : <ImageOff className="m-5 size-6 text-label-3" />}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-body font-semibold">
                {i.title}
                {i.variant && <span className="font-normal text-label-2"> · {i.variant}</span>}
              </p>
              <p className="text-subhead text-label-2 tabular">
                {i.status === "partial" ? `${i.qtyObtained} dari ${i.qty}` : i.qty} pcs
                {i.unitPrice !== null && ` · ${formatRupiah(i.unitPrice * (i.qtyObtained ?? i.qty))}`}
                {i.actualPriceMinor !== null && ` · struk ${formatForeign(i.actualPriceMinor, i.currency)}`}
              </p>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <ItemPill status={i.status} customer />
                {i.receiptKey && (
                  <a href={media(i.receiptKey)!} target="_blank" rel="noopener" className="text-footnote text-tint-text">
                    Lihat struk
                  </a>
                )}
              </div>
              {i.status === "unavailable" && i.note && <p className="mt-1 text-footnote text-label-2">{i.note}</p>}
            </div>
          </div>
        ))}
      </ListSection>

      {o.shipments.map((s) => {
        const events = o.events.filter((e) => e.entityType === "shipment" && e.entityId === s.id);
        const idx = SHIPMENT_FLOW.indexOf(s.status);
        return (
          <ListSection key={s.id} header="Kargo" footer={s.etaAt ? `Perkiraan tiba ${fmtDate(s.etaAt)}` : undefined}>
            <div className="flex items-center gap-2 p-4">
              <p className="flex-1 text-headline">{s.name}</p>
              <ShipmentPill status={s.status} />
            </div>
            <ol className="px-4 pb-4">
              {SHIPMENT_FLOW.map((st, n) => {
                const ev = events.find((e) => e.status === st);
                const reached = idx >= n || !!ev;
                return (
                  <li key={st} className="relative flex gap-3 pb-3 last:pb-0">
                    <span className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full ${reached ? "bg-green text-white" : "bg-fill-3"}`}>{reached && <Check className="size-3" strokeWidth={3} />}</span>
                    <span className="min-w-0 flex-1">
                      <span className={`block text-subhead ${reached ? "text-label" : "text-label-2"}`}>{SHIPMENT_LABEL[st].label}</span>
                      {ev && <span className="block text-footnote text-label-2">{[ev.message !== SHIPMENT_LABEL[st].label && ev.message, fmtDateTime(ev.createdAt)].filter(Boolean).join(" · ")}</span>}
                    </span>
                  </li>
                );
              })}
            </ol>
            {events
              .filter((e) => e.status === "delayed" || e.status === "held_by_customs")
              .map((e) => (
                <div key={e.id} className="mx-4 mb-4 rounded-[14px] bg-[color-mix(in_srgb,var(--orange)_14%,transparent)] p-3 text-subhead">
                  <strong>{SHIPMENT_LABEL[e.status as keyof typeof SHIPMENT_LABEL].label}:</strong> {e.message ?? "Seller sedang memantau."} <span className="text-label-2">· {fmtDate(e.createdAt)}</span>
                </div>
              ))}
          </ListSection>
        );
      })}

      {o.deliveries.length > 0 && (
        <ListSection header="Pengiriman ke kamu">
          {o.deliveries.map((d) => (
            <div key={d.id}>
              <ListRow
                title={d.courier ?? (d.status === "picked_up" ? "Diambil sendiri" : "Kurir")}
                subtitle={d.resi ? `Resi ${d.resi}` : d.shippedAt ? fmtDate(d.shippedAt) : undefined}
                trailing={<DeliveryPill status={d.status} />}
                href={d.resi ? `https://cekresi.com/?noresi=${encodeURIComponent(d.resi)}` : undefined}
              />
              {d.resi && d.status === "shipped" && <CourierHistory code={o.order.code} token={token} deliveryId={d.id} />}
            </div>
          ))}
        </ListSection>
      )}

      {o.invoices.length > 0 && (
        <ListSection header="Tagihan" footer={o.customer && o.customer.balance > 0 ? `Saldo kamu di toko ini: ${formatRupiah(o.customer.balance)}` : undefined}>
          {o.invoices.map((inv) => (
            <Link key={inv.id} to={`/o/${o.order.code}/tagihan/${inv.id}`} className="group/row flex items-center gap-3 px-4 py-3 [&+&]:border-t-[0.5px] [&+&]:border-separator">
              <FileText className="size-5 shrink-0 text-tint" />
              <span className="min-w-0 flex-1">
                <span className="block text-body">{INVOICE_TYPE_LABEL[inv.type]} · {inv.number}</span>
                <span className="block text-subhead text-label-2 tabular">
                  {formatRupiah(inv.amount + inv.uniqueCode)}
                  {inv.combinedInto && inv.status !== "paid" && " · dibayar lewat tagihan gabungan"}
                </span>
              </span>
              {inv.combinedInto && inv.status !== "paid" ? <Pill tone="indigo">Digabung</Pill> : <InvoicePill status={inv.status} />}
            </Link>
          ))}
        </ListSection>
      )}

      {o.payments.some((p) => p.status === "rejected") && (
        <ListSection header="Bukti bayar ditolak">
          {o.payments
            .filter((p) => p.status === "rejected")
            .map((p) => (
              <ListRow key={p.id} title={formatRupiah(p.amount)} subtitle={p.rejectReason ?? undefined} />
            ))}
        </ListSection>
      )}

      <PushCard code={o.order.code} token={token} vapid={o.vapidPublicKey} />
      <OrderAccountCard code={o.order.code} token={token} linked={o.customer?.linked ?? false} hold={o.order.holdForCombine} active={o.order.status === "active" || o.order.status === "requested"} />

      {o.notifications.length > 0 && (
        <ListSection header="Kabar terbaru">
          {o.notifications.map((n, i) => (
            <ListRow key={i} title={n.body} subtitle={fmtRelative(n.createdAt)} />
          ))}
        </ListSection>
      )}

      <ListSection>
        <ListRow
          icon={<Share />}
          title="Bagikan link pesanan"
          onClick={() => {
            const url = `${location.origin}/o/${o.order.code}?t=${token}`;
            if (typeof navigator.share === "function") navigator.share({ url, title: `Pesanan ${o.order.code}` }).catch(() => {});
            else navigator.clipboard?.writeText(url);
          }}
        />
      </ListSection>

      {paying && <PaySheet code={o.order.code} token={token} invoice={paying} banks={o.banks} qris={o.qris} onClose={() => setPaying(null)} />}
    </>
  );
}

function ProgressRing({ value }: { value: number }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 64 64" className="size-16 shrink-0 -rotate-90" role="img" aria-label={`${Math.round(value * 100)}% barang sudah ada hasilnya`}>
      <circle cx="32" cy="32" r={r} fill="none" stroke="var(--fill-3)" strokeWidth="7" />
      <circle cx="32" cy="32" r={r} fill="none" stroke="var(--green)" strokeWidth="7" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - value)} className="transition-[stroke-dashoffset] duration-700" />
    </svg>
  );
}

function ApprovalCard({ code, token, item, currency }: { code: string; token: string; item: CustomerOrderView["items"][number]; currency: string }) {
  const qc = useQueryClient();
  const hud = useHud();
  const [busy, setBusy] = useState(false);
  async function respond(approve: boolean) {
    setBusy(true);
    try {
      await request(`/api/store/orders/${code}/items/${item.id}/approval`, { method: "POST", body: { approve }, headers: { "x-order-token": token } });
      hud(approve ? "Terima kasih, seller akan lanjut" : "Jawabanmu terkirim");
      qc.invalidateQueries({ queryKey: ["order", code] });
    } catch (e) {
      hud(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="mb-6 rounded-[var(--radius-card)] border-2 border-[color-mix(in_srgb,var(--orange)_45%,transparent)] bg-elevated p-5">
      <p className="text-footnote font-semibold uppercase text-orange-text">Butuh persetujuanmu</p>
      <div className="mt-2 flex gap-3">
        {item.photoKey && <img src={media(item.photoKey)!} alt="" className="size-20 shrink-0 rounded-[12px] object-cover" />}
        <div className="min-w-0 flex-1">
          <p className="text-headline">{item.title}</p>
          {item.approvalNote && <p className="mt-1 text-body">{item.approvalNote}</p>}
          {item.actualPriceMinor !== null && (
            <p className="mt-1 text-subhead text-label-2 tabular">
              Harga sekarang {formatForeign(item.actualPriceMinor, currency)}
              {item.priceMinor !== null && ` (sebelumnya ${formatForeign(item.priceMinor, currency)})`}
            </p>
          )}
          {item.approvalDeadline && <p className="mt-1 text-footnote text-orange-text">Jawab sebelum {fmtDateTime(item.approvalDeadline)}</p>}
        </div>
      </div>
      <div className="mt-4 flex gap-3">
        <Button variant="destructive" className="flex-1" disabled={busy} onClick={() => respond(false)}>
          Tidak, batalkan
        </Button>
        <Button className="flex-1" disabled={busy} onClick={() => respond(true)}>
          Setuju
        </Button>
      </div>
    </section>
  );
}

function PaySheet({ code, token, invoice, banks, qris, onClose }: { code: string; token: string; invoice: Invoice; banks: CustomerOrderView["banks"]; qris: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const hud = useHud();
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const amount = invoice.remaining;
  const copy = (text: string) => navigator.clipboard?.writeText(text).then(() => hud("Disalin"));

  async function submit() {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("kind", "proof");
      form.set("file", await compressImage(file));
      const { key } = await api.form<{ key: string }>(`/api/store/orders/${code}/uploads`, form, { "x-order-token": token });
      await request(`/api/store/orders/${code}/payments`, { method: "POST", body: { invoiceId: invoice.id, amount, proofKey: key }, headers: { "x-order-token": token } });
      hud("Bukti bayar terkirim");
      qc.invalidateQueries({ queryKey: ["order", code] });
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()} title="Bayar tagihan" detents={["large"]}>
      {qris && <QrisPay code={code} token={token} invoice={invoice} onPaid={onClose} />}
      <div className="mb-6 text-center">
        <p className="text-subhead text-label-2">Transfer tepat</p>
        <button type="button" onClick={() => copy(String(amount))} className="mt-1 inline-flex items-center gap-2 text-large-title tabular">
          {formatRupiah(amount)}
          <Copy className="size-5 text-tint" />
        </button>
        {invoice.uniqueCode > 0 && <p className="mt-1 text-footnote text-label-2">Termasuk kode unik {invoice.uniqueCode} supaya transfermu cepat dikenali.</p>}
      </div>
      <ListSection header="Ke rekening">
        {banks.length === 0 && <ListRow title="Tanya nomor rekening ke seller lewat WhatsApp" />}
        {banks.map((b, i) => (
          <div key={i} className="px-4 py-3 [&+&]:border-t-[0.5px] [&+&]:border-separator">
            <div className="flex items-center gap-3">
              <span className="min-w-0 flex-1">
                <span className="block text-body tabular">{b.bank} · {b.number}</span>
                <span className="block text-subhead text-label-2">a.n. {b.holder}</span>
              </span>
              <Button size="sm" variant="gray" icon={<Copy className="size-3.5" />} onClick={() => copy(b.number.replace(/\s/g, ""))}>
                Salin
              </Button>
            </div>
            {b.qrisKey && <img src={media(b.qrisKey)!} alt={`QRIS ${b.bank}`} className="mx-auto mt-2 w-full max-w-[260px] rounded-[12px] bg-white p-2" />}
          </div>
        ))}
      </ListSection>
      <ListSection header="Bukti transfer" footer="Screenshot atau foto bukti transfer. Seller akan mencocokkan dengan mutasi rekening.">
        <div className="flex items-center gap-4 p-4">
          <PhotoPicker label="Pilih bukti transfer" onPick={setFile} />
          <span className="text-subhead text-label-2">{file ? file.name : "Belum dipilih"}</span>
        </div>
      </ListSection>
      {error && <p role="alert" className="mb-4 text-center text-subhead text-red-text">{error}</p>}
      <Button size="lg" block icon={<Upload className="size-5" />} disabled={!file || busy} onClick={submit}>
        {busy ? "Mengirim…" : "Kirim bukti bayar"}
      </Button>
    </Sheet>
  );
}

function PushCard({ code, token, vapid }: { code: string; token: string; vapid: string | null }) {
  const hud = useHud();
  const [state, setState] = useState(pushState);
  const [guide, setGuide] = useState(false);
  if (!vapid || state === "granted" || state === "unsupported" || state === "denied") return null;
  return (
    <ListSection>
      <div className="flex items-start gap-3 p-4">
        <BellRing className="mt-0.5 size-6 shrink-0 text-tint" />
        <div className="flex-1">
          <p className="text-headline">Kabari aku kalau ada update</p>
          <p className="mt-1 text-subhead text-label-2">Notifikasi saat barang didapat, tagihan terbit, atau kargo bergerak.</p>
          <Button
            size="sm"
            className="mt-3"
            onClick={async () => {
              if (state === "needs-install") return setGuide(true);
              try {
                const endpoint = await subscribePush(vapid);
                await request(`/api/store/orders/${code}/push`, { method: "POST", body: { endpoint }, headers: { "x-order-token": token } });
                setState("granted");
                hud("Notifikasi aktif");
              } catch (e) {
                hud(errorMessage(e), "error");
                setState(pushState());
              }
            }}
          >
            Nyalakan notifikasi
          </Button>
        </div>
      </div>
      <Sheet open={guide} onOpenChange={setGuide} title="Pasang di iPhone" detents={["medium"]}>
        <ol className="space-y-4 text-body">
          <li className="flex gap-3">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-tint text-footnote font-semibold text-white">1</span>
            <span>
              Ketuk tombol <Share className="inline size-5 align-text-bottom text-tint" aria-label="Bagikan" /> di bawah layar Safari.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-tint text-footnote font-semibold text-white">2</span>
            <span>Pilih <strong>Tambah ke Layar Utama</strong>, lalu ketuk Tambah.</span>
          </li>
          <li className="flex gap-3">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-tint text-footnote font-semibold text-white">3</span>
            <span>Buka dari ikon baru di Layar Utama, lalu ketuk lagi <strong>Nyalakan notifikasi</strong> di halaman ini.</span>
          </li>
        </ol>
        <p className="mt-6 text-footnote text-label-2">Apple hanya mengizinkan notifikasi web untuk situs yang dipasang di Layar Utama (iOS 16.4 ke atas).</p>
      </Sheet>
    </ListSection>
  );
}

export function InvoicePage({ code, id }: { code: string; id: string }) {
  const { q } = useOrder(code);
  if (q.isPending) return <PageSpinner />;
  if (q.isError) return <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  const o = q.data;
  const inv = o.invoices.find((i) => i.id === id);
  if (!inv) return <ErrorState message="Tagihan tidak ditemukan" />;
  return (
    <article className="mx-auto max-w-[560px] rounded-[var(--radius-card)] bg-elevated p-6 print:max-w-none print:rounded-none print:p-0">
      <header className="mb-6 flex items-start gap-3">
        <div className="flex-1">
          <p className="text-footnote text-label-2">{o.store.name}</p>
          <h2 className="text-title2">Tagihan {INVOICE_TYPE_LABEL[inv.type]}</h2>
          <p className="text-subhead text-label-2 tabular">
            {inv.number} · {fmtDate(inv.createdAt)}
          </p>
        </div>
        <InvoicePill status={inv.status} />
      </header>
      <dl className="mb-6 grid grid-cols-2 gap-3 text-subhead">
        <div>
          <dt className="text-label-2">Untuk</dt>
          <dd className="font-semibold">{o.customer?.name}</dd>
        </div>
        <div>
          <dt className="text-label-2">Pesanan</dt>
          <dd className="font-semibold tabular">{o.order.code}</dd>
        </div>
        {inv.dueAt && (
          <div>
            <dt className="text-label-2">Jatuh tempo</dt>
            <dd className="font-semibold">{fmtDateTime(inv.dueAt)}</dd>
          </div>
        )}
        {o.trip && (
          <div>
            <dt className="text-label-2">Trip</dt>
            <dd className="font-semibold">{o.trip.title}</dd>
          </div>
        )}
      </dl>
      <table className="w-full text-subhead tabular">
        <tbody>
          {inv.lines.map((l, i) => (
            <tr key={i} className="border-b-[0.5px] border-separator">
              <td className="py-2 pr-2">
                {l.label}
                {l.qty && l.unit !== undefined ? <span className="block text-footnote text-label-2">{l.qty} × {formatRupiah(l.unit)}</span> : null}
              </td>
              <td className="py-2 text-right">{formatRupiah(l.amount)}</td>
            </tr>
          ))}
          {inv.uniqueCode > 0 && (
            <tr className="border-b-[0.5px] border-separator">
              <td className="py-2 pr-2">Kode unik</td>
              <td className="py-2 text-right">{formatRupiah(inv.uniqueCode)}</td>
            </tr>
          )}
          {inv.paid > 0 && inv.status !== "paid" && (
            <tr>
              <td className="py-2 pr-2 text-label-2">Sudah dibayar</td>
              <td className="py-2 text-right text-label-2">-{formatRupiah(inv.paid)}</td>
            </tr>
          )}
        </tbody>
        <tfoot>
          <tr>
            <td className="pt-3 text-headline">{inv.status === "paid" ? "Total dibayar" : "Sisa tagihan"}</td>
            <td className="pt-3 text-right text-title3">{formatRupiah(inv.status === "paid" ? inv.amount + inv.uniqueCode : inv.remaining)}</td>
          </tr>
        </tfoot>
      </table>
      {inv.note && <p className="mt-4 text-subhead text-label-2">{inv.note}</p>}
      {o.banks.length > 0 && inv.status !== "paid" && (
        <section className="mt-6 rounded-[14px] bg-fill-4 p-4 text-subhead">
          <p className="mb-1 font-semibold">Transfer ke</p>
          {o.banks.map((b, i) => (
            <p key={i} className="tabular">
              {b.bank} {b.number} a.n. {b.holder}
            </p>
          ))}
        </section>
      )}
      <div className="no-print mt-6 flex gap-3">
        <LinkButton href={`/o/${o.order.code}`} variant="gray" className="flex-1" onClick={(e) => (e.preventDefault(), navigate(`/o/${o.order.code}`, { direction: "back" }))}>
          Ke pesanan
        </LinkButton>
        <Button className="flex-1" onClick={() => print()}>
          Cetak / PDF
        </Button>
      </div>
    </article>
  );
}

/** Dynamic QRIS for the exact amount; the gateway's webhook marks it paid, and this polls until it sees that. */
function QrisPay({ code, token, invoice, onPaid }: { code: string; token: string; invoice: Invoice; onPaid: () => void }) {
  const qc = useQueryClient();
  const hud = useHud();
  const [qr, setQr] = useState<{ qrString: string; amount: number; expiresAt: number; invoiceId: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const headers = { "x-order-token": token };

  useEffect(() => {
    if (!qr) return;
    const timer = setInterval(async () => {
      const s = await request<{ status: string }>(`/api/store/orders/${code}/invoices/${qr.invoiceId}/status`, { headers }).catch(() => null);
      if (s?.status === "paid") {
        clearInterval(timer);
        hud("Pembayaran QRIS diterima");
        qc.invalidateQueries({ queryKey: ["order", code] });
        onPaid();
      }
    }, 4000);
    return () => clearInterval(timer);
  }, [qr]);

  const svg = useMemo(() => {
    if (!qr) return null;
    const q = qrcode(0, "M");
    q.addData(qr.qrString);
    q.make();
    return q.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
  }, [qr]);

  return (
    <ListSection header="Paling cepat" footer={qr ? `Berlaku sampai ${fmtDateTime(qr.expiresAt)}. Halaman ini otomatis tertutup setelah pembayaran masuk.` : "Bayar pakai aplikasi bank atau e-wallet apa pun. Langsung tercatat, tanpa kirim bukti."}>
      {svg ? (
        <div className="flex flex-col items-center gap-3 p-4">
          <div className="w-full max-w-[280px] rounded-[16px] bg-white p-3 [&_svg]:h-auto [&_svg]:w-full" role="img" aria-label="Kode QRIS" dangerouslySetInnerHTML={{ __html: svg }} />
          <p className="text-title3 tabular">{formatRupiah(qr!.amount)}</p>
        </div>
      ) : (
        <div className="p-4">
          {error && <p role="alert" className="mb-3 text-subhead text-red-text">{error}</p>}
          <Button
            block
            size="lg"
            icon={<QrCode className="size-5" />}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                setQr(await request(`/api/store/orders/${code}/invoices/${invoice.id}/qris`, { method: "POST", body: {}, headers }));
              } catch (e) {
                setError(errorMessage(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            Bayar dengan QRIS · {formatRupiah(invoice.remaining)}
          </Button>
        </div>
      )}
    </ListSection>
  );
}

function CourierHistory({ code, token, deliveryId }: { code: string; token: string; deliveryId: string }) {
  const q = useQuery({
    queryKey: ["tracking", code, deliveryId],
    queryFn: ({ signal }) => request<{ tracking: { status: string; history: Array<{ at: string; note: string }> } | null }>(`/api/store/orders/${code}/deliveries/${deliveryId}/tracking`, { headers: { "x-order-token": token }, signal }),
    staleTime: 10 * 60_000,
  });
  const history = q.data?.tracking?.history ?? [];
  if (!history.length) return null;
  return (
    <ol className="space-y-2 px-4 pb-4 pl-12">
      {history.slice(0, 6).map((h, i) => (
        <li key={i} className="text-subhead">
          <span className={i === 0 ? "text-label" : "text-label-2"}>{h.note}</span>
          <span className="block text-footnote text-label-2">{fmtDateTime(new Date(h.at).getTime())}</span>
        </li>
      ))}
    </ol>
  );
}
