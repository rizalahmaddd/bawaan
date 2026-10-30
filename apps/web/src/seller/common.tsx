import { DELIVERY_LABEL, INVOICE_LABEL, ITEM_LABEL, SHIPMENT_LABEL, type DeliveryStatus, type InvoiceStatus, type ItemStatus, type ShipmentStatus } from "@bawaan/shared";
import { useState, type ReactNode } from "react";
import { ApiError, api, errorMessage } from "../lib/api";
import { compressImage } from "../lib/image";
import { Button } from "../ui/Button";
import { useHud } from "../ui/Feedback";
import { TextArea } from "../ui/Form";
import { ListSection } from "../ui/List";
import { Pill } from "../ui/Pill";
import { Sheet } from "../ui/Sheet";
import { useTenant } from "./context";

export const ItemPill = ({ status, customer }: { status: ItemStatus; customer?: boolean }) => (
  <Pill tone={ITEM_LABEL[status].tone}>{status === "needs_approval" && !customer ? "Menunggu pelanggan" : ITEM_LABEL[status].label}</Pill>
);
export const InvoicePill = ({ status }: { status: InvoiceStatus }) => <Pill tone={INVOICE_LABEL[status].tone}>{INVOICE_LABEL[status].label}</Pill>;
export const ShipmentPill = ({ status }: { status: ShipmentStatus }) => <Pill tone={SHIPMENT_LABEL[status].tone}>{SHIPMENT_LABEL[status].label}</Pill>;
export const DeliveryPill = ({ status }: { status: DeliveryStatus }) => <Pill tone={DELIVERY_LABEL[status].tone}>{DELIVERY_LABEL[status].label}</Pill>;

export const ORDER_STATUS: Record<string, { label: string; tone: "gray" | "blue" | "green" | "red" | "orange" }> = {
  requested: { label: "Baru", tone: "orange" },
  active: { label: "Berjalan", tone: "blue" },
  completed: { label: "Selesai", tone: "green" },
  cancelled: { label: "Dibatalkan", tone: "gray" },
  rejected: { label: "Ditolak", tone: "red" },
};

export function useUpload() {
  const t = useTenant();
  const hud = useHud();
  const [busy, setBusy] = useState(false);
  async function upload(file: File, kind: "product" | "item" | "receipt" | "logo" | "qris" | "billing", opts: { quiet?: boolean } = {}): Promise<string | undefined> {
    setBusy(true);
    try {
      const form = new FormData();
      form.set("kind", kind);
      form.set("file", await compressImage(file));
      return (await api.form<{ key: string }>(`${t.base}/uploads`, form)).key;
    } catch (e) {
      if (!(opts.quiet && e instanceof ApiError && e.status === 0)) hud(errorMessage(e), "error");
      return undefined;
    } finally {
      setBusy(false);
    }
  }
  return { upload, busy };
}

/** Sheet that asks for a short reason before a destructive or audited action. */
export function ReasonSheet({ open, onOpenChange, title, hint, confirmLabel, busy, onSubmit }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  hint?: ReactNode;
  confirmLabel: string;
  busy?: boolean;
  onSubmit: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={title} detents={["medium"]}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(reason.trim());
        }}
      >
        <ListSection footer={hint}>
          <div className="px-4 py-2">
            <TextArea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Alasan" aria-label="Alasan" autoFocus maxLength={300} />
          </div>
        </ListSection>
        <Button type="submit" variant="destructive" block disabled={busy || reason.trim().length < 3}>
          {confirmLabel}
        </Button>
      </form>
    </Sheet>
  );
}

export function KeyValue({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-[var(--tap)] items-center gap-3 px-4 py-2 [&+&]:border-t-[0.5px] [&+&]:border-separator">
      <span className="flex-1 text-body">{label}</span>
      <span className="text-right text-body text-label-2 tabular">{children}</span>
    </div>
  );
}
