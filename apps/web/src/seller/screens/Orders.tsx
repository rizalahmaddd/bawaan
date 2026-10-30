import { INVOICE_TYPE_LABEL, ITEM_LABEL, currencyExponent, formatForeign, formatRupiah, maskPhone, type TemplateKey } from "@bawaan/shared";
import { ClipboardList, Copy, ExternalLink, MessageCircle, MoreHorizontal, Package, Truck } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { useDeferredValue, useEffect, useState } from "react";
import { errorMessage } from "../../lib/api";
import { fmtDate, fmtDateTime, fmtRelative, minorToText, textToMinor } from "../../lib/format";
import { safeHref } from "../../lib/links";
import { navigate, useLocation } from "../../lib/router";
import { REGULAR, useMediaQuery } from "../../lib/useMediaQuery";
import { media, type Invoice, type OrderItem, type SellerOrder, type Settings } from "../../lib/types";
import { SplitView } from "../../ui/AppShell";
import { Button, IconButton } from "../../ui/Button";
import { ask, EmptyState, ErrorState, SkeletonRows, useHud } from "../../ui/Feedback";
import { Field, Input, SearchField } from "../../ui/Form";
import { Switch } from "../../ui/Switch";
import { ListRow, ListSection } from "../../ui/List";
import { Pill } from "../../ui/Pill";
import { Segmented } from "../../ui/Segmented";
import { Sheet } from "../../ui/Sheet";
import { DeliveryPill, InvoicePill, ItemPill, ORDER_STATUS, ReasonSheet, ShipmentPill } from "../common";
import { isTyping } from "../CommandPalette";
import { useTenant } from "../context";
import { DecideSheet, type DecideTarget } from "../DecideSheet";
import { useTenantAction, useTenantQuery } from "../hooks";
import { Screen } from "../Screen";
import { openWa, waMessage } from "../wa";

type OrderRow = { id: string; code: string; status: string; createdAt: number; customer: string; tripTitle: string; itemCount: number; total: number; due: number; attention: number };
type Filter = "needs_action" | "requested" | "active" | "all";

export function Orders({ selectedId }: { selectedId?: string }) {
  const regular = useMediaQuery(REGULAR);
  return <SplitView showDetail={!!selectedId} list={<OrderList selectedId={selectedId} />} detail={selectedId ? <OrderDetail key={selectedId} id={selectedId} split={regular} /> : <NoSelection />} />;
}

function NoSelection() {
  return (
    <div className="flex h-full items-center justify-center p-8">
      <EmptyState icon={<ClipboardList />} title="Pilih pesanan" body="Detail pesanan tampil di sini." />
    </div>
  );
}

function OrderList({ selectedId }: { selectedId?: string }) {
  const { search } = useLocation();
  const trip = search.get("trip");
  const [filter, setFilter] = useState<Filter>("needs_action");
  const [q, setQ] = useState("");
  const dq = useDeferredValue(q.trim());
  const params = new URLSearchParams();
  if (filter !== "all") params.set("status", filter);
  if (trip) params.set("trip", trip);
  if (dq) params.set("q", dq);
  const list = useTenantQuery<OrderRow[]>(["orders", filter, trip, dq], `/orders?${params}`);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e) || e.metaKey || e.ctrlKey || e.altKey || !list.data?.length) return;
      const k = e.key.toLowerCase();
      if (k !== "j" && k !== "k") return;
      const i = list.data.findIndex((o) => o.id === selectedId);
      const next = list.data[Math.max(0, Math.min(list.data.length - 1, i + (k === "j" ? 1 : -1)))];
      if (next && next.id !== selectedId) navigate(`/pesanan/${next.id}`, { replace: !!selectedId });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [list.data, selectedId]);

  return (
    <Screen
      title="Pesanan"
      accessory={
        <div className="space-y-3">
          <SearchField value={q} onChange={setQ} placeholder="Cari nama, kode, atau nomor" />
          <Segmented
            label="Filter pesanan"
            value={filter}
            onChange={setFilter}
            options={[
              { value: "needs_action", label: "Perlu aksi" },
              { value: "requested", label: "Baru" },
              { value: "active", label: "Berjalan" },
              { value: "all", label: "Semua" },
            ]}
          />
        </div>
      }
    >
      {list.isPending && <SkeletonRows rows={6} />}
      {list.isError && <ErrorState message={errorMessage(list.error)} onRetry={() => list.refetch()} />}
      {list.data?.length === 0 && (
        <EmptyState
          icon={<ClipboardList />}
          title={dq ? "Tidak ketemu" : filter === "needs_action" ? "Semua beres" : filter === "all" ? "Belum ada pesanan" : "Kosong"}
          body={dq ? "Coba kata kunci lain." : filter === "needs_action" ? "Tidak ada pesanan yang menunggu tindakanmu." : filter === "all" ? "Pesanan dari halaman tokomu akan masuk ke sini." : "Tidak ada pesanan di filter ini."}
        />
      )}
      {!!list.data?.length && (
        <ListSection footer={trip ? <button type="button" className="text-tint-text" onClick={() => navigate("/pesanan", { replace: true })}>Tampilkan semua trip</button> : undefined}>
          {list.data.map((o) => (
            <ListRow
              key={o.id}
              title={o.customer}
              subtitle={`${o.code} · ${o.itemCount} barang · ${fmtRelative(o.createdAt)}`}
              selected={o.id === selectedId}
              trailing={
                <span className="flex shrink-0 flex-col items-end gap-1">
                  {o.status === "requested" ? (
                    <Pill tone="orange">Baru</Pill>
                  ) : o.attention > 0 ? (
                    <Pill tone="blue">{o.attention} dicari</Pill>
                  ) : (
                    <Pill tone={ORDER_STATUS[o.status]?.tone ?? "gray"}>{ORDER_STATUS[o.status]?.label ?? o.status}</Pill>
                  )}
                  {o.due > 0 && <span className="text-footnote text-orange-text tabular">{formatRupiah(o.due)}</span>}
                </span>
              }
              chevron
              onClick={() => navigate(`/pesanan/${o.id}`, { replace: !!selectedId })}
            />
          ))}
        </ListSection>
      )}
    </Screen>
  );
}

function itemPrice(i: OrderItem) {
  if (i.unitPrice !== null) return formatRupiah(i.unitPrice * (i.qtyObtained ?? i.qty));
  if (i.priceMinor !== null) return formatForeign(i.priceMinor * i.qty, i.currency);
  return "Belum ada harga";
}

export function OrderDetail({ id, split }: { id: string; split: boolean }) {
  const t = useTenant();
  const hud = useHud();
  const q = useTenantQuery<SellerOrder>(["order", id], `/orders/${id}`);
  const settings = useTenantQuery<Settings>(["settings"], "/settings");
  const confirm = useTenantAction<void, { total: number; invoice: unknown }>("post", `/orders/${id}/confirm`, "Pesanan dikonfirmasi");
  const reject = useTenantAction<{ reason: string }>("post", `/orders/${id}/reject`, "Pesanan ditolak");
  const cancel = useTenantAction<{ reason: string }>("post", `/orders/${id}/cancel`, "Pesanan dibatalkan");
  const voidInvoiceAction = useTenantAction<{ id: string; reason: string }>("post", (i) => `/invoices/${i.id}/void`, "Tagihan dibatalkan");
  const hold = useTenantAction<{ hold: boolean }>("post", `/orders/${id}/hold`, "Tersimpan");
  const [sheet, setSheet] = useState<null | "reject" | "cancel">(null);
  const [quote, setQuote] = useState<OrderItem | null>(null);
  const [decide, setDecide] = useState<DecideTarget | null>(null);
  const [payFor, setPayFor] = useState<Invoice | null>(null);
  const [confirmedTotal, setConfirmedTotal] = useState<number | null>(null);
  const [voidFor, setVoidFor] = useState<Invoice | null>(null);
  const [relist, setRelist] = useState<OrderItem | null>(null);

  const back = split ? undefined : { label: "Pesanan", to: "/pesanan" };
  if (q.isPending) return <Screen title="Pesanan" back={back} largeTitle={false}><SkeletonRows rows={5} /></Screen>;
  if (q.isError) return <Screen title="Pesanan" back={back} largeTitle={false}><ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} /></Screen>;

  const o = q.data;
  const policy = settings.data?.policy;
  const openInvoices = o.invoices.filter((i) => i.status === "open" || i.status === "partially_paid");
  const due = openInvoices.reduce((s, i) => s + i.remaining, 0);
  const total = o.items.filter((i) => !["cancelled", "unavailable", "forfeited"].includes(i.status)).reduce((s, i) => s + (i.unitPrice ?? 0) * (i.qtyObtained ?? i.qty), 0);

  const sendWa = (key: TemplateKey, extra: Partial<Parameters<typeof waMessage>[2]> = {}) => {
    if (!o.customer) return;
    openWa(
      o.customer.phone,
      waMessage(policy, key, { nama: o.customer.name, kode: o.order.code, link: o.trackingUrl, total, tagihan: due, batas: openInvoices[0]?.dueAt ?? null, ...extra }),
    );
  };

  const canDecide = (i: OrderItem) => ["hunting", "needs_approval", "obtained", "partial", "unavailable"].includes(i.status);

  return (
    <Screen
      title={o.order.code}
      back={back}
      largeTitle={false}
      trailing={
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <IconButton label="Lainnya">
              <MoreHorizontal className="size-5" />
            </IconButton>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content align="end" sideOffset={6} className="glass z-50 min-w-[240px] rounded-[16px] p-1.5">
              {[
                { label: "Salin link lacak", run: () => navigator.clipboard?.writeText(o.trackingUrl).then(() => hud("Link disalin")) },
                { label: "Buka halaman lacak", run: () => window.open(o.trackingUrl, "_blank", "noopener") },
                ...(o.order.status === "active" && t.canSettings ? [{ label: "Batalkan pesanan", run: () => setSheet("cancel"), destructive: true }] : []),
              ].map((m) => (
                <DropdownMenu.Item
                  key={m.label}
                  onSelect={m.run}
                  className={`flex cursor-pointer items-center rounded-[10px] px-3 py-2 text-body outline-none data-[highlighted]:bg-fill-3 ${"destructive" in m ? "text-red-text" : ""}`}
                >
                  {m.label}
                </DropdownMenu.Item>
              ))}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      }
    >
      <div className="mb-6 mt-2 flex flex-wrap items-center gap-2">
        <h2 className="text-title2">{o.customer?.name}</h2>
        <Pill tone={ORDER_STATUS[o.order.status]!.tone}>{ORDER_STATUS[o.order.status]!.label}</Pill>
      </div>

      {o.order.status === "requested" && (
        <ListSection footer={o.trip?.dpPercent ? `Setelah dikonfirmasi, tagihan DP ${o.trip.dpPercent}% langsung terbit.` : "Setelah dikonfirmasi, barang masuk daftar belanja."}>
          <div className="flex gap-3 p-4">
            <Button variant="destructive" className="flex-1" onClick={() => setSheet("reject")}>
              Tolak
            </Button>
            <Button className="flex-1" disabled={confirm.isPending} onClick={() => confirm.mutate(undefined, { onSuccess: (r) => setConfirmedTotal(r.total) })}>
              Konfirmasi
            </Button>
          </div>
        </ListSection>
      )}
      {confirmedTotal !== null && o.order.status === "active" && (
        <ListSection footer="Pesan berisi total dan link lacak pesanan.">
          <ListRow
            icon={<MessageCircle />}
            iconBg="var(--green)"
            title={openInvoices.length ? "Kirim tagihan DP via WhatsApp" : "Kabari pelanggan via WhatsApp"}
            onClick={() => (sendWa(openInvoices.length ? "dp" : "confirmed", { total: confirmedTotal }), setConfirmedTotal(null))}
          />
        </ListSection>
      )}
      {o.order.closeReason && (
        <ListSection header="Alasan">
          <p className="p-4 text-body">{o.order.closeReason}</p>
        </ListSection>
      )}

      <ListSection header="Pelanggan">
        <ListRow title={o.customer?.name ?? "—"} subtitle={o.customer ? maskPhone(o.customer.phone) : undefined} chevron onClick={() => o.customer && navigate(`/pelanggan/${o.customer.id}`)} />
        {o.customer && <ListRow icon={<MessageCircle />} iconBg="var(--green)" title="Chat WhatsApp" onClick={() => sendWa("confirmed")} />}
        {o.customer && o.customer.balance > 0 && <ListRow title="Saldo" value={formatRupiah(o.customer.balance)} />}
        {o.address ? (
          <ListRow title={o.address.recipient} subtitle={`${o.address.line}, ${o.address.city}`} />
        ) : (
          <ListRow title="Alamat" value="Nanti / ambil sendiri" />
        )}
        {o.order.notes && <ListRow title="Catatan" subtitle={o.order.notes} />}
        {o.order.status === "active" && (
          <ListRow
            title="Gabung kirim"
            subtitle="Tahan pengiriman sampai pesanan lain pelanggan ini juga sampai"
            trailing={<Switch checked={o.order.holdForCombine} disabled={hold.isPending} onChange={(e) => hold.mutate({ hold: e.target.checked })} aria-label="Gabung kirim" />}
          />
        )}
      </ListSection>

      <ListSection header={`Barang · ${o.trip?.title ?? ""}`} footer={o.order.status === "requested" ? "Ketuk barang titipan (request) untuk mengisi harga." : "Ketuk barang untuk mencatat hasil belanja."}>
        {o.items.map((i) => (
          <ListRow
            key={i.id}
            icon={i.photoKey ? <img src={media(i.photoKey)!} alt="" className="size-full rounded-[8px] object-cover" /> : <Package />}
            iconBg={i.photoKey ? "transparent" : "var(--gray)"}
            title={`${i.title}${i.variant ? ` · ${i.variant}` : ""}`}
            subtitle={
              <>
                {i.qtyObtained !== null && i.status === "partial" ? `${i.qtyObtained}/${i.qty}` : `${i.qty}`} pcs · {itemPrice(i)}
                {i.maxPriceMinor !== null && ` · maks ${formatForeign(i.maxPriceMinor, i.currency)}`}
              </>
            }
            trailing={<ItemPill status={i.status} />}
            chevron={o.order.status === "requested" || canDecide(i) || (i.status === "forfeited" && t.canMoney)}
            onClick={
              o.order.status === "requested"
                ? () => setQuote(i)
                : canDecide(i)
                  ? () => setDecide({ ...i, customer: o.customer?.name })
                  : i.status === "forfeited" && t.canMoney
                    ? () => setRelist(i)
                    : undefined
            }
          />
        ))}
      </ListSection>

      {o.items.some((i) => i.status === "needs_approval") && (
        <ListSection>
          <ListRow icon={<MessageCircle />} iconBg="var(--orange)" title="Ingatkan persetujuan via WhatsApp" onClick={() => sendWa("approval")} />
        </ListSection>
      )}

      {o.invoices.length > 0 && (
        <ListSection header="Tagihan" footer={due > 0 ? `Sisa tagihan ${formatRupiah(due)}` : undefined}>
          {o.invoices.map((inv) => (
            <InvoiceRow
              key={inv.id}
              inv={inv}
              canMoney={t.canMoney}
              hasSaldo={(o.customer?.balance ?? 0) > 0}
              onRecord={() => setPayFor(inv)}
              onVoid={() => setVoidFor(inv)}
              onSend={() => sendWa(inv.type === "dp" || inv.type === "full" ? "dp" : inv.dueAt && inv.dueAt < Date.now() ? "reminder" : "settlement", { tagihan: inv.remaining, batas: inv.dueAt })}
            />
          ))}
        </ListSection>
      )}

      {o.payments.length > 0 && (
        <ListSection header="Pembayaran">
          {o.payments.map((p) => (
            <ListRow
              key={p.id}
              title={formatRupiah(p.amount)}
              subtitle={`${p.method} · ${fmtDateTime(p.createdAt)}${p.rejectReason ? ` · ${p.rejectReason}` : ""}`}
              trailing={<Pill tone={p.status === "verified" ? "green" : p.status === "rejected" ? "red" : "orange"}>{p.status === "verified" ? "Diterima" : p.status === "rejected" ? "Ditolak" : "Menunggu cek"}</Pill>}
              chevron={p.status === "pending"}
              onClick={p.status === "pending" ? () => navigate("/pembayaran") : undefined}
            />
          ))}
        </ListSection>
      )}

      {(o.shipments.length > 0 || o.deliveries.length > 0) && (
        <ListSection header="Pengiriman">
          {o.shipments.map((s) => (
            <ListRow key={s.id} icon={<Truck />} iconBg="var(--teal)" title={s.name} subtitle={s.etaAt ? `ETA ${fmtDate(s.etaAt)}` : undefined} trailing={<ShipmentPill status={s.status} />} chevron onClick={() => navigate(`/pengiriman/${s.id}`)} />
          ))}
          {o.deliveries.map((d) => (
            <ListRow
              key={d.id}
              icon={<Package />}
              iconBg="var(--indigo)"
              title={d.courier ?? "Ambil sendiri"}
              subtitle={d.resi ?? undefined}
              trailing={<DeliveryPill status={d.status} />}
              onClick={d.resi ? () => sendWa("delivery", { kurir: d.courier ?? "kurir", resi: d.resi ?? "" }) : undefined}
            />
          ))}
        </ListSection>
      )}

      <ListSection header="Link lacak pelanggan" footer="Pelanggan bisa cek status barang, tagihan, dan kargo sendiri lewat link ini.">
        <ListRow icon={<Copy />} title="Salin link" onClick={() => navigator.clipboard?.writeText(o.trackingUrl).then(() => hud("Link disalin"))} />
        <ListRow icon={<ExternalLink />} title="Buka halaman lacak" href={o.trackingUrl} />
      </ListSection>

      {o.events.length > 0 && (
        <ListSection header="Riwayat">
          {o.events.slice(0, 30).map((e) => (
            <ListRow key={e.id} title={e.message ?? ITEM_LABEL[e.status as keyof typeof ITEM_LABEL]?.label ?? e.status} subtitle={fmtDateTime(e.createdAt)} />
          ))}
        </ListSection>
      )}

      <ReasonSheet
        open={sheet === "reject"}
        onOpenChange={(v) => !v && setSheet(null)}
        title="Tolak pesanan"
        hint="Alasan ditampilkan ke pelanggan."
        confirmLabel="Tolak pesanan"
        busy={reject.isPending}
        onSubmit={(reason) => reject.mutate({ reason }, { onSuccess: () => setSheet(null) })}
      />
      <ReasonSheet
        open={sheet === "cancel"}
        onOpenChange={(v) => !v && setSheet(null)}
        title="Batalkan pesanan"
        hint="Tagihan yang belum dibayar ikut dibatalkan. Uang yang sudah masuk jadi saldo pelanggan."
        confirmLabel="Batalkan pesanan"
        busy={cancel.isPending}
        onSubmit={(reason) => cancel.mutate({ reason }, { onSuccess: () => setSheet(null) })}
      />
      <ReasonSheet
        open={!!voidFor}
        onOpenChange={(v) => !v && setVoidFor(null)}
        title={`Batalkan ${voidFor?.number ?? ""}`}
        hint="Tercatat di riwayat. Pembayaran yang sudah masuk jadi saldo pelanggan."
        confirmLabel="Batalkan tagihan"
        busy={voidInvoiceAction.isPending}
        onSubmit={(reason) => voidInvoiceAction.mutate({ id: voidFor!.id, reason }, { onSuccess: () => setVoidFor(null) })}
      />
      <QuoteSheet item={quote} onClose={() => setQuote(null)} />
      <DecideSheet item={decide} onClose={() => setDecide(null)} />
      <RecordPaymentSheet invoice={payFor} onClose={() => setPayFor(null)} />
      {relist && <RelistSheet item={relist} onClose={() => setRelist(null)} />}
    </Screen>
  );
}

function InvoiceRow({ inv, canMoney, hasSaldo, onRecord, onVoid, onSend }: { inv: Invoice; canMoney: boolean; hasSaldo: boolean; onRecord: () => void; onVoid: () => void; onSend: () => void }) {
  const saldo = useTenantAction<string>("post", (id) => `/invoices/${id}/saldo`, "Dibayar pakai saldo");
  const markPaid = useTenantAction<string>("post", (id) => `/invoices/${id}/mark-paid`, "Ditandai lunas");
  const open = (inv.status === "open" || inv.status === "partially_paid") && !inv.combinedInto;
  return (
    <div className="border-b-[0.5px] border-separator px-4 py-3 last:border-0">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-body font-semibold">
            {INVOICE_TYPE_LABEL[inv.type]} · {inv.number}
          </p>
          <p className="text-subhead text-label-2 tabular">
            {formatRupiah(inv.amount + inv.uniqueCode)}
            {inv.paid > 0 && ` · dibayar ${formatRupiah(inv.paid)}`}
            {inv.dueAt && open && ` · jatuh tempo ${fmtDate(inv.dueAt)}`}
          </p>
          {inv.combinedInto && <p className="text-footnote text-label-2">Dibayar lewat tagihan gabungan</p>}
        </div>
        {inv.combinedInto && inv.status !== "paid" ? <Pill tone="indigo">Digabung</Pill> : <InvoicePill status={inv.status} />}
      </div>
      {open && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" variant="tinted" icon={<MessageCircle className="size-4" />} onClick={onSend}>
            Kirim tagihan
          </Button>
          {canMoney && (
            <>
              <Button size="sm" variant="gray" onClick={onRecord}>
                Catat bayar
              </Button>
              {hasSaldo && (
                <Button size="sm" variant="gray" disabled={saldo.isPending} onClick={() => saldo.mutate(inv.id)}>
                  Pakai saldo
                </Button>
              )}
              <Button size="sm" variant="gray" disabled={markPaid.isPending} onClick={async () => (await ask(`Tandai ${inv.number} lunas tanpa mencatat uang masuk?`, { action: "Tandai lunas" })) && markPaid.mutate(inv.id)}>
                Tandai lunas
              </Button>
              <Button size="sm" variant="destructive" onClick={onVoid}>
                Batalkan
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function QuoteSheet({ item, onClose }: { item: OrderItem | null; onClose: () => void }) {
  return (
    <Sheet
      open={!!item}
      onOpenChange={(o) => {
        if (o) return;
        onClose();
      }}
      title={item?.title ?? ""}
      detents={["medium"]}
    >
      {item && <QuoteForm key={item.id} item={item} onClose={onClose} />}
    </Sheet>
  );
}

function QuoteForm({ item, onClose }: { item: OrderItem; onClose: () => void }) {
  const exp = currencyExponent(item.currency);
  const [price, setPrice] = useState(() => minorToText(item.priceMinor, exp));
  const [fee, setFee] = useState(() => (item.fee ? String(item.fee) : ""));
  const quote = useTenantAction<{ id: string; body: { priceMinor: number; fee: number } }>("post", (i) => `/items/${i.id}/quote`, "Harga tersimpan");
  const priceMinor = textToMinor(price, exp);
  const feeIdr = fee.trim() ? textToMinor(fee, 0) : 0;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        quote.mutate({ id: item.id, body: { priceMinor, fee: feeIdr } }, { onSuccess: onClose });
      }}
    >
      {item.link && (
        <a href={safeHref(item.link)} target="_blank" rel="noopener noreferrer" className="mb-3 block truncate text-center text-subhead text-tint-text">
          {item.link}
        </a>
      )}
      <ListSection footer={item.maxPriceMinor !== null ? `Pelanggan mau sampai ${formatForeign(item.maxPriceMinor, item.currency)}.` : undefined}>
        <Field label={`Harga (${item.currency})`}>
          {(id) => <Input id={id} value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" autoFocus />}
        </Field>
        <Field label="Fee jasa (Rp)">{(id) => <Input id={id} value={fee} onChange={(e) => setFee(e.target.value)} inputMode="numeric" placeholder="0" />}</Field>
      </ListSection>
      <Button type="submit" block disabled={quote.isPending || !price.trim() || Number.isNaN(priceMinor) || Number.isNaN(feeIdr)}>
        Simpan harga
      </Button>
    </form>
  );
}

function RecordPaymentSheet({ invoice, onClose }: { invoice: Invoice | null; onClose: () => void }) {
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<"transfer" | "qris" | "cash">("transfer");
  const record = useTenantAction<{ id: string; body: { amount: number; method: string } }>("post", (i) => `/invoices/${i.id}/payments`, "Pembayaran dicatat");
  const value = textToMinor(amount || String(invoice?.remaining ?? ""), 0);
  return (
    <Sheet open={!!invoice} onOpenChange={(o) => !o && onClose()} title="Catat pembayaran" detents={["medium"]}>
      {invoice && (
        <form
          key={invoice.id}
          onSubmit={(e) => {
            e.preventDefault();
            record.mutate({ id: invoice.id, body: { amount: value, method } }, { onSuccess: onClose });
          }}
        >
          <Segmented
            label="Metode"
            value={method}
            onChange={setMethod}
            className="mb-4"
            options={[
              { value: "transfer", label: "Transfer" },
              { value: "qris", label: "QRIS" },
              { value: "cash", label: "Tunai" },
            ]}
          />
          <ListSection footer={`Sisa tagihan ${formatRupiah(invoice.remaining)}. Lebihnya masuk ke saldo pelanggan.`}>
            <Field label="Jumlah (Rp)">{(id) => <Input id={id} placeholder={String(invoice.remaining)} value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="numeric" autoFocus />}</Field>
          </ListSection>
          <Button type="submit" block disabled={record.isPending || !(value > 0)}>
            Simpan
          </Button>
        </form>
      )}
    </Sheet>
  );
}

/** Forfeited goods are already in hand: put them on the store's ready-stock shelf. */
function RelistSheet({ item, onClose }: { item: OrderItem; onClose: () => void }) {
  const [price, setPrice] = useState(item.unitPrice ? String(item.unitPrice) : "");
  const relist = useTenantAction<{ price: number }, { productId: string; tripId: string }>("post", `/items/${item.id}/ready-stock`, "Dijual sebagai ready stock");
  const value = textToMinor(price, 0);
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()} title="Jual ulang" detents={["medium"]}>
      <ListSection footer={`${item.qtyObtained ?? item.qty} pcs masuk rak Ready stock di halaman toko. Pembeli bayar penuh, barang langsung dikirim.`}>
        <Field label="Harga jual (Rp)">{(id) => <Input id={id} value={price} onChange={(e) => setPrice(e.target.value)} inputMode="numeric" autoFocus />}</Field>
      </ListSection>
      <Button size="lg" block disabled={!(value > 0) || relist.isPending} onClick={() => relist.mutate({ price: value }, { onSuccess: (r) => (onClose(), navigate(`/trip/${r.tripId}`)) })}>
        Jual sebagai ready stock
      </Button>
    </Sheet>
  );
}
