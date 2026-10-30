import type { DeliveryStatus, InvoiceStatus, ItemStatus, Policy, ShipmentStatus } from "@bawaan/shared";

export type Me = {
  user: { id: string; email: string; name: string; avatarUrl: string | null } | null;
  tenants: Array<{ id: string; slug: string; name: string; role: "owner" | "admin" | "staff"; tintColor: string | null; plan: string; grants: { money?: boolean; reports?: boolean } }>;
  googleEnabled: boolean;
  appleEnabled: boolean;
  platformAdmin?: boolean;
  devLogin: boolean;
};

export type InvoiceLine = { label: string; qty?: number; unit?: number; amount: number };
export type Invoice = {
  id: string;
  number: string;
  type: "dp" | "full" | "settlement" | "domestic" | "adjustment" | "cargo" | "combined";
  amount: number;
  uniqueCode: number;
  paid: number;
  remaining: number;
  status: InvoiceStatus;
  dueAt: number | null;
  lines: InvoiceLine[];
  note: string | null;
  combinedInto: string | null;
  createdAt: number;
};

export type OrderItem = {
  id: string;
  title: string;
  variant: string | null;
  link: string | null;
  note: string | null;
  qty: number;
  qtyObtained: number | null;
  priceMinor: number | null;
  actualPriceMinor: number | null;
  maxPriceMinor: number | null;
  currency: string;
  unitPrice: number | null;
  fee: number;
  onUnavailable: "refund" | "substitute" | "ask";
  status: ItemStatus;
  approvalNote: string | null;
  approvalDeadline: number | null;
  photoKey: string | null;
  receiptKey: string | null;
  shipmentId: string | null;
  deliveryId: string | null;
  decidedAt: number | null;
};

export type Shipment = { id: string; name: string; status: ShipmentStatus; etaAt: number | null; forwarder: string | null; awb: string | null; updatedAt: number };
export type Delivery = { id: string; courier: string | null; resi: string | null; cost: number; status: DeliveryStatus; shippedAt: number | null; deliveredAt: number | null };
export type TimelineEvent = { id: string; entityType: string; entityId: string; status: string; message: string | null; photoKey: string | null; createdAt: number };
export type Payment = { id: string; invoiceId: string | null; amount: number; method: string; status: "pending" | "verified" | "rejected"; rejectReason: string | null; proofKey: string | null; createdAt: number };

export type OrderView = {
  order: { id: string; code: string; status: "requested" | "active" | "completed" | "cancelled" | "rejected"; notes: string | null; createdAt: number; confirmedAt: number | null; closeReason: string | null; holdForCombine: boolean };
  trip: { id: string; title: string; country: string; currency: string; kursMicro: number; closesAt: number; etaAt: number | null; dpPercent: number } | null;
  customer: { id: string; name: string; phone: string; balance: number; notes: string | null; linked: boolean } | null;
  address: { recipient: string; phone: string; line: string; city: string; province: string | null; postalCode: string | null } | null;
  items: OrderItem[];
  invoices: Invoice[];
  payments: Payment[];
  shipments: Shipment[];
  deliveries: Delivery[];
  events: TimelineEvent[];
};

export type SellerOrder = OrderView & { trackingUrl: string };

export type Bank = { id?: string; bank: string; number: string; holder: string; qrisKey: string | null };

export type CustomerOrderView = Omit<OrderView, "customer"> & {
  customer: { name: string; balance: number; linked: boolean } | null;
  store: { name: string; waNumber: string; policyText: string };
  banks: Bank[];
  notifications: Array<{ title: string; body: string; createdAt: number }>;
  vapidPublicKey: string | null;
  qris: boolean;
};

export type Trip = {
  id: string;
  title: string;
  country: string;
  currency: string;
  kursMicro: number;
  kursLock: "confirm" | "settle";
  rounding: number;
  defaultFee: number;
  dpPercent: number;
  closesAt: number;
  etaAt: number | null;
  mode: "hand_carry" | "cargo" | "mixed";
  kind: "po" | "ready";
  status: "draft" | "open" | "closed" | "done";
  note: string | null;
  cargoRatePerKg: number | null;
  cargoRoundG: number;
  cargoMinIdr: number;
  actualKursMicro: number | null;
  orderCount?: number;
  productCount?: number;
};

export type Product = {
  id: string;
  title: string;
  description: string | null;
  priceMinor: number;
  fee: number;
  estWeightG: number | null;
  quota: number | null;
  reserved: number;
  photoKey: string | null;
  variants: string[];
  status: "active" | "hidden" | "sold_out";
};

export type Settings = {
  tenant: {
    id: string;
    slug: string;
    name: string;
    waNumber: string;
    tintColor: string | null;
    logoKey: string | null;
    plan: "free" | "pro";
    planUntil: number | null;
    status: "active" | "readonly" | "suspended" | "deleted";
    statusReason: string | null;
    deletedAt: number | null;
    slugChangedAt: number | null;
    customDomain: string | null;
  };
  policy: Policy;
  banks: Bank[];
  members: Array<{ userId: string; name: string; email: string; role: string }>;
  storeUrl: string;
  vapidPublicKey: string | null;
};

export const media = (key: string | null | undefined) => (key ? `/media/${key}` : null);
