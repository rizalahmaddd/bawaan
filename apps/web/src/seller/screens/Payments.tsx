import { formatRupiah } from "@bawaan/shared";
import { CheckCircle2, CreditCard } from "lucide-react";
import { useState } from "react";
import { errorMessage } from "../../lib/api";
import { fmtDateTime, fmtRelative, textToMinor } from "../../lib/format";
import { navigate } from "../../lib/router";
import { Button } from "../../ui/Button";
import { EmptyState, ErrorState, SkeletonRows } from "../../ui/Feedback";
import { Field, Input } from "../../ui/Form";
import { ListRow, ListSection } from "../../ui/List";
import { Pill } from "../../ui/Pill";
import { Segmented } from "../../ui/Segmented";
import { Sheet } from "../../ui/Sheet";
import { ReasonSheet } from "../common";
import { useTenant } from "../context";
import { useTenantAction, useTenantQuery } from "../hooks";
import { Screen } from "../Screen";

type PaymentRow = {
  id: string;
  amount: number;
  method: string;
  status: "pending" | "verified" | "rejected";
  rejectReason: string | null;
  proofKey: string | null;
  createdAt: number;
  customer: string;
  invoiceNumber: string | null;
  invoiceDue: number | null;
  orderId: string | null;
};

const METHOD: Record<string, string> = { transfer: "Transfer", qris: "QRIS", cash: "Tunai", saldo: "Saldo" };

export function Payments() {
  const t = useTenant();
  const [status, setStatus] = useState<PaymentRow["status"]>("pending");
  const q = useTenantQuery<PaymentRow[]>(["payments", status], `/payments?status=${status}`);
  const [verifying, setVerifying] = useState<PaymentRow | null>(null);
  const [rejecting, setRejecting] = useState<PaymentRow | null>(null);
  const reject = useTenantAction<{ id: string; reason: string }>("post", (i) => `/payments/${i.id}/reject`, "Bukti bayar ditolak");

  return (
    <Screen
      title="Pembayaran"
      accessory={
        <Segmented
          label="Status pembayaran"
          value={status}
          onChange={setStatus}
          options={[
            { value: "pending", label: "Perlu dicek" },
            { value: "verified", label: "Diterima" },
            { value: "rejected", label: "Ditolak" },
          ]}
        />
      }
    >
      {q.isPending && <SkeletonRows />}
      {q.isError && <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />}
      {q.data?.length === 0 && (
        <EmptyState
          icon={status === "pending" ? <CheckCircle2 /> : <CreditCard />}
          title={status === "pending" ? "Tidak ada bukti bayar baru" : "Belum ada data"}
          body={status === "pending" ? "Bukti transfer dari pelanggan muncul di sini untuk dicocokkan dengan mutasi." : undefined}
        />
      )}
      {status !== "pending" && !!q.data?.length && (
        <ListSection>
          {q.data.map((p) => (
            <ListRow
              key={p.id}
              title={`${p.customer} · ${formatRupiah(p.amount)}`}
              subtitle={`${METHOD[p.method] ?? p.method} · ${p.invoiceNumber ?? "tanpa tagihan"} · ${fmtDateTime(p.createdAt)}${p.rejectReason ? ` · ${p.rejectReason}` : ""}`}
              chevron={!!p.orderId}
              onClick={p.orderId ? () => navigate(`/pesanan/${p.orderId}`) : undefined}
            />
          ))}
        </ListSection>
      )}
      {status === "pending" &&
        q.data?.map((p) => {
          const matches = p.invoiceDue !== null && p.amount === p.invoiceDue;
          return (
            <section key={p.id} className="mb-6 overflow-hidden rounded-[var(--radius-card)] bg-elevated regular:grid regular:grid-cols-[minmax(0,280px)_1fr]">
              {p.proofKey ? (
                <a href={`${t.base}/files/${p.proofKey}`} target="_blank" rel="noopener" className="block bg-fill-4">
                  <img src={`${t.base}/files/${p.proofKey}`} alt={`Bukti transfer ${p.customer}`} className="max-h-[420px] w-full object-contain" loading="lazy" />
                </a>
              ) : (
                <div className="flex items-center justify-center bg-fill-4 p-8 text-label-2">Tanpa bukti</div>
              )}
              <div className="flex flex-col p-4">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-headline">{p.customer}</p>
                    <p className="text-subhead text-label-2">
                      {p.invoiceNumber ?? "Tanpa tagihan"} · {fmtRelative(p.createdAt)}
                    </p>
                  </div>
                  <Pill tone={matches ? "green" : "orange"}>{matches ? "Nominal cocok" : "Cek nominal"}</Pill>
                </div>
                <dl className="my-4 grid grid-cols-2 gap-3">
                  <div className="rounded-[14px] bg-fill-4 p-3">
                    <dt className="text-footnote text-label-2">Ditransfer</dt>
                    <dd className="text-title3 tabular">{formatRupiah(p.amount)}</dd>
                  </div>
                  <div className="rounded-[14px] bg-fill-4 p-3">
                    <dt className="text-footnote text-label-2">Tagihan</dt>
                    <dd className="text-title3 tabular">{p.invoiceDue !== null ? <UniqueAmount amount={p.invoiceDue} /> : "—"}</dd>
                  </div>
                </dl>
                <p className="mb-4 text-footnote text-label-2">Cocokkan 3 digit terakhir dengan mutasi rekening sebelum menerima.</p>
                {t.canMoney ? (
                  <div className="mt-auto flex gap-3">
                    <Button variant="destructive" className="flex-1" onClick={() => setRejecting(p)}>
                      Tolak
                    </Button>
                    <Button className="flex-1" onClick={() => setVerifying(p)}>
                      Terima
                    </Button>
                  </div>
                ) : (
                  <p className="text-footnote text-label-2">Hanya pemilik atau admin yang bisa menerima pembayaran.</p>
                )}
              </div>
            </section>
          );
        })}
      <VerifySheet payment={verifying} onClose={() => setVerifying(null)} />
      <ReasonSheet
        open={!!rejecting}
        onOpenChange={(o) => !o && setRejecting(null)}
        title="Tolak bukti bayar"
        hint="Alasan ditampilkan ke pelanggan, misalnya: dana belum masuk ke rekening."
        confirmLabel="Tolak"
        busy={reject.isPending}
        onSubmit={(reason) => reject.mutate({ id: rejecting!.id, reason }, { onSuccess: () => setRejecting(null) })}
      />
    </Screen>
  );
}

/** Highlights the last three digits, which carry the unique code. */
function UniqueAmount({ amount }: { amount: number }) {
  const s = formatRupiah(amount);
  return (
    <>
      {s.slice(0, -3)}
      <mark className="rounded bg-[color-mix(in_srgb,var(--orange)_25%,transparent)] px-0.5 text-label">{s.slice(-3)}</mark>
    </>
  );
}

function VerifySheet({ payment, onClose }: { payment: PaymentRow | null; onClose: () => void }) {
  const [amount, setAmount] = useState("");
  const verify = useTenantAction<{ id: string; body: { amount?: number } }>("post", (i) => `/payments/${i.id}/verify`, "Pembayaran diterima");
  const value = amount.trim() ? textToMinor(amount, 0) : undefined;
  return (
    <Sheet open={!!payment} onOpenChange={(o) => !o && onClose()} title="Terima pembayaran" detents={["medium"]}>
      {payment && (
        <form
          key={payment.id}
          onSubmit={(e) => {
            e.preventDefault();
            verify.mutate({ id: payment.id, body: { amount: value } }, { onSuccess: () => (setAmount(""), onClose()) });
          }}
        >
          <ListSection footer="Isi kalau uang yang masuk di mutasi berbeda dari yang dilaporkan. Kelebihan bayar masuk ke saldo pelanggan.">
            <Field label="Uang masuk (Rp)">{(id) => <Input id={id} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={String(payment.amount)} inputMode="numeric" />}</Field>
          </ListSection>
          <Button type="submit" size="lg" block disabled={verify.isPending || (value !== undefined && !(value > 0))}>
            Terima {formatRupiah(value ?? payment.amount)}
          </Button>
        </form>
      )}
    </Sheet>
  );
}
