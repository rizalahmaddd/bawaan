import { PLAN_LABEL, formatRupiah } from "@bawaan/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Flag, Store } from "lucide-react";
import { useDeferredValue, useState } from "react";
import { api, errorMessage } from "../../lib/api";
import { fmtDate, fmtRelative } from "../../lib/format";
import { Button } from "../../ui/Button";
import { ask, ErrorState, SkeletonRows, useHud } from "../../ui/Feedback";
import { Field, Input, SearchField } from "../../ui/Form";
import { ListRow, ListSection } from "../../ui/List";
import { Pill } from "../../ui/Pill";
import { Segmented } from "../../ui/Segmented";
import { Sheet } from "../../ui/Sheet";
import { Screen } from "../Screen";

type AdminTenant = {
  id: string;
  slug: string;
  name: string;
  plan: string;
  planUntil: number | null;
  effectivePlan: "free" | "pro";
  status: string;
  statusReason: string | null;
  createdAt: number;
  orders: number;
  owner: string | null;
};
type Overview = {
  tenants: AdminTenant[];
  reports: Array<{ id: string; tenantId: string; slug: string; name: string; reason: string; contact: string | null; createdAt: number }>;
  pendingPayments: Array<{ id: string; slug: string; name: string; months: number; amount: number; proofKey: string | null; createdAt: number }>;
};

const STATUS_TONE: Record<string, "green" | "orange" | "red" | "gray"> = { active: "green", readonly: "orange", suspended: "red", deleted: "gray" };

/** For the Bawaan team: plans, manual Pro payments, abuse reports, and the suspend switch. */
export function Admin() {
  const qc = useQueryClient();
  const hud = useHud();
  const [term, setTerm] = useState("");
  const q = useDeferredValue(term.trim());
  const ov = useQuery({ queryKey: ["admin", q], queryFn: ({ signal }) => api.get<Overview>(`/api/admin/overview?q=${encodeURIComponent(q)}`, signal) });
  const act = useMutation({
    mutationFn: ({ path, body, method = "POST" }: { path: string; body?: unknown; method?: "POST" | "PATCH" }) => (method === "PATCH" ? api.patch(path, body) : api.post(path, body)),
    onSuccess: () => (qc.invalidateQueries({ queryKey: ["admin"] }), hud("Tersimpan")),
    onError: (e) => hud(errorMessage(e), "error"),
  });
  const [editing, setEditing] = useState<AdminTenant | null>(null);
  const back = { label: "Pengaturan", to: "/pengaturan" };

  return (
    <Screen title="Platform admin" back={back} accessory={<SearchField value={term} onChange={setTerm} placeholder="Cari toko" />}>
      {ov.isPending && <SkeletonRows rows={6} />}
      {ov.isError && <ErrorState message={errorMessage(ov.error)} onRetry={() => ov.refetch()} />}
      {ov.data && (
        <>
          {ov.data.pendingPayments.length > 0 && (
            <ListSection header="Pembayaran Pro menunggu cek">
              {ov.data.pendingPayments.map((p) => (
                <div key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-3 [&+&]:border-t-[0.5px] [&+&]:border-separator">
                  <div className="min-w-0 flex-1">
                    <p className="text-body">{p.name} · Pro {p.months} bulan</p>
                    <p className="text-subhead text-label-2">{formatRupiah(p.amount)} · {fmtRelative(p.createdAt)}</p>
                  </div>
                  {p.proofKey && (
                    <a className="text-subhead text-tint-text" href={`/api/admin/files/${p.proofKey}`} target="_blank" rel="noopener noreferrer">
                      Lihat bukti
                    </a>
                  )}
                  <Button size="sm" variant="gray" onClick={() => act.mutate({ path: `/api/admin/platform-invoices/${p.id}/reject` })}>
                    Tolak
                  </Button>
                  <Button size="sm" onClick={async () => (await ask(`Aktifkan Pro ${p.months} bulan untuk ${p.name}?`, { action: "Aktifkan" })) && act.mutate({ path: `/api/admin/platform-invoices/${p.id}/approve` })}>
                    Terima
                  </Button>
                </div>
              ))}
            </ListSection>
          )}

          {ov.data.reports.length > 0 && (
            <ListSection header="Laporan penyalahgunaan">
              {ov.data.reports.map((r) => (
                <div key={r.id} className="flex items-start gap-3 px-4 py-3 [&+&]:border-t-[0.5px] [&+&]:border-separator">
                  <Flag className="mt-1 size-5 shrink-0 text-red" />
                  <div className="min-w-0 flex-1">
                    <p className="text-body">{r.name} ({r.slug})</p>
                    <p className="text-subhead text-label-2">{r.reason}</p>
                    <p className="text-footnote text-label-2">{[r.contact, fmtRelative(r.createdAt)].filter(Boolean).join(" · ")}</p>
                  </div>
                  <Button size="sm" variant="gray" onClick={() => act.mutate({ path: `/api/admin/reports/${r.id}/resolve` })}>
                    Selesai
                  </Button>
                </div>
              ))}
            </ListSection>
          )}

          <ListSection header={`Toko · ${ov.data.tenants.length}`}>
            {ov.data.tenants.map((t) => (
              <ListRow
                key={t.id}
                icon={<Store />}
                iconBg={t.effectivePlan === "pro" ? "var(--orange)" : "var(--gray)"}
                title={`${t.name} · ${t.slug}`}
                subtitle={`${t.owner ?? "—"} · ${t.orders} pesanan · sejak ${fmtDate(t.createdAt)}`}
                trailing={<Pill tone={STATUS_TONE[t.status] ?? "gray"}>{t.status === "active" ? PLAN_LABEL[t.effectivePlan] : t.status}</Pill>}
                chevron={t.status !== "deleted"}
                onClick={t.status !== "deleted" ? () => setEditing(t) : undefined}
              />
            ))}
          </ListSection>
        </>
      )}
      {editing && <TenantSheet t={editing} busy={act.isPending} onSave={(body) => act.mutate({ path: `/api/admin/tenants/${editing.id}`, method: "PATCH", body }, { onSuccess: () => setEditing(null) })} onClose={() => setEditing(null)} />}
    </Screen>
  );
}

function TenantSheet({ t, busy, onSave, onClose }: { t: AdminTenant; busy: boolean; onSave: (body: object) => void; onClose: () => void }) {
  const [status, setStatus] = useState(t.status === "suspended" ? "suspended" : t.status === "readonly" ? "readonly" : "active");
  const [reason, setReason] = useState(t.statusReason ?? "");
  const [plan, setPlan] = useState(t.effectivePlan);
  const [until, setUntil] = useState(t.planUntil ? new Date(t.planUntil).toISOString().slice(0, 10) : "");
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()} title={t.name} detents={["large"]}>
      <ListSection header="Status" footer={status === "suspended" ? "Toko dan semua link pelanggannya tidak bisa dibuka. Alasan terlihat oleh seller." : undefined}>
        <div className="p-4">
          <Segmented label="Status" value={status} onChange={setStatus} options={[{ value: "active", label: "Aktif" }, { value: "readonly", label: "Tutup" }, { value: "suspended", label: "Bekukan" }]} />
        </div>
        {status === "suspended" && <Field label="Alasan">{(id) => <Input id={id} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>}
      </ListSection>
      <ListSection header="Paket">
        <div className="p-4">
          <Segmented label="Paket" value={plan} onChange={setPlan} options={[{ value: "free", label: "Gratis" }, { value: "pro", label: "Pro" }]} />
        </div>
        {plan === "pro" && <Field label="Aktif sampai">{(id) => <Input id={id} type="date" value={until} onChange={(e) => setUntil(e.target.value)} />}</Field>}
      </ListSection>
      <Button
        size="lg"
        block
        disabled={busy || (status === "suspended" && reason.trim().length < 3)}
        onClick={() => onSave({ status, reason: status === "suspended" ? reason.trim() : null, plan, planUntil: plan === "pro" && until ? new Date(until).getTime() : null })}
      >
        Simpan
      </Button>
    </Sheet>
  );
}
