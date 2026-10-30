import { INVOICE_TYPE_LABEL, formatRupiah, maskPhone, waLink } from "@bawaan/shared";
import { Check, Download, FileUp, MessageCircle, Users } from "lucide-react";
import { useDeferredValue, useRef, useState } from "react";
import { errorMessage } from "../../lib/api";
import { guessColumns, parseCsv, type ColumnMap } from "../../lib/csv";
import { fmtDate, fmtDateTime, textToMinor } from "../../lib/format";
import { navigate } from "../../lib/router";
import type { Invoice } from "../../lib/types";
import { Button, IconButton } from "../../ui/Button";
import { EmptyState, ErrorState, SkeletonRows, useHud } from "../../ui/Feedback";
import { Field, Input, SearchField, Select, TextArea } from "../../ui/Form";
import { ListRow, ListSection } from "../../ui/List";
import { Pill } from "../../ui/Pill";
import { Segmented } from "../../ui/Segmented";
import { Sheet } from "../../ui/Sheet";
import { ORDER_STATUS } from "../common";
import { useTenant } from "../context";
import { useTenantAction, useTenantQuery } from "../hooks";
import { Screen } from "../Screen";

type CustomerRow = { id: string; name: string; phone: string; balance: number; tags: string | null; createdAt: number; orderCount: number };

export function Customers() {
  const t = useTenant();
  const [q, setQ] = useState("");
  const dq = useDeferredValue(q.trim());
  const list = useTenantQuery<CustomerRow[]>(["customers", dq], `/customers${dq ? `?q=${encodeURIComponent(dq)}` : ""}`);
  const [importing, setImporting] = useState(false);

  return (
    <Screen
      title="Pelanggan"
      trailing={
        <>
          <IconButton label="Impor CSV" onClick={() => setImporting(true)}>
            <FileUp className="size-5" />
          </IconButton>
          <a href={`${t.base}/customers/export.csv`} download aria-label="Ekspor CSV" title="Ekspor CSV" className="glass inline-flex size-11 items-center justify-center rounded-full">
            <Download className="size-5" />
          </a>
        </>
      }
      accessory={<SearchField value={q} onChange={setQ} placeholder="Cari nama atau nomor" />}
    >
      {list.isPending && <SkeletonRows rows={6} />}
      {list.isError && <ErrorState message={errorMessage(list.error)} onRetry={() => list.refetch()} />}
      {list.data?.length === 0 && (
        <EmptyState
          icon={<Users />}
          title={dq ? "Tidak ketemu" : "Belum ada pelanggan"}
          body={dq ? "Coba kata kunci lain." : "Pelanggan tercatat otomatis saat memesan. Punya daftar lama di Excel? Impor saja."}
          action={!dq && <Button onClick={() => setImporting(true)}>Impor dari CSV</Button>}
        />
      )}
      {!!list.data?.length && (
        <ListSection footer={`${list.data.length} pelanggan`}>
          {list.data.map((c) => (
            <ListRow
              key={c.id}
              title={c.name}
              subtitle={[maskPhone(c.phone), `${c.orderCount} pesanan`, c.tags].filter(Boolean).join(" · ")}
              value={c.balance > 0 ? formatRupiah(c.balance) : undefined}
              chevron
              onClick={() => navigate(`/pelanggan/${c.id}`)}
            />
          ))}
        </ListSection>
      )}
      {importing && <ImportSheet onClose={() => setImporting(false)} />}
    </Screen>
  );
}

function ImportSheet({ onClose }: { onClose: () => void }) {
  const hud = useHud();
  const file = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<string[][] | null>(null);
  const [map, setMap] = useState<ColumnMap>({});
  const [result, setResult] = useState<{ imported: number; duplicates: number; errors: Array<{ row: number; message: string }> } | null>(null);
  const run = useTenantAction<object[], NonNullable<typeof result>>("post", "/customers/import");
  const header = rows?.[0] ?? [];
  const body = rows?.slice(1) ?? [];
  const records = body
    .map((r) => ({
      name: map.name !== undefined ? (r[map.name] ?? "").trim() : "",
      phone: map.phone !== undefined ? (r[map.phone] ?? "").trim() : "",
      email: map.email !== undefined ? r[map.email]?.trim() || undefined : undefined,
      notes: map.notes !== undefined ? r[map.notes]?.trim() || undefined : undefined,
      tags: map.tags !== undefined ? r[map.tags]?.trim() || undefined : undefined,
    }))
    .filter((r) => r.name && r.phone);

  const columnSelect = (field: keyof ColumnMap, label: string) => (
    <Field label={label}>
      {(id) => (
        <Select id={id} value={map[field] ?? ""} onChange={(e) => setMap({ ...map, [field]: e.target.value === "" ? undefined : Number(e.target.value) })}>
          <option value="">—</option>
          {header.map((h, i) => (
            <option key={i} value={i}>
              {h || `Kolom ${i + 1}`}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()} title="Impor pelanggan" detents={["large"]}>
      {!rows && (
        <EmptyState
          icon={<FileUp />}
          title="Pilih file CSV"
          body="Simpan sheet Excel/Google Sheets sebagai CSV. Baris pertama berisi judul kolom, minimal nama dan nomor WhatsApp."
          action={
            <>
              <Button onClick={() => file.current?.click()}>Pilih file</Button>
              <input
                ref={file}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  const parsed = parseCsv(await f.text());
                  if (parsed.length < 2) return hud("File kosong atau tidak terbaca", "error");
                  if (parsed.length > 2001) return hud("Maksimal 2.000 baris sekali impor", "error");
                  setRows(parsed);
                  setMap(guessColumns(parsed[0]!));
                }}
              />
            </>
          }
        />
      )}
      {rows && !result && (
        <>
          <ListSection header="Cocokkan kolom">
            {columnSelect("name", "Nama")}
            {columnSelect("phone", "WhatsApp")}
            {columnSelect("email", "Email")}
            {columnSelect("notes", "Catatan")}
            {columnSelect("tags", "Tag")}
          </ListSection>
          <ListSection header={`Pratinjau · ${records.length} dari ${body.length} baris`} footer="Nomor yang sudah ada akan diperbarui, bukan diduplikasi.">
            {records.slice(0, 5).map((r, i) => (
              <ListRow key={i} title={r.name} subtitle={r.phone} />
            ))}
          </ListSection>
          <Button size="lg" block disabled={!records.length || run.isPending} onClick={() => run.mutate(records, { onSuccess: setResult })}>
            {run.isPending ? "Mengimpor…" : `Impor ${records.length} pelanggan`}
          </Button>
        </>
      )}
      {result && (
        <>
          <ListSection>
            <ListRow title="Berhasil" value={result.imported} />
            <ListRow title="Duplikat dalam file" value={result.duplicates} />
            <ListRow title="Gagal" value={result.errors.length} />
          </ListSection>
          {result.errors.length > 0 && (
            <ListSection header="Baris gagal">
              {result.errors.slice(0, 50).map((e) => (
                <ListRow key={e.row} title={`Baris ${e.row + 1}`} subtitle={e.message} />
              ))}
            </ListSection>
          )}
          <Button block onClick={onClose}>
            Selesai
          </Button>
        </>
      )}
    </Sheet>
  );
}

type CustomerDetailData = {
  customer: { id: string; name: string; phone: string; email: string | null; balance: number; notes: string | null; tags: string | null; createdAt: number };
  orders: Array<{ id: string; code: string; status: string; createdAt: number; tripTitle: string }>;
  ledger: Array<{ id: string; delta: number; reason: string; createdAt: number }>;
  addresses: Array<{ id: string; recipient: string; line: string; city: string }>;
};

export function CustomerDetail({ id }: { id: string }) {
  const t = useTenant();
  const q = useTenantQuery<CustomerDetailData>(["customer", id], `/customers/${id}`);
  const [editing, setEditing] = useState(false);
  const [adjusting, setAdjusting] = useState(false);
  const [merging, setMerging] = useState(false);
  const back = { label: "Pelanggan", to: "/pelanggan" };
  if (q.isPending) return <Screen title="Pelanggan" back={back} largeTitle={false}><SkeletonRows /></Screen>;
  if (q.isError) return <Screen title="Pelanggan" back={back} largeTitle={false}><ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} /></Screen>;
  const { customer: c, orders, ledger, addresses } = q.data;

  return (
    <Screen title={c.name} back={back} trailing={<Button variant="glass" onClick={() => setEditing(true)}>Ubah</Button>}>
      <ListSection>
        <ListRow title="WhatsApp" value={c.phone} />
        <ListRow icon={<MessageCircle />} iconBg="var(--green)" title="Chat WhatsApp" href={waLink(c.phone)} />
        {c.email && <ListRow title="Email" value={c.email} />}
        <ListRow title="Pelanggan sejak" value={fmtDate(c.createdAt)} />
        {c.tags && <ListRow title="Tag" value={c.tags} />}
        {c.notes && <ListRow title="Catatan" subtitle={c.notes} />}
      </ListSection>

      <ListSection header="Saldo" footer="Saldo terpakai otomatis untuk tagihan berikutnya, atau bisa dicairkan ke rekening pelanggan.">
        <ListRow title="Saldo sekarang" value={formatRupiah(c.balance)} />
        {t.canMoney && <ListRow title="Ubah saldo" chevron onClick={() => setAdjusting(true)} />}
        {ledger.slice(0, 10).map((l) => (
          <ListRow key={l.id} title={l.reason} subtitle={fmtDateTime(l.createdAt)} value={`${l.delta > 0 ? "+" : ""}${formatRupiah(l.delta)}`} />
        ))}
      </ListSection>

      <ListSection header={`Pesanan · ${orders.length}`}>
        {orders.map((o) => (
          <ListRow
            key={o.id}
            title={o.code}
            subtitle={`${o.tripTitle} · ${fmtDate(o.createdAt)}`}
            trailing={<Pill tone={ORDER_STATUS[o.status]?.tone ?? "gray"}>{ORDER_STATUS[o.status]?.label ?? o.status}</Pill>}
            chevron
            onClick={() => navigate(`/pesanan/${o.id}`)}
          />
        ))}
        {!orders.length && <ListRow title="Belum ada pesanan" />}
      </ListSection>

      <CustomerInvoices customerId={c.id} />

      {addresses.length > 0 && (
        <ListSection header="Alamat">
          {addresses.map((a) => (
            <ListRow key={a.id} title={a.recipient} subtitle={`${a.line}, ${a.city}`} />
          ))}
        </ListSection>
      )}

      {t.canSettings && (
        <ListSection footer="Untuk pelanggan yang sama dengan nomor WhatsApp berbeda. Pesanan, tagihan, dan saldo dipindah ke pelanggan pilihanmu.">
          <ListRow title="Gabungkan dengan pelanggan lain" chevron onClick={() => setMerging(true)} />
        </ListSection>
      )}

      {editing && <EditCustomerSheet customer={c} onClose={() => setEditing(false)} />}
      {merging && <MergeSheet from={c} onClose={() => setMerging(false)} />}
      {adjusting && <LedgerSheet customerId={c.id} balance={c.balance} onClose={() => setAdjusting(false)} />}
    </Screen>
  );
}

function EditCustomerSheet({ customer, onClose }: { customer: CustomerDetailData["customer"]; onClose: () => void }) {
  const [name, setName] = useState(customer.name);
  const [tags, setTags] = useState(customer.tags ?? "");
  const [notes, setNotes] = useState(customer.notes ?? "");
  const save = useTenantAction<object>("patch", `/customers/${customer.id}`, "Tersimpan");
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()} title="Ubah pelanggan" detents={["large"]}>
      <ListSection footer="Tag membantu menandai pelanggan, misalnya: VIP, suka telat bayar.">
        <Field label="Nama">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
        <Field label="Tag">{(id) => <Input id={id} value={tags} onChange={(e) => setTags(e.target.value)} placeholder="VIP" />}</Field>
      </ListSection>
      <ListSection header="Catatan internal">
        <div className="px-4 py-2">
          <TextArea value={notes} onChange={(e) => setNotes(e.target.value)} aria-label="Catatan" maxLength={1000} />
        </div>
      </ListSection>
      <Button size="lg" block disabled={!name.trim() || save.isPending} onClick={() => save.mutate({ name: name.trim(), tags: tags.trim() || null, notes: notes.trim() || null }, { onSuccess: onClose })}>
        Simpan
      </Button>
    </Sheet>
  );
}

function LedgerSheet({ customerId, balance, onClose }: { customerId: string; balance: number; onClose: () => void }) {
  const [dir, setDir] = useState<"out" | "in">("out");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const save = useTenantAction<object>("post", `/customers/${customerId}/ledger`, "Saldo diperbarui");
  const value = textToMinor(amount, 0);
  const delta = dir === "out" ? -value : value;
  const valid = value > 0 && reason.trim().length >= 3 && balance + delta >= 0;
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()} title="Ubah saldo" detents={["medium"]}>
      <Segmented
        label="Jenis"
        value={dir}
        onChange={setDir}
        className="mb-4"
        options={[
          { value: "out", label: "Dicairkan / kurangi" },
          { value: "in", label: "Tambah" },
        ]}
      />
      <ListSection footer={`Saldo sekarang ${formatRupiah(balance)}. Tercatat di riwayat dan log audit.`}>
        <Field label="Jumlah (Rp)">{(id) => <Input id={id} value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="numeric" autoFocus />}</Field>
        <Field label="Alasan">{(id) => <Input id={id} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={dir === "out" ? "Transfer ke BCA" : "Koreksi"} />}</Field>
      </ListSection>
      <Button size="lg" block disabled={!valid || save.isPending} onClick={() => save.mutate({ delta, reason: reason.trim() }, { onSuccess: onClose })}>
        Simpan
      </Button>
    </Sheet>
  );
}

type CustomerInvoice = Invoice & { orderCode: string | null };

/** Open invoices across every order, so several can be merged into one transfer. */
function CustomerInvoices({ customerId }: { customerId: string }) {
  const t = useTenant();
  const q = useTenantQuery<CustomerInvoice[]>(["customer", customerId, "invoices"], `/customers/${customerId}/invoices`);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const combine = useTenantAction<{ invoiceIds: string[] }, Invoice>("post", "/invoices/combine", "Tagihan digabung");
  const open = (q.data ?? []).filter((i) => (i.status === "open" || i.status === "partially_paid") && !i.combinedInto);
  if (!open.length) return null;
  const total = open.filter((i) => picked.has(i.id)).reduce((s, i) => s + i.remaining, 0);
  const canCombine = t.canMoney && open.filter((i) => i.type !== "combined").length >= 2;
  return (
    <ListSection
      header={`Tagihan terbuka · ${open.length}`}
      footer={canCombine ? "Pilih beberapa tagihan lalu gabungkan supaya pelanggan cukup transfer sekali dengan satu kode unik." : undefined}
    >
      {open.map((i) => (
        <label key={i.id} className="flex min-h-[var(--tap)] items-center gap-3 px-4 py-2.5 [&+&]:border-t-[0.5px] [&+&]:border-separator">
          {canCombine && i.type !== "combined" && (
            <input
              type="checkbox"
              className="size-5 accent-[var(--tint)]"
              checked={picked.has(i.id)}
              onChange={(e) => {
                const next = new Set(picked);
                if (e.target.checked) next.add(i.id);
                else next.delete(i.id);
                setPicked(next);
              }}
            />
          )}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-body">{INVOICE_TYPE_LABEL[i.type]} · {i.number}</span>
            <span className="block truncate text-subhead text-label-2">{[i.orderCode, i.dueAt && `jatuh tempo ${fmtDate(i.dueAt)}`].filter(Boolean).join(" · ")}</span>
          </span>
          <span className="text-body text-label-2 tabular">{formatRupiah(i.remaining)}</span>
        </label>
      ))}
      {picked.size >= 2 && (
        <div className="p-4">
          <Button block disabled={combine.isPending} onClick={() => combine.mutate({ invoiceIds: [...picked] }, { onSuccess: () => setPicked(new Set()) })}>
            Gabungkan {picked.size} tagihan · {formatRupiah(total)}
          </Button>
        </div>
      )}
    </ListSection>
  );
}

function MergeSheet({ from, onClose }: { from: CustomerDetailData["customer"]; onClose: () => void }) {
  const [term, setTerm] = useState("");
  const dterm = useDeferredValue(term.trim());
  const list = useTenantQuery<CustomerRow[]>(["customers", dterm], `/customers?q=${encodeURIComponent(dterm)}`);
  const [into, setInto] = useState<CustomerRow | null>(null);
  const merge = useTenantAction<{ intoId: string }>("post", `/customers/${from.id}/merge`, "Pelanggan digabung");
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()} title={`Gabungkan ${from.name}`} detents={["large"]}>
      <div className="mb-4">
        <SearchField value={term} onChange={setTerm} placeholder="Cari pelanggan tujuan" />
      </div>
      <ListSection footer={into ? `${from.name} (${from.phone}) akan dilebur ke ${into.name}. Nomor lama tetap dikenali saat checkout.` : "Pilih pelanggan yang dipertahankan."}>
        {(list.data ?? [])
          .filter((r) => r.id !== from.id)
          .slice(0, 30)
          .map((r) => (
            <ListRow key={r.id} title={r.name} subtitle={r.phone} selected={into?.id === r.id} trailing={into?.id === r.id ? <Check className="size-5 text-tint" /> : undefined} onClick={() => setInto(r)} />
          ))}
      </ListSection>
      <Button size="lg" variant="destructive" block disabled={!into || merge.isPending} onClick={() => into && merge.mutate({ intoId: into.id }, { onSuccess: () => (onClose(), navigate(`/pelanggan/${into.id}`, { replace: true })) })}>
        Gabungkan
      </Button>
    </Sheet>
  );
}
