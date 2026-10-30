import { SHIPMENT_FLOW, SHIPMENT_LABEL, formatKg, formatRupiah, type ShipmentStatus } from "@bawaan/shared";
import { Package, Plus, Scale, Truck, X } from "lucide-react";
import { useMemo, useState } from "react";
import { errorMessage } from "../../lib/api";
import { fmtDate, fmtDateTime, textToMinor } from "../../lib/format";
import { navigate, useLocation } from "../../lib/router";
import type { Delivery, Shipment, TimelineEvent, Trip } from "../../lib/types";
import { Button, IconButton } from "../../ui/Button";
import { ask, EmptyState, ErrorState, SkeletonRows, useHud } from "../../ui/Feedback";
import { Field, Input, Select, TextArea } from "../../ui/Form";
import { ListRow, ListSection } from "../../ui/List";
import { Pill } from "../../ui/Pill";
import { Segmented } from "../../ui/Segmented";
import { Sheet } from "../../ui/Sheet";
import { DeliveryPill, ShipmentPill } from "../common";
import { useTenant } from "../context";
import { useTenantAction, useTenantQuery } from "../hooks";
import { Screen } from "../Screen";

type ShipmentRow = Shipment & { tripId: string; tripTitle: string; itemCount: number };
type DeliveryRow = Delivery & { customerId: string; customer: string; phone: string };
type Candidate = {
  id: string;
  title: string;
  variant: string | null;
  qty: number;
  qtyObtained: number | null;
  orderCode: string;
  customerId: string;
  customer: string;
  shipmentStatus: ShipmentStatus | null;
  hold: boolean;
  waiting: number;
};

export function Shipments() {
  const { search } = useLocation();
  const [tab, setTab] = useState<"cargo" | "domestic">(search.get("tab") === "domestic" ? "domestic" : "cargo");
  const [creating, setCreating] = useState(false);
  return (
    <Screen
      title="Pengiriman"
      trailing={
        tab === "cargo" && (
          <IconButton label="Batch kargo baru" onClick={() => setCreating(true)}>
            <Plus className="size-5" />
          </IconButton>
        )
      }
      accessory={
        <Segmented
          label="Jenis pengiriman"
          value={tab}
          onChange={setTab}
          options={[
            { value: "cargo", label: "Kargo" },
            { value: "domestic", label: "Ke pelanggan" },
          ]}
        />
      }
    >
      {tab === "cargo" ? <CargoList onCreate={() => setCreating(true)} /> : <Domestic />}
      {creating && <NewShipmentSheet onClose={() => setCreating(false)} />}
    </Screen>
  );
}

function CargoList({ onCreate }: { onCreate: () => void }) {
  const q = useTenantQuery<ShipmentRow[]>(["shipments"], "/shipments");
  if (q.isPending) return <SkeletonRows />;
  if (q.isError) return <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  if (!q.data.length)
    return (
      <EmptyState
        icon={<Truck />}
        title="Belum ada batch kargo"
        body="Kelompokkan barang yang dikirim bareng ke forwarder. Sekali update status, semua pelanggannya ikut tahu."
        action={<Button onClick={onCreate}>Buat batch</Button>}
      />
    );
  return (
    <ListSection>
      {q.data.map((s) => (
        <ListRow
          key={s.id}
          icon={<Truck />}
          iconBg="var(--teal)"
          title={s.name}
          subtitle={`${s.tripTitle} · ${s.itemCount} barang${s.etaAt ? ` · ETA ${fmtDate(s.etaAt)}` : ""}`}
          trailing={<ShipmentPill status={s.status} />}
          chevron
          onClick={() => navigate(`/pengiriman/${s.id}`)}
        />
      ))}
    </ListSection>
  );
}

function NewShipmentSheet({ onClose }: { onClose: () => void }) {
  const trips = useTenantQuery<Trip[]>(["trips"], "/trips");
  const [f, setF] = useState({ tripId: "", name: "", forwarder: "", awb: "", etaAt: "" });
  const create = useTenantAction<object, { id: string }>("post", "/shipments", "Batch dibuat");
  const tripId = f.tripId || trips.data?.find((t) => t.status !== "done")?.id || "";
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()} title="Batch kargo baru" detents={["large"]}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate(
            { tripId, name: f.name.trim(), forwarder: f.forwarder.trim() || null, awb: f.awb.trim() || null, etaAt: f.etaAt ? new Date(f.etaAt).getTime() : null },
            { onSuccess: (r) => (onClose(), navigate(`/pengiriman/${r.id}`)) },
          );
        }}
      >
        <ListSection>
          <Field label="Trip">
            {(id) => (
              <Select id={id} value={tripId} onChange={set("tripId")}>
                {trips.data?.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Nama batch">{(id) => <Input id={id} value={f.name} onChange={set("name")} placeholder="Kargo udara #1" autoFocus />}</Field>
          <Field label="Forwarder">{(id) => <Input id={id} value={f.forwarder} onChange={set("forwarder")} placeholder="Opsional" />}</Field>
          <Field label="No. AWB">{(id) => <Input id={id} value={f.awb} onChange={set("awb")} placeholder="Opsional" />}</Field>
          <Field label="Perkiraan tiba">{(id) => <Input id={id} type="date" value={f.etaAt} onChange={set("etaAt")} />}</Field>
        </ListSection>
        <Button type="submit" size="lg" block disabled={!tripId || f.name.trim().length < 2 || create.isPending}>
          Buat batch
        </Button>
      </form>
    </Sheet>
  );
}

type ShipmentItem = { id: string; title: string; variant: string | null; qty: number; qtyObtained: number | null; status: string; orderCode: string; customer: string };

export function ShipmentDetail({ id }: { id: string }) {
  const q = useTenantQuery<{ shipment: Shipment & { tripId: string }; items: ShipmentItem[]; candidates: ShipmentItem[]; events: TimelineEvent[] }>(["shipment", id], `/shipments/${id}`);
  const add = useTenantAction<{ itemIds: string[] }>("post", `/shipments/${id}/items`, "Barang ditambahkan");
  const remove = useTenantAction<string>("del", (itemId) => `/shipments/${id}/items/${itemId}`, "Barang dikeluarkan");
  const [picking, setPicking] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const back = { label: "Pengiriman", to: "/pengiriman" };

  if (q.isPending) return <Screen title="Kargo" back={back} largeTitle={false}><SkeletonRows /></Screen>;
  if (q.isError) return <Screen title="Kargo" back={back} largeTitle={false}><ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} /></Screen>;
  const { shipment: s, items, candidates, events } = q.data;
  const customers = new Set(items.map((i) => i.customer)).size;

  return (
    <Screen title={s.name} back={back}>
      <ListSection footer={`${items.length} barang dari ${customers} pelanggan. Update status langsung dikabarkan ke mereka.`}>
        <div className="flex items-center gap-3 p-4">
          <div className="min-w-0 flex-1">
            <ShipmentPill status={s.status} />
            <p className="mt-2 text-subhead text-label-2">
              {[s.forwarder, s.awb && `AWB ${s.awb}`, s.etaAt && `ETA ${fmtDate(s.etaAt)}`].filter(Boolean).join(" · ") || "Belum ada detail forwarder"}
            </p>
          </div>
          <Button onClick={() => setUpdating(true)} disabled={!items.length}>
            Update status
          </Button>
        </div>
      </ListSection>

      <ListSection header={`Barang · ${items.length}`}>
        {items.map((i) => (
          <ListRow
            key={i.id}
            icon={<Package />}
            iconBg="var(--gray)"
            title={`${i.title}${i.variant ? ` · ${i.variant}` : ""}`}
            subtitle={`${i.customer} · ${i.orderCode} · ${i.qtyObtained ?? i.qty} pcs`}
            trailing={
              <button type="button" aria-label={`Keluarkan ${i.title}`} onClick={() => remove.mutate(i.id)} className="flex size-8 items-center justify-center rounded-full text-label-2 hover:bg-fill-4">
                <X className="size-4" />
              </button>
            }
          />
        ))}
        {!items.length && !candidates.length && <ListRow title="Belum ada barang berstatus Dapat untuk trip ini" />}
        {candidates.length > 0 && <ListRow icon={<Plus />} title={`Tambah barang (${candidates.length} siap kirim)`} onClick={() => setPicking(true)} />}
      </ListSection>

      {items.length > 0 && <CargoBilling shipmentId={s.id} tripId={s.tripId} />}

      {events.length > 0 && (
        <ListSection header="Riwayat status">
          {events.map((e) => (
            <ListRow key={e.id} title={SHIPMENT_LABEL[e.status as ShipmentStatus]?.label ?? e.status} subtitle={[e.message !== SHIPMENT_LABEL[e.status as ShipmentStatus]?.label && e.message, fmtDateTime(e.createdAt)].filter(Boolean).join(" · ")} />
          ))}
        </ListSection>
      )}

      <Sheet open={picking} onOpenChange={setPicking} title="Tambah ke batch" detents={["large"]} trailing={
        <Button size="sm" disabled={!selected.size || add.isPending} onClick={() => add.mutate({ itemIds: [...selected] }, { onSuccess: () => (setSelected(new Set()), setPicking(false)) })}>
          Tambah {selected.size || ""}
        </Button>
      }>
        <ListSection footer="Hanya barang berstatus Dapat yang belum masuk batch lain.">
          <ListRow title={selected.size === candidates.length ? "Batalkan semua" : "Pilih semua"} onClick={() => setSelected(selected.size === candidates.length ? new Set() : new Set(candidates.map((c) => c.id)))} />
          {candidates.map((c) => (
            <label key={c.id} className="flex min-h-[var(--tap)] cursor-pointer items-center gap-3 border-t-[0.5px] border-separator px-4 py-2.5">
              <input
                type="checkbox"
                className="size-5 accent-[var(--tint)]"
                checked={selected.has(c.id)}
                onChange={(e) => {
                  const next = new Set(selected);
                  if (e.target.checked) next.add(c.id);
                  else next.delete(c.id);
                  setSelected(next);
                }}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body">{c.title}{c.variant ? ` · ${c.variant}` : ""}</span>
                <span className="block truncate text-subhead text-label-2">{c.customer} · {c.orderCode}</span>
              </span>
            </label>
          ))}
        </ListSection>
      </Sheet>

      {updating && <StatusSheet shipment={s} onClose={() => setUpdating(false)} />}
    </Screen>
  );
}

function StatusSheet({ shipment, onClose }: { shipment: Shipment; onClose: () => void }) {
  const idx = SHIPMENT_FLOW.indexOf(shipment.status);
  const [status, setStatus] = useState<ShipmentStatus>(SHIPMENT_FLOW[Math.min(idx + 1, SHIPMENT_FLOW.length - 1)] ?? "preparing");
  const [message, setMessage] = useState("");
  const [eta, setEta] = useState(shipment.etaAt ? new Date(shipment.etaAt).toISOString().slice(0, 10) : "");
  const update = useTenantAction<object, { notified: number }>("post", `/shipments/${shipment.id}/status`);
  const statuses = useMemo(() => [...SHIPMENT_FLOW, "delayed", "held_by_customs"] as ShipmentStatus[], []);
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()} title="Update status kargo" detents={["large"]}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          update.mutate({ status, message: message.trim() || undefined, etaAt: eta ? new Date(eta).getTime() : null }, { onSuccess: onClose });
        }}
      >
        <ListSection>
          {statuses.map((st) => (
            <label key={st} className="flex min-h-[var(--tap)] cursor-pointer items-center gap-3 px-4 py-2 [&+&]:border-t-[0.5px] [&+&]:border-separator">
              <input type="radio" name="status" checked={status === st} onChange={() => setStatus(st)} className="size-5 accent-[var(--tint)]" />
              <span className="flex-1 text-body">{SHIPMENT_LABEL[st].label}</span>
              {st === shipment.status && <span className="text-footnote text-label-2">sekarang</span>}
            </label>
          ))}
        </ListSection>
        <ListSection footer={status === "delayed" || status === "held_by_customs" ? "Jelaskan singkat penyebab dan perkiraan barunya supaya pelanggan tidak bertanya-tanya." : undefined}>
          <Field label="Perkiraan tiba">{(id) => <Input id={id} type="date" value={eta} onChange={(e) => setEta(e.target.value)} />}</Field>
          <div className="px-4 py-2">
            <TextArea value={message} onChange={(e) => setMessage(e.target.value)} aria-label="Pesan untuk pelanggan" placeholder="Pesan untuk pelanggan (opsional)" maxLength={300} />
          </div>
        </ListSection>
        <Button type="submit" size="lg" block disabled={update.isPending}>
          Kabari pelanggan
        </Button>
      </form>
    </Sheet>
  );
}

function Domestic() {
  const candidates = useTenantQuery<Candidate[]>(["deliveries", "candidates"], "/deliveries/candidates");
  const list = useTenantQuery<DeliveryRow[]>(["deliveries"], "/deliveries");
  const [shipFor, setShipFor] = useState<{ customerId: string; customer: string; items: Candidate[] } | null>(null);
  const [resiFor, setResiFor] = useState<DeliveryRow | null>(null);

  const byCustomer = useMemo(() => {
    const m = new Map<string, { customerId: string; customer: string; items: Candidate[] }>();
    for (const c of candidates.data ?? []) {
      const g = m.get(c.customerId) ?? { customerId: c.customerId, customer: c.customer, items: [] };
      g.items.push(c);
      m.set(c.customerId, g);
    }
    return [...m.values()];
  }, [candidates.data]);

  if (candidates.isPending || list.isPending) return <SkeletonRows />;
  if (candidates.isError) return <ErrorState message={errorMessage(candidates.error)} onRetry={() => candidates.refetch()} />;

  return (
    <>
      {byCustomer.length === 0 && !list.data?.length && (
        <EmptyState icon={<Package />} title="Belum ada yang perlu dikirim" body="Barang berstatus Dapat yang sudah sampai di kamu bisa dikirim dari sini." />
      )}
      {byCustomer.length > 0 && (
        <ListSection header="Siap dikirim" footer="Barang yang masih di kargo ditandai. Pastikan sudah sampai sebelum dikirim.">
          {byCustomer.map((g) => {
            const inTransit = g.items.filter((i) => i.shipmentStatus && i.shipmentStatus !== "at_seller").length;
            const hold = g.items.some((i) => i.hold) && g.items[0]!.waiting > 0;
            return (
              <ListRow
                key={g.customerId}
                icon={<Package />}
                iconBg={hold ? "var(--orange)" : "var(--indigo)"}
                title={g.customer}
                subtitle={`${g.items.length} barang${inTransit ? ` · ${inTransit} masih di kargo` : ""}${hold ? ` · minta gabung kirim, ${g.items[0]!.waiting} barang lain belum sampai` : ""}`}
                trailing={hold ? <Pill tone="orange">Tahan</Pill> : undefined}
                chevron
                onClick={() => setShipFor(g)}
              />
            );
          })}
        </ListSection>
      )}
      {!!list.data?.length && (
        <ListSection header="Riwayat kirim">
          {list.data.map((d) => (
            <ListRow
              key={d.id}
              title={d.customer}
              subtitle={[d.courier ?? (d.status === "picked_up" ? "Ambil sendiri" : null), d.resi, d.shippedAt && fmtDate(d.shippedAt)].filter(Boolean).join(" · ")}
              trailing={<DeliveryPill status={d.status} />}
              chevron={d.status !== "delivered" && d.status !== "picked_up"}
              onClick={d.status !== "delivered" && d.status !== "picked_up" ? () => setResiFor(d) : undefined}
            />
          ))}
        </ListSection>
      )}
      {shipFor && <DeliverySheet group={shipFor} onClose={() => setShipFor(null)} />}
      {resiFor && <DeliveryUpdateSheet delivery={resiFor} onClose={() => setResiFor(null)} />}
    </>
  );
}

function DeliverySheet({ group, onClose }: { group: { customerId: string; customer: string; items: Candidate[] }; onClose: () => void }) {
  const [selected, setSelected] = useState(() => new Set(group.items.filter((i) => !i.shipmentStatus || i.shipmentStatus === "at_seller").map((i) => i.id)));
  const [mode, setMode] = useState<"shipped" | "packed" | "picked_up">("shipped");
  const [courier, setCourier] = useState("");
  const [resi, setResi] = useState("");
  const [cost, setCost] = useState("");
  const create = useTenantAction<object>("post", "/deliveries", "Pengiriman dicatat");
  const caps = useTenantQuery<{ courier: boolean }>(["capabilities"], "/capabilities");
  const costValue = cost.trim() ? textToMinor(cost, 0) : 0;
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()} title={`Kirim ke ${group.customer}`} detents={["large"]}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate(
            { customerId: group.customerId, itemIds: [...selected], courier: mode === "picked_up" ? null : courier.trim() || null, resi: mode === "picked_up" ? null : resi.trim() || null, cost: mode === "picked_up" ? 0 : costValue, status: mode },
            { onSuccess: onClose },
          );
        }}
      >
        <Segmented
          label="Cara kirim"
          value={mode}
          onChange={setMode}
          className="mb-4"
          options={[
            { value: "shipped", label: "Dikirim" },
            { value: "packed", label: "Dikemas" },
            { value: "picked_up", label: "Diambil" },
          ]}
        />
        <ListSection header="Barang">
          {group.items.map((c) => (
            <label key={c.id} className="flex min-h-[var(--tap)] cursor-pointer items-center gap-3 px-4 py-2.5 [&+&]:border-t-[0.5px] [&+&]:border-separator">
              <input
                type="checkbox"
                className="size-5 accent-[var(--tint)]"
                checked={selected.has(c.id)}
                onChange={(e) => {
                  const next = new Set(selected);
                  if (e.target.checked) next.add(c.id);
                  else next.delete(c.id);
                  setSelected(next);
                }}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body">{c.title}{c.variant ? ` · ${c.variant}` : ""}</span>
                <span className="block truncate text-subhead text-label-2">
                  {c.orderCode}
                  {c.shipmentStatus && c.shipmentStatus !== "at_seller" && ` · ${SHIPMENT_LABEL[c.shipmentStatus].label}`}
                </span>
              </span>
            </label>
          ))}
        </ListSection>
        {mode !== "picked_up" && caps.data?.courier && <RateChecker customerId={group.customerId} onPick={(r) => (setCourier(`${r.courier} ${r.service}`), setCost(String(r.price)))} />}
        {mode !== "picked_up" && (
          <ListSection footer="Ongkir lebih dari 0 otomatis dibuatkan tagihan ongkir untuk pelanggan.">
            <Field label="Kurir">{(id) => <Input id={id} value={courier} onChange={(e) => setCourier(e.target.value)} placeholder="JNE, J&T, SiCepat…" />}</Field>
            <Field label="No. resi">{(id) => <Input id={id} value={resi} onChange={(e) => setResi(e.target.value)} placeholder={mode === "packed" ? "Bisa diisi nanti" : ""} autoCapitalize="characters" />}</Field>
            <Field label="Ongkir (Rp)">{(id) => <Input id={id} value={cost} onChange={(e) => setCost(e.target.value)} inputMode="numeric" placeholder="0" />}</Field>
          </ListSection>
        )}
        <Button type="submit" size="lg" block disabled={!selected.size || create.isPending || Number.isNaN(costValue)}>
          Simpan
        </Button>
      </form>
    </Sheet>
  );
}

function DeliveryUpdateSheet({ delivery, onClose }: { delivery: DeliveryRow; onClose: () => void }) {
  const [courier, setCourier] = useState(delivery.courier ?? "");
  const [resi, setResi] = useState(delivery.resi ?? "");
  const update = useTenantAction<object>("patch", `/deliveries/${delivery.id}`, "Pengiriman diperbarui");
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()} title={delivery.customer} detents={["medium"]}>
      <ListSection>
        <Field label="Kurir">{(id) => <Input id={id} value={courier} onChange={(e) => setCourier(e.target.value)} />}</Field>
        <Field label="No. resi">{(id) => <Input id={id} value={resi} onChange={(e) => setResi(e.target.value)} autoCapitalize="characters" />}</Field>
      </ListSection>
      <div className="flex gap-3">
        <Button variant="gray" className="flex-1" disabled={update.isPending} onClick={() => update.mutate({ courier: courier.trim() || null, resi: resi.trim() || null, status: "shipped" }, { onSuccess: onClose })}>
          Simpan resi
        </Button>
        <Button className="flex-1" disabled={update.isPending} onClick={() => update.mutate({ status: "delivered" }, { onSuccess: onClose })}>
          Sudah diterima
        </Button>
      </div>
    </Sheet>
  );
}

type CargoRow = {
  customerId: string;
  customer: string;
  orderCodes: string[];
  itemCount: number;
  value: number;
  weightG: number | null;
  lengthCm: number | null;
  widthCm: number | null;
  heightCm: number | null;
  billedG: number | null;
  volumetric: boolean;
  amount: number | null;
  invoiceNumber: string | null;
};
type CargoData = {
  rule: { ratePerKg: number; roundG: number; minIdr: number } | null;
  costIdr: number;
  dutyIdr: number;
  dutyMode: "pass" | "absorb";
  dutyBilled: boolean;
  rows: CargoRow[];
  totalBilled: number;
  totalPreview: number;
};

function CargoBilling({ shipmentId, tripId }: { shipmentId: string; tripId: string }) {
  const t = useTenant();
  const q = useTenantQuery<CargoData>(["shipment", shipmentId, "cargo"], `/shipments/${shipmentId}/cargo`);
  const bill = useTenantAction<void, { issued: number; total: number }>("post", `/shipments/${shipmentId}/bill-cargo`);
  const hud = useHud();
  const [weighing, setWeighing] = useState(false);
  const [costs, setCosts] = useState(false);
  if (!q.data) return null;
  const d = q.data;
  const unbilled = d.rows.filter((r) => !r.invoiceNumber && r.amount);
  const weighed = d.rows.filter((r) => r.weightG !== null).length;
  return (
    <>
      <ListSection
        header="Ongkir kargo"
        footer={
          d.rule
            ? `${formatRupiah(d.rule.ratePerKg)}/kg, dibulatkan ke atas per ${formatKg(d.rule.roundG)}${d.rule.minIdr ? `, minimal ${formatRupiah(d.rule.minIdr)}` : ""}. Berat volume (P×L×T/6000) dipakai kalau lebih besar.`
            : undefined
        }
      >
        {!d.rule ? (
          <ListRow title="Tarif kargo belum diisi" subtitle="Isi tarif per kg di pengaturan trip supaya tagihan ongkir bisa dihitung otomatis." chevron onClick={() => navigate(`/trip/${tripId}`)} />
        ) : (
          <>
            {d.rows.map((r) => (
              <ListRow
                key={r.customerId}
                title={r.customer}
                subtitle={
                  r.weightG === null
                    ? `${r.itemCount} barang · belum ditimbang`
                    : `${formatKg(r.weightG)}${r.volumetric ? ` → ${formatKg(r.billedG!)} (volume)` : r.billedG !== r.weightG ? ` → ${formatKg(r.billedG!)}` : ""}${r.invoiceNumber ? ` · ${r.invoiceNumber}` : ""}`
                }
                value={r.amount !== null ? formatRupiah(r.amount) : undefined}
                trailing={r.invoiceNumber ? <Pill tone="green">Ditagih</Pill> : undefined}
              />
            ))}
            <ListRow icon={<Scale />} title={weighed ? "Ubah berat paket" : "Isi berat paket"} chevron onClick={() => setWeighing(true)} />
            {t.canMoney && unbilled.length > 0 && (
              <div className="p-4">
                <Button
                  block
                  disabled={bill.isPending}
                  onClick={async () =>
                    (await ask(`Terbitkan ${unbilled.length} tagihan ongkir kargo, total ${formatRupiah(unbilled.reduce((s, r) => s + (r.amount ?? 0), 0))}? Pelanggan langsung dikabari.`, { action: "Terbitkan" })) &&
                    bill.mutate(undefined, { onSuccess: (r) => hud(`${r.issued} tagihan terbit`) })
                  }
                >
                  Terbitkan {unbilled.length} tagihan · {formatRupiah(unbilled.reduce((s, r) => s + (r.amount ?? 0), 0))}
                </Button>
              </div>
            )}
          </>
        )}
      </ListSection>

      {t.canMoney && (
        <ListSection header="Biaya batch" footer="Biaya forwarder dan bea masuk dipakai di laporan untung-rugi trip.">
          <ListRow title="Biaya forwarder" value={d.costIdr ? formatRupiah(d.costIdr) : "—"} />
          <ListRow
            title="Bea masuk"
            value={d.dutyIdr ? formatRupiah(d.dutyIdr) : "—"}
            subtitle={d.dutyIdr ? (d.dutyMode === "absorb" ? "Ditanggung seller" : d.dutyBilled ? "Dibebankan ke pelanggan · sudah ditagih" : "Dibebankan ke pelanggan") : undefined}
          />
          <ListRow title="Ubah biaya" chevron onClick={() => setCosts(true)} />
        </ListSection>
      )}

      {weighing && <WeighSheet shipmentId={shipmentId} rows={d.rows} onClose={() => setWeighing(false)} />}
      {costs && <CostsSheet shipmentId={shipmentId} data={d} onClose={() => setCosts(false)} />}
    </>
  );
}

const num = (v: string) => (v.trim() ? Number(v.replace(",", ".")) : null);

function WeighSheet({ shipmentId, rows, onClose }: { shipmentId: string; rows: CargoRow[]; onClose: () => void }) {
  const [form, setForm] = useState(() =>
    Object.fromEntries(
      rows.map((r) => [r.customerId, { kg: r.weightG !== null ? String(r.weightG / 1000).replace(".", ",") : "", l: r.lengthCm ? String(r.lengthCm) : "", w: r.widthCm ? String(r.widthCm) : "", h: r.heightCm ? String(r.heightCm) : "" }]),
    ),
  );
  const save = useTenantAction<{ body: unknown }, { saved: number; locked: number }>("put", `/shipments/${shipmentId}/parcels`, "Berat tersimpan");
  const editable = rows.filter((r) => !r.invoiceNumber);
  const payload = editable
    .map((r) => ({ r, f: form[r.customerId]! }))
    .filter(({ f }) => f.kg.trim())
    .map(({ r, f }) => ({ customerId: r.customerId, weightG: Math.round((num(f.kg) ?? 0) * 1000), lengthCm: num(f.l), widthCm: num(f.w), heightCm: num(f.h) }));
  const invalid = payload.some((p) => !Number.isFinite(p.weightG) || p.weightG < 0 || [p.lengthCm, p.widthCm, p.heightCm].some((x) => x !== null && !(Number.isInteger(x) && x > 0)));
  const set = (id: string, k: "kg" | "l" | "w" | "h") => (e: { target: { value: string } }) => setForm({ ...form, [id]: { ...form[id]!, [k]: e.target.value } });
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()} title="Berat paket" detents={["large"]}>
      <p className="mb-4 text-center text-subhead text-label-2">Satu paket per pelanggan. Ukuran boleh dikosongkan kalau tidak dihitung volume.</p>
      {editable.map((r) => (
        <ListSection key={r.customerId} header={`${r.customer} · ${r.itemCount} barang`}>
          <Field label="Berat (kg)">{(id) => <Input id={id} value={form[r.customerId]!.kg} onChange={set(r.customerId, "kg")} inputMode="decimal" placeholder="1,25" />}</Field>
          <Field label="P × L × T (cm)">
            {() => (
              <div className="flex items-center justify-end gap-1">
                {(["l", "w", "h"] as const).map((k, i) => (
                  <span key={k} className="flex items-center gap-1">
                    {i > 0 && <span className="text-label-3">×</span>}
                    <input
                      aria-label={["Panjang", "Lebar", "Tinggi"][i]}
                      value={form[r.customerId]![k]}
                      onChange={set(r.customerId, k)}
                      inputMode="numeric"
                      className="w-12 rounded-[8px] bg-fill-3 px-1.5 py-1 text-center text-body outline-none"
                    />
                  </span>
                ))}
              </div>
            )}
          </Field>
        </ListSection>
      ))}
      {rows.length > editable.length && <p className="mb-4 text-center text-footnote text-label-2">Paket yang sudah ditagih tidak bisa diubah. Batalkan tagihannya dulu.</p>}
      <Button size="lg" block disabled={!payload.length || invalid || save.isPending} onClick={() => save.mutate({ body: payload }, { onSuccess: onClose })}>
        Simpan
      </Button>
    </Sheet>
  );
}

function CostsSheet({ shipmentId, data, onClose }: { shipmentId: string; data: CargoData; onClose: () => void }) {
  const [cost, setCost] = useState(data.costIdr ? String(data.costIdr) : "");
  const [duty, setDuty] = useState(data.dutyIdr ? String(data.dutyIdr) : "");
  const [mode, setMode] = useState(data.dutyMode);
  const save = useTenantAction<object, { issued: number }>("post", `/shipments/${shipmentId}/costs`);
  const hud = useHud();
  const costV = cost.trim() ? textToMinor(cost, 0) : 0;
  const dutyV = duty.trim() ? textToMinor(duty, 0) : 0;
  const bad = Number.isNaN(costV) || Number.isNaN(dutyV);
  const submit = (bill: boolean) =>
    save.mutate({ costIdr: costV, dutyIdr: dutyV, dutyMode: mode, bill }, { onSuccess: (r) => (hud(r.issued ? `${r.issued} tagihan bea masuk terbit` : "Tersimpan"), onClose()) });
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()} title="Biaya batch" detents={["large"]}>
      <ListSection footer="Biaya yang kamu bayar ke forwarder untuk batch ini.">
        <Field label="Biaya forwarder (Rp)">{(id) => <Input id={id} value={cost} onChange={(e) => setCost(e.target.value)} inputMode="numeric" placeholder="0" />}</Field>
      </ListSection>
      <ListSection
        header="Bea masuk"
        footer={
          data.dutyBilled
            ? "Tagihan bea masuk sudah terbit, jadi nilai dan caranya terkunci."
            : mode === "pass"
              ? "Dibagi ke pelanggan sesuai nilai barang masing-masing di batch ini."
              : "Tidak ditagihkan. Tetap tercatat di laporan sebagai biaya."
        }
      >
        <Field label="Total bea (Rp)">{(id) => <Input id={id} value={duty} onChange={(e) => setDuty(e.target.value)} inputMode="numeric" placeholder="0" disabled={data.dutyBilled} />}</Field>
        <div className="p-4">
          <Segmented
            label="Bea masuk ditanggung"
            value={mode}
            onChange={setMode}
            options={[
              { value: "pass", label: "Pelanggan" },
              { value: "absorb", label: "Seller" },
            ]}
          />
        </div>
      </ListSection>
      <div className="flex gap-3">
        <Button variant="gray" className="flex-1" disabled={bad || save.isPending} onClick={() => submit(false)}>
          Simpan
        </Button>
        {mode === "pass" && dutyV > 0 && !data.dutyBilled && (
          <Button className="flex-1" disabled={bad || save.isPending} onClick={async () => (await ask(`Bagi ${formatRupiah(dutyV)} ke pelanggan di batch ini dan terbitkan tagihannya?`, { action: "Terbitkan" })) && submit(true)}>
            Simpan & tagih
          </Button>
        )}
      </div>
    </Sheet>
  );
}

type Rate = { courier: string; code: string; service: string; price: number; duration: string };

function RateChecker({ customerId, onPick }: { customerId: string; onPick: (r: Rate) => void }) {
  const [kg, setKg] = useState("1");
  const check = useTenantAction<object, { rates: Rate[] }>("post", "/deliveries/rates");
  const grams = Math.round(Number(kg.replace(",", ".")) * 1000);
  return (
    <ListSection header="Cek ongkir" footer="Dari kode pos asal di pengaturan ke kode pos alamat pelanggan. Ketuk tarif untuk memakainya.">
      <Field label="Berat (kg)">
        {(id) => (
          <div className="flex items-center justify-end gap-2">
            <Input id={id} value={kg} onChange={(e) => setKg(e.target.value)} inputMode="decimal" className="w-16" />
            <Button size="sm" variant="gray" disabled={!(grams > 0) || check.isPending} onClick={() => check.mutate({ customerId, weightG: grams })}>
              Cek
            </Button>
          </div>
        )}
      </Field>
      {check.data?.rates.slice(0, 8).map((r) => (
        <ListRow key={`${r.code}-${r.service}`} title={`${r.courier} ${r.service}`} subtitle={r.duration} value={formatRupiah(r.price)} onClick={() => onPick(r)} />
      ))}
    </ListSection>
  );
}
