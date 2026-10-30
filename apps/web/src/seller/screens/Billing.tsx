import { PLAN_LABEL, formatRupiah, qrisMerchantName, qrisWithAmount, waLink } from "@bawaan/shared";
import { Check, Crown, MessageCircle } from "lucide-react";
import qrcode from "qrcode-generator";
import { useMemo, useState } from "react";
import { errorMessage } from "../../lib/api";
import { fmtDate } from "../../lib/format";
import { useLocation } from "../../lib/router";
import { Button, LinkButton } from "../../ui/Button";
import { ErrorState, SkeletonRows } from "../../ui/Feedback";
import { PhotoPicker } from "../../ui/Form";
import { ListRow, ListSection } from "../../ui/List";
import { Pill } from "../../ui/Pill";
import { Segmented } from "../../ui/Segmented";
import { useUpload } from "../common";
import { useTenant } from "../context";
import { useTenantAction, useTenantQuery } from "../hooks";
import { Screen } from "../Screen";

type PlatformInvoice = { id: string; months: number; amount: number; status: "open" | "pending_review" | "paid" | "void"; gatewayUrl: string | null; createdAt: number; paidAt: number | null };
type BillingData = {
  plan: "free" | "pro";
  planUntil: number | null;
  limits: { activeTrips: number | null; itemsPerMonth: number | null; staff: number; branding: boolean; customDomain: boolean };
  used: { activeTrips: number; itemsThisMonth: number; staff: number };
  warn: boolean;
  invoices: PlatformInvoice[];
  options: Array<{ months: number; amount: number }>;
  gateway: boolean;
  customDomain: boolean;
  manualTransfer: string;
  supportWa: string | null;
  qris: string | null;
};

const STATUS: Record<PlatformInvoice["status"], { label: string; tone: "orange" | "indigo" | "green" | "gray" }> = {
  open: { label: "Belum dibayar", tone: "orange" },
  pending_review: { label: "Sedang dicek", tone: "indigo" },
  paid: { label: "Lunas", tone: "green" },
  void: { label: "Batal", tone: "gray" },
};

const PRO_PERKS = ["Trip aktif tanpa batas", "Pesanan tanpa batas per bulan", "Sampai 5 staf/admin", "Tanpa tulisan “Dibuat dengan Bawaan”", "Domain sendiri (toko.namamu.com)"];

export function Billing() {
  const t = useTenant();
  const { search } = useLocation();
  const q = useTenantQuery<BillingData>(["billing"], "/billing");
  const [months, setMonths] = useState("12");
  const checkout = useTenantAction<{ months: number }, { id: string; gatewayUrl: string | null }>("post", "/billing/checkout");
  const back = { label: "Pengaturan", to: "/pengaturan" };

  if (q.isPending) return <Screen title="Paket" back={back}><SkeletonRows /></Screen>;
  if (q.isError) return <Screen title="Paket" back={back}><ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} /></Screen>;
  const d = q.data;
  const option = d.options.find((o) => String(o.months) === months)!;
  const open = d.invoices.find((i) => i.status === "open");
  const usage = (used: number, limit: number | null) => (limit === null ? `${used}` : `${used} / ${limit}`);

  return (
    <Screen title="Paket" back={back}>
      {search.get("bayar") === "ok" && <p className="mb-4 rounded-[14px] bg-[color-mix(in_srgb,var(--green)_14%,transparent)] p-3 text-subhead text-green-text">Pembayaran diterima. Paket aktif dalam beberapa saat.</p>}
      <ListSection footer={d.plan === "pro" && d.planUntil ? `Aktif sampai ${fmtDate(d.planUntil)}. Perpanjang kapan saja, sisa waktunya tidak hilang.` : d.warn ? "Pemakaian bulan ini sudah lebih dari 80% batas paket Gratis." : undefined}>
        <ListRow icon={<Crown />} iconBg={d.plan === "pro" ? "var(--orange)" : "var(--gray)"} title={`Paket ${PLAN_LABEL[d.plan]}`} />
        <ListRow title="Trip aktif" value={usage(d.used.activeTrips, d.limits.activeTrips)} />
        <ListRow title="Barang dipesan bulan ini" value={usage(d.used.itemsThisMonth, d.limits.itemsPerMonth)} />
        <ListRow title="Staf & admin" value={`${d.used.staff} / ${d.limits.staff}`} />
      </ListSection>

      {t.role === "owner" && (
        <ListSection header={d.plan === "pro" ? "Perpanjang Pro" : "Upgrade ke Pro"}>
          <ul className="space-y-2 px-4 pt-4">
            {PRO_PERKS.filter((p) => d.customDomain || !p.startsWith("Domain")).map((p) => (
              <li key={p} className="flex items-start gap-2 text-subhead">
                <Check className="mt-0.5 size-4 shrink-0 text-green" /> {p}
              </li>
            ))}
          </ul>
          <div className="p-4">
            <Segmented
              label="Lama langganan"
              value={months}
              onChange={setMonths}
              options={d.options.map((o) => ({ value: String(o.months), label: o.months === 12 ? "1 tahun" : `${o.months} bulan` }))}
            />
            <p className="mt-3 text-center text-title3 tabular">
              {formatRupiah(option.amount)}
              {option.months === 12 && <span className="ml-2 text-footnote text-green-text">hemat 2 bulan</span>}
            </p>
            <Button
              block
              size="lg"
              className="mt-3"
              disabled={checkout.isPending}
              onClick={() => checkout.mutate({ months: option.months }, { onSuccess: (r) => r.gatewayUrl && location.assign(r.gatewayUrl) })}
            >
              {d.gateway ? "Bayar" : "Buat tagihan"}
            </Button>
          </div>
        </ListSection>
      )}

      {open && !open.gatewayUrl && <ManualProof invoice={open} hint={d.manualTransfer} qris={d.qris} />}

      {d.invoices.length > 0 && (
        <ListSection header="Riwayat tagihan">
          {d.invoices.map((i) => (
            <ListRow
              key={i.id}
              title={`Pro ${i.months} bulan · ${formatRupiah(i.amount)}`}
              subtitle={fmtDate(i.paidAt ?? i.createdAt)}
              trailing={
                i.status === "open" && i.gatewayUrl ? (
                  <LinkButton size="sm" href={i.gatewayUrl}>
                    Bayar
                  </LinkButton>
                ) : (
                  <Pill tone={STATUS[i.status].tone}>{STATUS[i.status].label}</Pill>
                )
              }
            />
          ))}
        </ListSection>
      )}

      {d.supportWa && (
        <ListSection footer="Tanya soal paket, pembayaran, atau kendala aplikasi.">
          <ListRow
            icon={<MessageCircle />}
            iconBg="var(--green)"
            title="Chat support Bawaan"
            subtitle={`WhatsApp ${localPhone(d.supportWa)}`}
            href={waLink(d.supportWa, `Halo Bawaan, saya dari toko ${t.name} (${t.slug}).`)}
            chevron
          />
        </ListSection>
      )}
    </Screen>
  );
}

/** +6285777775477 → 0857-7777-5477 */
function localPhone(e164: string) {
  const local = e164.replace(/^\+62/, "0");
  return [local.slice(0, 4), local.slice(4, 8), local.slice(8)].filter(Boolean).join("-");
}

function ManualProof({ invoice, hint, qris }: { invoice: PlatformInvoice; hint: string; qris: string | null }) {
  const up = useUpload();
  const svg = useMemo(() => {
    if (!qris) return null;
    try {
      const q = qrcode(0, "M");
      q.addData(qrisWithAmount(qris, invoice.amount));
      q.make();
      return q.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
    } catch {
      return null;
    }
  }, [qris, invoice.amount]);
  const send = useTenantAction<{ proofKey: string }>("post", `/billing/${invoice.id}/proof`, "Bukti terkirim, kami cek secepatnya");
  return (
    <ListSection header={`Tagihan ${formatRupiah(invoice.amount)}`} footer={hint}>
      {svg && (
        <div className="flex flex-col items-center gap-2 border-b-[0.5px] border-separator p-4">
          <div className="w-full max-w-[260px] rounded-[16px] bg-white p-3 [&_svg]:h-auto [&_svg]:w-full" role="img" aria-label="Kode QRIS" dangerouslySetInnerHTML={{ __html: svg }} />
          <p className="text-title3 tabular">{formatRupiah(invoice.amount)}</p>
          <p className="text-footnote text-label-2">QRIS a.n. {qrisMerchantName(qris!) ?? "Bawaan"}</p>
        </div>
      )}
      <div className="flex items-center gap-4 p-4">
        <PhotoPicker
          label="Bukti transfer"
          busy={up.busy || send.isPending}
          onPick={async (f) => {
            const key = await up.upload(f, "billing");
            if (key) send.mutate({ proofKey: key });
          }}
        />
        <span className="text-subhead text-label-2">{svg ? "Unggah bukti bayar" : "Unggah bukti transfer"}</span>
      </div>
    </ListSection>
  );
}
