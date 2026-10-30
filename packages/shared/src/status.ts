export type ItemStatus =
  | "requested"
  | "awaiting_dp"
  | "hunting"
  | "needs_approval"
  | "obtained"
  | "partial"
  | "unavailable"
  | "cancelled"
  | "forfeited";

export type ShipmentStatus =
  | "preparing"
  | "handed_to_forwarder"
  | "departed"
  | "in_transit"
  | "arrived_id"
  | "customs"
  | "customs_cleared"
  | "at_seller"
  | "delayed"
  | "held_by_customs";

export type DeliveryStatus = "packed" | "shipped" | "delivered" | "picked_up";
export type InvoiceStatus = "open" | "partially_paid" | "paid" | "void" | "expired";
export type Tone = "green" | "orange" | "red" | "blue" | "indigo" | "gray";

export const ITEM_LABEL: Record<ItemStatus, { label: string; tone: Tone }> = {
  requested: { label: "Menunggu konfirmasi", tone: "gray" },
  awaiting_dp: { label: "Menunggu DP", tone: "orange" },
  hunting: { label: "Sedang dicari", tone: "blue" },
  needs_approval: { label: "Butuh persetujuanmu", tone: "orange" },
  obtained: { label: "Dapat", tone: "green" },
  partial: { label: "Dapat sebagian", tone: "indigo" },
  unavailable: { label: "Tidak dapat", tone: "red" },
  cancelled: { label: "Dibatalkan", tone: "gray" },
  forfeited: { label: "Hangus", tone: "red" },
};

export const SHIPMENT_FLOW: ShipmentStatus[] = [
  "preparing",
  "handed_to_forwarder",
  "departed",
  "in_transit",
  "arrived_id",
  "customs",
  "customs_cleared",
  "at_seller",
];

export const SHIPMENT_LABEL: Record<ShipmentStatus, { label: string; tone: Tone }> = {
  preparing: { label: "Dikemas di luar negeri", tone: "gray" },
  handed_to_forwarder: { label: "Diserahkan ke forwarder", tone: "blue" },
  departed: { label: "Berangkat", tone: "blue" },
  in_transit: { label: "Di perjalanan", tone: "blue" },
  arrived_id: { label: "Tiba di Indonesia", tone: "indigo" },
  customs: { label: "Proses bea cukai", tone: "orange" },
  customs_cleared: { label: "Lolos bea cukai", tone: "indigo" },
  at_seller: { label: "Di gudang seller", tone: "green" },
  delayed: { label: "Terlambat", tone: "orange" },
  held_by_customs: { label: "Ditahan bea cukai", tone: "red" },
};

export const DELIVERY_LABEL: Record<DeliveryStatus, { label: string; tone: Tone }> = {
  packed: { label: "Dikemas", tone: "gray" },
  shipped: { label: "Dikirim", tone: "blue" },
  delivered: { label: "Diterima", tone: "green" },
  picked_up: { label: "Diambil", tone: "green" },
};

export const INVOICE_LABEL: Record<InvoiceStatus, { label: string; tone: Tone }> = {
  open: { label: "Belum dibayar", tone: "orange" },
  partially_paid: { label: "Dibayar sebagian", tone: "indigo" },
  paid: { label: "Lunas", tone: "green" },
  void: { label: "Dibatalkan", tone: "gray" },
  expired: { label: "Kedaluwarsa", tone: "red" },
};

export const INVOICE_TYPE_LABEL = {
  dp: "DP",
  full: "Pembayaran penuh",
  settlement: "Pelunasan",
  domestic: "Ongkir",
  adjustment: "Penyesuaian",
  cargo: "Ongkir kargo",
  combined: "Tagihan gabungan",
} as const;

/** Items the seller still has to act on before a settlement invoice can be issued. */
export const UNDECIDED: ItemStatus[] = ["requested", "awaiting_dp", "hunting", "needs_approval"];
export const DECIDED_WITH_GOODS: ItemStatus[] = ["obtained", "partial"];
