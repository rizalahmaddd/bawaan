import { sql } from "drizzle-orm";
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

// All timestamps are epoch milliseconds. Money is whole rupiah unless the column says *_minor.
const now = sql`(unixepoch() * 1000)`;
const createdAt = () => integer("created_at").notNull().default(now);

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  googleSub: text("google_sub").notNull().unique(),
  email: text("email").notNull(),
  name: text("name").notNull(),
  avatarUrl: text("avatar_url"),
  createdAt: createdAt(),
});

export const sessions = sqliteTable(
  "sessions",
  {
    idHash: text("id_hash").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    expiresAt: integer("expires_at").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("sessions_user").on(t.userId)],
);

/** OAuth state lives in D1 because the callback host (accounts.) can't read cookies set on app. */
export const oauthStates = sqliteTable("oauth_states", {
  state: text("state").primaryKey(),
  verifier: text("verifier").notNull(),
  returnTo: text("return_to").notNull(),
  /** Store slug when a customer signs in on their store's subdomain; null means the seller app. */
  target: text("target"),
  createdAt: createdAt(),
});

/** One-time codes that carry a signed-in user from accounts. to the host that will own the cookie. */
export const authHandoffs = sqliteTable("auth_handoffs", {
  codeHash: text("code_hash").primaryKey(),
  userId: text("user_id").notNull(),
  returnTo: text("return_to").notNull(),
  target: text("target"),
  expiresAt: integer("expires_at").notNull(),
});

export const tenants = sqliteTable("tenants", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  tintColor: text("tint_color"),
  logoKey: text("logo_key"),
  waNumber: text("wa_number").notNull(),
  timezone: text("timezone").notNull().default("Asia/Jakarta"),
  policyJson: text("policy_json").notNull(),
  plan: text("plan").notNull().default("free"),
  planUntil: integer("plan_until"),
  status: text("status").notNull().default("active"),
  statusReason: text("status_reason"),
  slugChangedAt: integer("slug_changed_at"),
  deletedAt: integer("deleted_at"),
  customDomain: text("custom_domain").unique(),
  customDomainId: text("custom_domain_id"),
  customDomainStatus: text("custom_domain_status"),
  /** AES-GCM sealed with APP_SECRET: payment gateway and WhatsApp Cloud API credentials. */
  integrationsSealed: text("integrations_sealed"),
  createdAt: createdAt(),
});

export const slugHistory = sqliteTable("slug_history", {
  slug: text("slug").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  releasedAt: integer("released_at").notNull(),
  redirectUntil: integer("redirect_until").notNull(),
  quarantineUntil: integer("quarantine_until").notNull(),
});

export const memberships = sqliteTable(
  "memberships",
  {
    tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["owner", "admin", "staff"] }).notNull(),
    /** Extra grants for staff, e.g. {"money":true} lets them verify payments. */
    permissions: text("permissions_json"),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.userId] }), index("memberships_user").on(t.userId)],
);

export const invites = sqliteTable(
  "invites",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role", { enum: ["owner", "admin", "staff"] }).notNull(),
    permissions: text("permissions_json"),
    tokenHash: text("token_hash").notNull().unique(),
    invitedBy: text("invited_by").notNull(),
    expiresAt: integer("expires_at").notNull(),
    acceptedAt: integer("accepted_at"),
    createdAt: createdAt(),
  },
  (t) => [index("invites_tenant").on(t.tenantId)],
);

export const bankAccounts = sqliteTable(
  "bank_accounts",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    bank: text("bank").notNull(),
    number: text("number").notNull(),
    holder: text("holder").notNull(),
    qrisKey: text("qris_key"),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    sort: integer("sort").notNull().default(0),
  },
  (t) => [index("bank_accounts_tenant").on(t.tenantId)],
);

export const customers = sqliteTable(
  "customers",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    phone: text("phone_e164").notNull(),
    name: text("name").notNull(),
    email: text("email"),
    notes: text("notes"),
    tags: text("tags"),
    balance: integer("balance_idr").notNull().default(0),
    /** Google account the customer linked from one of their order links. */
    userId: text("user_id"),
    mergedInto: text("merged_into"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("customers_tenant_phone").on(t.tenantId, t.phone),
    index("customers_tenant_name").on(t.tenantId, t.name),
    index("customers_user").on(t.userId),
  ],
);

export const addresses = sqliteTable(
  "addresses",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    customerId: text("customer_id").notNull().references(() => customers.id, { onDelete: "cascade" }),
    recipient: text("recipient").notNull(),
    phone: text("phone").notNull(),
    line: text("line").notNull(),
    city: text("city").notNull(),
    province: text("province"),
    postalCode: text("postal_code"),
    isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("addresses_customer").on(t.customerId)],
);

export const trips = sqliteTable(
  "trips",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    country: text("country").notNull(),
    currency: text("currency").notNull(),
    kursMicro: integer("kurs_micro").notNull(),
    kursLock: text("kurs_lock", { enum: ["confirm", "settle"] }).notNull().default("confirm"),
    rounding: integer("rounding").notNull().default(1000),
    defaultFee: integer("default_fee_idr").notNull().default(0),
    dpPercent: integer("dp_percent").notNull(),
    opensAt: integer("opens_at"),
    closesAt: integer("closes_at").notNull(),
    etaAt: integer("eta_at"),
    mode: text("mode", { enum: ["hand_carry", "cargo", "mixed"] }).notNull().default("cargo"),
    /** "ready" is the store's always-open ready-stock shelf: goods already in hand, paid in full. */
    kind: text("kind", { enum: ["po", "ready"] }).notNull().default("po"),
    status: text("status", { enum: ["draft", "open", "closed", "done"] }).notNull().default("draft"),
    note: text("note"),
    cargoRatePerKg: integer("cargo_rate_idr_per_kg"),
    cargoRoundG: integer("cargo_round_g").notNull().default(100),
    cargoMinIdr: integer("cargo_min_idr").notNull().default(0),
    /** What the seller really paid per unit when changing money; only feeds the kurs gain/loss report. */
    actualKursMicro: integer("actual_kurs_micro"),
    createdAt: createdAt(),
  },
  (t) => [index("trips_tenant_status").on(t.tenantId, t.status)],
);

export const products = sqliteTable(
  "products",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    tripId: text("trip_id").notNull().references(() => trips.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    priceMinor: integer("price_minor").notNull(),
    fee: integer("fee_idr").notNull().default(0),
    estWeightG: integer("est_weight_g"),
    quota: integer("quota"),
    reserved: integer("reserved").notNull().default(0),
    photoKey: text("photo_key"),
    variants: text("variants_json"),
    status: text("status", { enum: ["active", "hidden", "sold_out"] }).notNull().default("active"),
    sort: integer("sort").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index("products_trip").on(t.tripId, t.sort)],
);

export const orders = sqliteTable(
  "orders",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    code: text("code").notNull().unique(),
    tripId: text("trip_id").notNull().references(() => trips.id),
    customerId: text("customer_id").notNull().references(() => customers.id),
    status: text("status", { enum: ["requested", "active", "completed", "cancelled", "rejected"] }).notNull().default("requested"),
    addressId: text("address_id"),
    notes: text("notes"),
    holdForCombine: integer("hold_for_combine", { mode: "boolean" }).notNull().default(false),
    tokenVersion: integer("token_version").notNull().default(1),
    createdAt: createdAt(),
    confirmedAt: integer("confirmed_at"),
    closedAt: integer("closed_at"),
    closeReason: text("close_reason"),
  },
  (t) => [index("orders_tenant_status").on(t.tenantId, t.status, t.createdAt), index("orders_customer").on(t.customerId)],
);

export const ITEM_STATUSES = [
  "requested",
  "awaiting_dp",
  "hunting",
  "needs_approval",
  "obtained",
  "partial",
  "unavailable",
  "cancelled",
  "forfeited",
] as const;

export const orderItems = sqliteTable(
  "order_items",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    orderId: text("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
    productId: text("product_id"),
    title: text("title").notNull(),
    variant: text("variant"),
    link: text("link"),
    note: text("note"),
    qty: integer("qty").notNull(),
    qtyObtained: integer("qty_obtained"),
    priceMinor: integer("price_minor"),
    currency: text("currency").notNull(),
    kursMicro: integer("kurs_micro"),
    fee: integer("fee_idr").notNull().default(0),
    unitPrice: integer("unit_price_idr"),
    actualPriceMinor: integer("actual_price_minor"),
    maxPriceMinor: integer("max_price_minor"),
    onUnavailable: text("on_unavailable", { enum: ["refund", "substitute", "ask"] }).notNull().default("refund"),
    approvalNote: text("approval_note"),
    approvalDeadline: integer("approval_deadline"),
    status: text("status", { enum: ITEM_STATUSES }).notNull().default("requested"),
    photoKey: text("photo_key"),
    receiptKey: text("receipt_key"),
    shipmentId: text("shipment_id"),
    deliveryId: text("delivery_id"),
    decidedAt: integer("decided_at"),
    decidedBy: text("decided_by"),
    createdAt: createdAt(),
  },
  (t) => [
    index("order_items_order").on(t.orderId),
    index("order_items_tenant_status").on(t.tenantId, t.status),
    index("order_items_shipment").on(t.shipmentId),
  ],
);

export const invoices = sqliteTable(
  "invoices",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    number: text("number").notNull(),
    customerId: text("customer_id").notNull(),
    orderId: text("order_id"),
    type: text("type", { enum: ["dp", "full", "settlement", "domestic", "adjustment", "cargo", "combined"] }).notNull(),
    amount: integer("amount_idr").notNull(),
    uniqueCode: integer("unique_code").notNull().default(0),
    paid: integer("paid_idr").notNull().default(0),
    dueAt: integer("due_at"),
    status: text("status", { enum: ["open", "partially_paid", "paid", "void", "expired"] }).notNull().default("open"),
    lines: text("lines_json").notNull(),
    note: text("note"),
    shipmentId: text("shipment_id"),
    /** Set on the invoices a combined invoice took over; they're paid through it. */
    combinedInto: text("combined_into"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("invoices_tenant_number").on(t.tenantId, t.number),
    index("invoices_combined").on(t.combinedInto),
    index("invoices_shipment").on(t.shipmentId),
    index("invoices_tenant_status").on(t.tenantId, t.status, t.dueAt),
    index("invoices_order").on(t.orderId),
    index("invoices_customer").on(t.customerId),
  ],
);

export const payments = sqliteTable(
  "payments",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    customerId: text("customer_id").notNull(),
    invoiceId: text("invoice_id"),
    amount: integer("amount_idr").notNull(),
    method: text("method", { enum: ["transfer", "qris", "cash", "saldo"] }).notNull(),
    proofKey: text("proof_key"),
    proofHash: text("proof_hash"),
    bankAccountId: text("bank_account_id"),
    paidAt: integer("paid_at"),
    status: text("status", { enum: ["pending", "verified", "rejected"] }).notNull().default("pending"),
    rejectReason: text("reject_reason"),
    verifiedBy: text("verified_by"),
    verifiedAt: integer("verified_at"),
    gatewayRef: text("gateway_ref").unique(),
    createdAt: createdAt(),
  },
  (t) => [index("payments_tenant_status").on(t.tenantId, t.status, t.createdAt), index("payments_customer").on(t.customerId)],
);

export const paymentAllocations = sqliteTable(
  "payment_allocations",
  {
    paymentId: text("payment_id").notNull(),
    invoiceId: text("invoice_id").notNull(),
    amount: integer("amount_idr").notNull(),
  },
  (t) => [primaryKey({ columns: [t.paymentId, t.invoiceId] }), index("allocations_invoice").on(t.invoiceId)],
);

export const ledgerEntries = sqliteTable(
  "ledger_entries",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    customerId: text("customer_id").notNull(),
    delta: integer("delta_idr").notNull(),
    reason: text("reason").notNull(),
    refType: text("ref_type"),
    refId: text("ref_id"),
    createdBy: text("created_by"),
    createdAt: createdAt(),
  },
  (t) => [index("ledger_customer").on(t.customerId, t.createdAt)],
);

export const SHIPMENT_STATUSES = [
  "preparing",
  "handed_to_forwarder",
  "departed",
  "in_transit",
  "arrived_id",
  "customs",
  "customs_cleared",
  "at_seller",
  "delayed",
  "held_by_customs",
] as const;

export const shipments = sqliteTable(
  "shipments",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    tripId: text("trip_id").notNull(),
    name: text("name").notNull(),
    forwarder: text("forwarder"),
    awb: text("awb"),
    status: text("status", { enum: SHIPMENT_STATUSES }).notNull().default("preparing"),
    etaAt: integer("eta_at"),
    costIdr: integer("cost_idr").notNull().default(0),
    dutyIdr: integer("duty_idr").notNull().default(0),
    dutyMode: text("duty_mode", { enum: ["pass", "absorb"] }).notNull().default("pass"),
    updatedAt: integer("updated_at").notNull().default(now),
    createdAt: createdAt(),
  },
  (t) => [index("shipments_tenant").on(t.tenantId, t.updatedAt)],
);

/** One customer's box inside a cargo batch: what the cargo invoice is billed from. */
export const parcels = sqliteTable(
  "parcels",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    shipmentId: text("shipment_id").notNull(),
    customerId: text("customer_id").notNull(),
    weightG: integer("weight_g").notNull(),
    lengthCm: integer("length_cm"),
    widthCm: integer("width_cm"),
    heightCm: integer("height_cm"),
    invoiceId: text("invoice_id"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("parcels_shipment_customer").on(t.shipmentId, t.customerId)],
);

export const deliveries = sqliteTable(
  "deliveries",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    customerId: text("customer_id").notNull(),
    addressSnapshot: text("address_snapshot"),
    courier: text("courier"),
    resi: text("resi"),
    cost: integer("cost_idr").notNull().default(0),
    status: text("status", { enum: ["packed", "shipped", "delivered", "picked_up"] }).notNull().default("packed"),
    shippedAt: integer("shipped_at"),
    deliveredAt: integer("delivered_at"),
    createdAt: createdAt(),
  },
  (t) => [index("deliveries_customer").on(t.customerId)],
);

export const statusEvents = sqliteTable(
  "status_events",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    entityType: text("entity_type", { enum: ["order", "item", "shipment", "delivery", "invoice", "payment"] }).notNull(),
    entityId: text("entity_id").notNull(),
    status: text("status").notNull(),
    message: text("message"),
    photoKey: text("photo_key"),
    visibility: text("visibility", { enum: ["public", "internal"] }).notNull().default("public"),
    actorId: text("actor_id"),
    createdAt: createdAt(),
  },
  (t) => [index("events_entity").on(t.entityType, t.entityId, t.createdAt)],
);

export const counters = sqliteTable(
  "counters",
  {
    tenantId: text("tenant_id").notNull(),
    name: text("name").notNull(),
    value: integer("value").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.name] })],
);

export const pushSubscriptions = sqliteTable(
  "push_subscriptions",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id"),
    audience: text("audience", { enum: ["seller", "customer"] }).notNull(),
    targetId: text("target_id").notNull(),
    endpoint: text("endpoint").notNull().unique(),
    createdAt: createdAt(),
  },
  (t) => [index("push_target").on(t.audience, t.targetId)],
);

/** Payload-less push: the service worker asks for the newest unseen row for its endpoint. */
export const notifications = sqliteTable(
  "notifications",
  {
    id: text("id").primaryKey(),
    audience: text("audience", { enum: ["seller", "customer"] }).notNull(),
    targetId: text("target_id").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    url: text("url").notNull(),
    seenAt: integer("seen_at"),
    createdAt: createdAt(),
  },
  (t) => [index("notifications_target").on(t.audience, t.targetId, t.createdAt)],
);

export const waitlist = sqliteTable(
  "waitlist",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    productId: text("product_id").notNull(),
    name: text("name").notNull(),
    phone: text("phone").notNull(),
    notifiedAt: integer("notified_at"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("waitlist_product_phone").on(t.productId, t.phone), index("waitlist_tenant").on(t.tenantId, t.createdAt)],
);

/** QRIS/VA charges created at the gateway, so the webhook can find what it's paying for. */
export const gatewayCharges = sqliteTable(
  "gateway_charges",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    invoiceId: text("invoice_id").notNull(),
    provider: text("provider").notNull(),
    externalId: text("external_id"),
    amount: integer("amount_idr").notNull(),
    payload: text("payload_json").notNull(),
    status: text("status", { enum: ["pending", "paid", "expired"] }).notNull().default("pending"),
    expiresAt: integer("expires_at").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("charges_invoice").on(t.invoiceId, t.status)],
);

/** Bawaan's own invoices to sellers for the Pro plan. */
export const platformInvoices = sqliteTable(
  "platform_invoices",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    months: integer("months").notNull(),
    amount: integer("amount_idr").notNull(),
    status: text("status", { enum: ["open", "pending_review", "paid", "void"] }).notNull().default("open"),
    proofKey: text("proof_key"),
    gatewayUrl: text("gateway_url"),
    gatewayRef: text("gateway_ref"),
    createdBy: text("created_by"),
    paidAt: integer("paid_at"),
    createdAt: createdAt(),
  },
  (t) => [index("platform_invoices_tenant").on(t.tenantId, t.createdAt), index("platform_invoices_status").on(t.status)],
);

export const abuseReports = sqliteTable(
  "abuse_reports",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    reason: text("reason").notNull(),
    contact: text("contact"),
    resolvedAt: integer("resolved_at"),
    createdAt: createdAt(),
  },
  (t) => [index("abuse_open").on(t.resolvedAt, t.createdAt)],
);

export const auditLog = sqliteTable(
  "audit_log",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    actorId: text("actor_id"),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    data: text("data_json"),
    createdAt: createdAt(),
  },
  (t) => [index("audit_tenant").on(t.tenantId, t.createdAt)],
);

export const idempotency = sqliteTable("idempotency", {
  key: text("key").primaryKey(),
  response: text("response_json").notNull(),
  createdAt: createdAt(),
});
