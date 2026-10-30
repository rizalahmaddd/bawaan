# Bawaan — SaaS for Jastip / PO Sellers

> Domain: `bawaan.my.id` · Infra: Cloudflare free tier · Sign-in: Google (Gmail) · Each seller gets `{store}.bawaan.my.id`
> UI language: Indonesian. UI style: iOS (Liquid Glass design language, iOS 26 → iOS 27), comfortable on mobile, tablet and desktop.

---

## 1. Problem

Source case (a jastip/PO seller asking for software):

> "Need software for a PO / overseas jastip seller… more accurate, more efficient. Customer database, invoices, customers can track whether their item was **obtained or not**, and **where the cargo is**. Customers shouldn't have to keep asking the admin about their order, and **no more Excel input**, because everything lives in the system."

Translated into requirements:

| # | Pain today | What Bawaan does |
|---|---|---|
| P1 | Customer data is scattered across chats & Excel | Customer CRM per store, auto-built from orders, one-time Excel/CSV import |
| P2 | Invoices are made manually | Auto invoices (DP, settlement, cargo shipping, adjustments), shareable link + printable/PDF |
| P3 | Customers ask "did you get my item?" | Per-item status: **Dapat / Tidak dapat / Sebagian / Butuh persetujuan**, with purchase photo & receipt |
| P4 | Customers ask "where is the cargo?" | Shipment batches with a timeline; one batch update reaches every customer in it |
| P5 | Admin answers the same questions all day | Self-service tracking page + proactive notifications (Web Push, WhatsApp click-to-chat) |
| P6 | Orders are typed into Excel from DMs | Customers order through the store page themselves; the seller only confirms |
| P7 | Hidden jastip problems (kurs, partial items, weight-based shipping, refunds, ghosting buyers) | Built-in flows & ledger, see §6 |

### Users
- **Seller (owner)** — registers with Google, owns a subdomain.
- **Staff/admin** — invited by the owner, limited roles.
- **Customer (buyer)** — no registration needed to order or track; access via magic link or order code + phone digits; optional Google sign-in from Phase 2.
- **Platform admin** — us: abuse handling, plans, support.

### Success metrics
- Seller time to publish first PO: < 10 minutes after sign-in.
- "Where's my order?" chats reduced (proxy: tracking page views per order ≥ 2, seller self-reported).
- Zero spreadsheet needed to run one full trip end to end.

---

## 2. Cloudflare free-tier architecture

```
                 ┌──────────────── Cloudflare (DNS, SSL, WAF, Turnstile) ───────────────┐
 bawaan.my.id ───┤                                                                       │
 app.bawaan…  ───┤   ONE Worker (Hono)  ── static assets (React SPA, free & unmetered)   │
 *.bawaan…    ───┤      │  hostname router: apex | app | accounts | cdn | {tenant}       │
                 │      ├── D1  (relational data, tenant_id on every row)                │
                 │      ├── R2  (product photos public, payment proofs private)          │
                 │      ├── KV  (hostname → tenant cache, rarely written)                │
                 │      └── Cron Triggers (reminders, overdue, backups, quota watch)     │
                 └───────────────────────────────────────────────────────────────────────┘
 External (free tiers): Google OAuth · Web Push (APNs/FCM via VAPID) · email deferred to Phase 3
```

### 2.1 Services and why

| Service | Use | Free limit to respect | Design consequence |
|---|---|---|---|
| Workers | API + HTML shell + routing | 100k requests/day, **10 ms CPU/request** | No SSR of React; no PDF rendering or image processing on the server |
| Workers Static Assets | SPA bundle, icons, fonts | Asset requests are free and don't count as Worker invocations | Storefront & tracking pages load even if the API quota is hit |
| D1 | All relational data | 5 M rows read/day, 100k rows written/day, **500 MB per DB**, 10 DBs, 5 GB total | Derived statuses (not fan-out writes), indexes on every filter, tenant sharding plan (§2.5) |
| R2 | Images & proofs | 10 GB, 1 M Class A, 10 M Class B ops/month | Client-side compression to WebP ≤ 200 KB, max 1600 px |
| KV | Hostname → tenant resolution cache | 100k reads, **1k writes/day** | Only write on tenant create/rename |
| Cron Triggers | Reminders, auto-expiry, backups | 5 triggers/account | One cron fanning out to jobs by minute/hour |
| Turnstile | Bot protection on public order & login forms | Free | Required on anonymous writes |
| D1 Time Travel | Point-in-time restore | 7 days on free | Plus weekly export to R2 |

Re-verify every limit on the Cloudflare pricing pages before launch; they change.

### 2.2 Domains & routing

- DNS: `bawaan.my.id` (nameservers moved from the `.my.id` registrar to Cloudflare), records:
  - `bawaan.my.id` and `*.bawaan.my.id` → proxied (AAAA `100::` placeholder), Worker routes `bawaan.my.id/*` and `*.bawaan.my.id/*`.
  - Universal SSL covers apex + one-level wildcard (`*.bawaan.my.id`) on free. **Never nest tenants** (`a.b.bawaan.my.id` is not covered).
- Hostname router inside the Worker:

| Host | Serves |
|---|---|
| `bawaan.my.id`, `www.` | Marketing landing, pricing, sign-up CTA |
| `app.bawaan.my.id` | Seller dashboard (all stores, store switcher) |
| `accounts.bawaan.my.id` | Google OAuth callback (Google forbids wildcard redirect URIs, so login is centralised here) |
| `cdn.bawaan.my.id` | Public R2 images (cached) |
| `{slug}.bawaan.my.id` | Tenant storefront, order form, tracking, invoices, customer portal |

- API is same-origin per host (`/api/*`) → no CORS, cookies stay host-only.
- Custom domains for tenants (`jastipku.com`) later via Cloudflare for SaaS (first 100 custom hostnames free) — Phase 3.

### 2.3 Rendering strategy (because of 10 ms CPU)
- SPA (React) served from static assets.
- For share links (WhatsApp/IG previews need real `<meta og:*>`), the Worker runs `HTMLRewriter` over `index.html` to inject title, description and `og:image` for store, product, trip and invoice URLs. Cheap, streaming, no React on the server.
- Invoice PDF: printable HTML + `@media print` (user taps Share → Print → Save PDF on iOS). No server PDF.

### 2.4 Stack

| Layer | Choice |
|---|---|
| Language | TypeScript everywhere |
| Backend | Hono on Workers, Zod validation, Drizzle ORM (D1 driver), migrations via Wrangler |
| Frontend | React 19 + Vite, TanStack Router + Query (from Phase 1), Tailwind CSS v4 with our own iOS design tokens, Radix primitives for a11y (dialog, popover, menu) |
| Offline/PWA | Service worker (Workbox), IndexedDB (Dexie) outbox for Shopping Mode |
| Client utils | `browser-image-compression` (WebP), SheetJS for Excel import (client-side), `libphonenumber-js` |
| Tests | Vitest + `@cloudflare/vitest-plugin` (Workers runtime), Playwright (WebKit iPhone/iPad/desktop Safari, Chromium desktop) |
| Repo | pnpm monorepo: `apps/web` (React SPA in `src/` + Worker in `worker/`, built together by `@cloudflare/vite-plugin`), `packages/shared` (schemas, money, slug, phone, host routing), `migrations/` |
| CI/CD | GitHub Actions → `wrangler deploy` (preview env on PR, prod on main) |

### 2.5 Multi-tenancy & the 500 MB D1 ceiling
- Phase 1: a single `core` D1 with `tenant_id` on every tenant table; every repository function takes `tenantId` as its first argument; a lint rule/test fails on raw queries without it.
- Keep rows lean: images/proofs in R2, long text capped, status events pruned to essentials.
- Sharding path: `tenants.db_shard` column + binding map (`DB_0` … `DB_9`) → up to 5 GB on free. Move a heavy tenant by export/import during a short read-only window.
- Upgrade trigger: when DB > 350 MB or daily writes > 60k for 3 days → Workers Paid ($5/mo, 10 GB per D1, 30 s CPU). Documented, not a surprise.

### 2.6 Free-tier write budget (why derived statuses matter)
A cargo batch with 200 items moving through 8 statuses must cost **8 writes**, not 1,600. Item tracking status is computed at read time from `order_items` + `shipment.status`. Same for "overdue" (computed from `due_at`), and counters shown in dashboards (aggregate queries, cached 60 s with Cache API).

Rough capacity on free: ~150–300 active sellers (each ~300 writes, ~15k reads/day). Monitor via Cloudflare GraphQL Analytics in a daily cron, Web Push alert to the platform admin at 70% usage.

---

## 3. Auth, onboarding & subdomains

### 3.1 Seller sign-in (Google)
1. `app.bawaan.my.id` → "Lanjutkan dengan Google".
2. OAuth 2.0 Authorization Code + PKCE, scopes `openid email profile` only (no Google verification review needed).
3. Callback on `accounts.bawaan.my.id` verifies the ID token with Google JWKS (cached in Cache API), upserts `users` by Google `sub` (not by email — emails can change).
4. Session: random 256-bit id stored hashed in D1 `sessions`; cookie `__Host-sid`, `Secure; HttpOnly; SameSite=Lax`, host-only on `app.bawaan.my.id`. 30-day sliding expiry.
5. State-changing requests require same-origin `Origin` header check (CSRF).

### 3.2 Onboarding (≤ 4 screens, iOS-style setup flow)
1. **Nama toko** → slug suggested live, availability check debounced (300 ms).
2. **Kontak & pembayaran**: WhatsApp number, bank accounts / QRIS image.
3. **Kebijakan default** (prefilled: DP 50%, settlement 3 days after "Dapat", DP forfeited if unpaid): DP %, settlement deadline, what happens to unpaid items, refund preference (saldo vs transfer), jastip fee model (flat / % / per item).
4. **Trip pertama** (optional, skippable): country, currency, open/close dates, kurs.
Ends on a "Toko kamu sudah online" screen with the link, copy button and Share sheet (`navigator.share`).

### 3.3 Subdomain rules
- `^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$` (3–30 chars), no `--`, no punycode/IDN.
- Reserved: `app, api, www, accounts, auth, admin, cdn, static, assets, mail, email, help, support, status, blog, docs, dev, staging, test, billing, pay, payment, invoice, toko, shop, jastip, bawaan, m, mobile, demo` + list grows (source of truth: `packages/shared/src/slug.ts`). `demo` is the platform's sample store.
- Blocked: bank/e-wallet/marketplace/brand names (`bca, mandiri, bri, bni, dana, ovo, gopay, shopee, tokopedia, …`) and profanity → anti-phishing.
- Rename: allowed once per 30 days; old slug redirects (301) for 90 days and stays quarantined 180 days.
- Deleted store: slug quarantined 180 days before anyone else can claim it.
- Unknown subdomain: friendly "Toko ini belum ada" page with "Buat toko dengan nama ini" CTA.

### 3.4 Staff & ownership
- Roles: `owner` (billing, delete store, roles), `admin` (everything else), `staff` (orders, shopping mode, shipments; **cannot** verify payments or issue refunds unless granted).
- Invite by email → staff signs in with Google using that email.
- Owner must be able to add a second owner (recovery if the Google account is lost). Ownership transfer requires confirmation from both.

### 3.5 Customer identity (no forced sign-up)
- Ordering: name + WhatsApp number (+ optional email). Phone normalised to E.164 (`08…`, `+62…`, `62…` → `+62…`) — this is the customer key per store.
- Tracking access, any of:
  - Signed magic link `/{order-code}?t=…` (sent in confirmations; HMAC, scoped to one order, rotatable).
  - Order code + last 4 digits of phone (rate-limited, Turnstile).
  - Phase 2: optional "Masuk dengan Google" on the tenant subdomain → OAuth on `accounts.` → one-time code handed back to `{slug}.bawaan.my.id/auth/finish` → host-only cookie there. Links all orders whose phone/email matches after a one-time WhatsApp-verified link confirmation.
- Sign in with Apple considered for Phase 3 (needs Apple Developer membership).

---

## 4. Domain model

### 4.1 Core concepts
- **Trip (sesi PO)** — e.g. "Jastip Jepang Nov 2026": country, currency, kurs, open/close window, ETA, fee rules, mode (`hand_carry` | `cargo` | `mixed`).
- **Product** — catalog item in a trip (photos, variants, foreign price, quota, est. weight). Customers can also submit a **Request item** (link/photo, notes, max price).
- **Order** — one customer × one trip; contains order items.
- **Order item** — snapshot of product/variant/price/kurs at confirmation, `qty`, `qty_obtained`, preferences.
- **Invoice** — DP, settlement, cargo shipping, domestic shipping, adjustment, refund note.
- **Payment** — a transfer with proof, verified by seller, allocated to one or more invoices.
- **Customer ledger (saldo)** — credits (refunds, overpayment) and debits (used on invoices). Source of truth for money owed either way.
- **Shipment (batch kargo)** — international leg; groups order items; weight, forwarder, AWB, cost.
- **Delivery (kirim lokal)** — domestic leg per customer; courier + resi; may combine items from several trips.
- **Status event** — timeline entries with visibility `public` or `internal`, optional photo.

### 4.2 Tables (D1)

```
users(id, google_sub UNIQUE, email, name, avatar_url, created_at)
sessions(id_hash PK, user_id, host, expires_at, created_at, ua_hint)
tenants(id, slug UNIQUE, name, tint_color, logo_key, wa_number, timezone, currency_default,
        policy_json, plan, db_shard, status[active|readonly|suspended|deleted], created_at)
slug_history(slug PK, tenant_id, released_at, quarantine_until)
memberships(tenant_id, user_id, role, permissions_json, PK(tenant_id,user_id))
bank_accounts(id, tenant_id, bank, number, holder, qris_key, active)

customers(id, tenant_id, phone_e164, name, email, google_sub, notes, tags, balance_idr,
          created_at, UNIQUE(tenant_id, phone_e164))
addresses(id, tenant_id, customer_id, label, recipient, phone, line, district, city, province,
          postal_code, is_default)

trips(id, tenant_id, title, country, currency, kurs_micro, kurs_lock[confirm|settle],
      opens_at, closes_at, eta_at, mode, fee_rule_json, cargo_rate_idr_per_kg, status, cover_key)
products(id, tenant_id, trip_id, title, description, price_minor, currency, fee_idr,
         est_weight_g, quota, reserved, photo_keys, variants_json, status, sort)

orders(id, tenant_id, code UNIQUE, trip_id, customer_id, status, address_id,
       hold_for_combine, notes, created_at, confirmed_at, cancelled_at, cancel_reason)
order_items(id, tenant_id, order_id, product_id NULL, title_snapshot, variant, qty, qty_obtained,
            price_minor, currency, kurs_micro, fee_idr, actual_price_minor,
            max_price_minor, on_unavailable[refund|substitute|ask], substitute_note,
            weight_g, status, shipment_id NULL, delivery_id NULL, purchase_photo_keys,
            receipt_key, decided_at, approval_deadline)

invoices(id, tenant_id, number UNIQUE(tenant_id), customer_id, order_id NULL, type
         [dp|settlement|cargo|domestic|adjustment|combined], amount_idr, unique_code,
         due_at, status[draft|open|partially_paid|paid|void|expired], lines_json, created_at)
payments(id, tenant_id, customer_id, amount_idr, method[transfer|qris|cash|saldo],
         proof_key, bank_account_id, paid_at, status[pending|verified|rejected],
         reject_reason, verified_by, verified_at, idempotency_key UNIQUE)
payment_allocations(payment_id, invoice_id, amount_idr)
ledger_entries(id, tenant_id, customer_id, delta_idr, reason, ref_type, ref_id, created_by, created_at)

shipments(id, tenant_id, trip_id, name, forwarder, awb, mode, status, total_weight_g,
          cost_idr, duty_idr, eta_at, updated_at)
deliveries(id, tenant_id, customer_id, address_snapshot_json, courier, service, resi,
           cost_idr, status, shipped_at, delivered_at)
status_events(id, tenant_id, entity_type, entity_id, status, message, photo_key,
              visibility, actor_id, created_at)

counters(tenant_id, name, value, PK(tenant_id,name))   -- invoice & order numbering
push_subscriptions(id, tenant_id NULL, user_or_customer, endpoint UNIQUE, keys_json, created_at)
notifications_log(id, tenant_id, channel, target, template, ref, status, created_at)
audit_log(id, tenant_id, actor_id, action, entity_type, entity_id, before_json, after_json, created_at)
idempotency(key PK, tenant_id, response_json, created_at)   -- pruned after 48 h
```

### 4.3 Money rules
- IDR stored as integer rupiah. Foreign prices in minor units with ISO currency (`JPY` 0 decimals, `USD/SGD/EUR` 2, `KRW` 0).
- Kurs stored as integer micro-rupiah per 1 major unit (`kurs_micro`), never floats.
- Item price = `round_up_to(price × kurs, rounding_step) + fee` — rounding step per store (Rp 1, 100, 500, 1,000).
- Kurs snapshot copied into each order item at the moment defined by `kurs_lock`.
- Invoice totals computed from lines in `packages/shared` (same code on client & server).

### 4.4 Numbering
- Order code: `{SLUG3}-{YYMM}-{base32 4}` (human-friendly, non-guessable suffix, e.g. `JPN-2611-K7QD`).
- Invoice number: `INV/{YYYY}/{MM}/{0001}` per tenant via `UPDATE counters SET value = value + 1 … RETURNING value` inside a D1 batch.

---

## 5. Status machines

### 5.1 Order item (what customers care about most)

```
requested ──confirm──▶ confirmed ──DP paid──▶ hunting ──┬─▶ obtained ─────────┐
    │                     │                              ├─▶ partial (qty_obtained < qty)
    └─reject              └─cancel                       ├─▶ unavailable ──▶ refund / substitute
                                                         └─▶ needs_approval (price > max / substitute offered)
                                                                 ├─ customer approves → obtained
                                                                 └─ rejects / timeout → default action

obtained/partial ──settled──▶ (then derived from logistics)
  in_shipment(shipment.status) ─▶ arrived_id ─▶ at_seller ─▶ delivery(shipped) ─▶ delivered ─▶ done
```

Customer-facing labels (Indonesian):
`Menunggu konfirmasi · Dikonfirmasi · Menunggu DP · Sedang dicari · Dapat · Dapat sebagian · Tidak dapat · Butuh persetujuanmu · Menunggu pelunasan · Di perjalanan (kargo) · Tiba di Indonesia · Proses bea cukai · Di gudang seller · Dikirim (resi) · Diterima · Selesai`.

### 5.2 Shipment (batch kargo)
`preparing → handed_to_forwarder → departed → in_transit → arrived_id → customs → customs_cleared → at_seller` (+ `delayed`, `held_by_customs`, `lost_partial`).
For `hand_carry` trips: `packed → in_luggage → landed → customs_cleared → at_seller`.

### 5.3 Invoice
`draft → open → partially_paid → paid` · `open → expired` (deadline) · any → `void` (with reason, audited).

### 5.4 Payment
`pending → verified | rejected`. Verified payments allocate to invoices (oldest due first, or seller picks). Overpayment → ledger credit.

---

## 6. Feature set

### 6.1 Customer side (`{slug}.bawaan.my.id`)
- **Storefront**: active trips with countdown to close, catalog grid, product sheet with photos/variants/quota left, "Request barang" form (link/photo, size, max price, if-unavailable choice).
- **Cart & checkout**: per trip; choose address (or "nanti"), preference per item (`if unavailable: refund to saldo / transfer / substitute: …`), agree to store policy (shown as short bullets, not a wall of text). Turnstile on submit.
- **Order page (tracking)** — the screen that kills "min, barangku gimana?":
  - Header: order code, store, overall progress ring.
  - Per item card: photo, status pill, purchase photo & receipt once bought, price actually paid.
  - Cargo section: batch timeline with dates, ETA, delays explained.
  - Money section: invoices with status, amount due, "Bayar" (shows bank/QRIS + unique amount, upload proof), saldo.
  - Delivery: courier + resi with deep link to courier tracking page.
  - Action items surfaced on top: "Butuh persetujuanmu: harga naik ¥200 (≈Rp 21.000). Setuju?" with deadline.
- **My orders** (with magic link/Google): all orders at this store, saldo, addresses.
- **Notifications**: Web Push (iOS 16.4+ requires "Add to Home Screen" — guided with an iOS-style instruction sheet), WhatsApp click-to-chat to seller with prefilled order code.
- **Invoice page**: clean, screenshot-friendly single-screen summary + print layout.

### 6.2 Seller side (`app.bawaan.my.id`)
- **Hari ini (Today)**: action queue — payments to verify, items awaiting decision, approvals expiring, overdue invoices, shipments without update for N days, orders to confirm. Each row has swipe/quick actions.
- **Pesanan**: inbox with filters (trip, status, unpaid, needs action), bulk select (confirm, send reminder, assign shipment), search by name/phone/code.
- **Trip**: create/duplicate trip, catalog management, quota, open/close/extend, per-trip kurs, recap ("rekap belanja" grouped by store/brand/location for shopping).
- **Mode Belanja (Shopping Mode)** — mobile, offline-first, one-hand:
  - Checklist grouped by store/location, large rows; tap item → sheet with `Dapat / Sebagian (qty) / Tidak dapat / Ganti barang`, actual price, snap photo + receipt.
  - Works without signal (roaming abroad): writes go to IndexedDB outbox with idempotency keys; sync banner shows pending count; conflicts (e.g. two staff marking same item) resolved last-writer-wins with audit + notify.
  - Price over customer max → item auto-moves to `needs_approval`, customer notified once online.
- **Pembayaran**: verify proofs side by side with expected amount (unique code highlighted), approve/reject with reason, partial allocation, mark cash.
- **Pengiriman**: create shipment batch, add items by scan/search/bulk from trip, update status (one tap updates all customers), enter weights → auto cargo invoices (§6.3), duty allocation, domestic deliveries with resi input (paste many resi at once by order code).
- **Pelanggan**: CRM — history, total spend, saldo, notes, tags (VIP, suka telat bayar), merge duplicates, WhatsApp shortcut.
- **Laporan**: per trip revenue, cost of goods (actual price × kurs), fees, cargo cost vs billed, kurs gain/loss, unpaid, refunds. CSV export.
- **Import/Export**: Excel/CSV import of customers (and historical orders) with column mapping, validation preview, dedupe by phone. Full export (CSV zip) anytime — no lock-in.
- **Template pesan**: editable message templates with variables (`{nama}`, `{kode}`, `{link}`, `{total}`) → "Kirim via WhatsApp" opens `wa.me/{phone}?text=…`; bulk mode steps through a list ("Next customer") since bulk WA API is paid.
- **Pengaturan**: store profile, tint color, logo, bank/QRIS, policies, staff, subdomain, plan, danger zone (read-only mode, delete store).

### 6.3 Pricing & billing flows
- **DP + settlement**: DP invoice on confirm (policy %); settlement invoice auto-generated when all items in the order are decided (obtained/partial/unavailable), already deducting DP and refunds; due date from policy.
- **Full payment upfront** option per trip.
- **Cargo shipping by weight**: seller enters actual weight per item or per customer package; rules per trip: price/kg, round up to 0.1 kg or 1 kg, minimum charge, volumetric weight `L×W×H/6000` when larger. Generates `cargo` invoices in bulk with a preview before sending.
- **Customs duty**: if a batch is taxed, duty is allocated proportionally to item value; seller chooses absorb vs pass-through; generates `adjustment` invoices.
- **Domestic shipping**: seller enters ongkir per delivery (no paid courier API in Phase 1), or customer picks "ambil sendiri".
- **Unique code**: random 1–999 added to amount, unique among the store's open invoices so mutation matching is unambiguous; seller can disable.
- **Combined invoice**: merge open invoices of one customer into one payable (common when customers have several orders).

---

## 7. Edge cases (and how each is handled)

### Ordering & stock
| Case | Handling |
|---|---|
| Last unit bought by two customers at once | Atomic `UPDATE products SET reserved = reserved + ? WHERE id = ? AND reserved + ? <= quota`; zero rows → "Stok PO habis" with waitlist option |
| PO closes while customer is checking out | Server checks `closes_at` at submit; grace 2 min; clear message, cart kept |
| Customer submits twice (double tap / bad signal) | Idempotency key per checkout; second request returns the first result |
| Same person, different phone formats | E.164 normalisation; merge tool for genuinely different numbers |
| Customer orders in several trips | Separate orders; "Gabung kirim" holds deliveries until all arrive |
| Item variant sold out, customer wants alternative | Per-item `on_unavailable` chosen at checkout; `ask` → approval request with deadline and default action |
| Customer cancels after item already bought | Policy-driven: blocked after `hunting` unless seller allows; DP forfeiture recorded in ledger with reason |
| Request item with only a photo/link | Seller quotes price → becomes `needs_approval` → customer accepts → normal flow |

### Purchasing abroad
| Case | Handling |
|---|---|
| Item not found | `unavailable` → refund per preference (saldo/transfer) or substitute flow |
| Got 2 of 3 | `partial`, `qty_obtained = 2`; invoice recalculated, excess DP to saldo |
| Actual price higher than listed | ≤ `max_price` auto-accept; otherwise `needs_approval` |
| Actual price lower | Difference refunded/credited automatically (store setting: pass savings or keep listed price — must be disclosed in policy) |
| Kurs moves between order and payment | `kurs_lock` per trip: lock at confirmation (default) or at settlement; displayed clearly on invoice |
| Seller marks wrong status | Undo for 10 s + editable afterwards; every change audited and shown as a correction event if already public |
| No signal in store | Shopping Mode offline outbox (§6.2) |
| Tax refund / duty-free receipts | Receipt photo stored; optional `cost_note` on item for seller's reports |

### Payments
| Case | Handling |
|---|---|
| Fake / edited transfer screenshot | Proof is never auto-trusted: seller verifies against bank mutation; UI shows "Cek mutasi dulu" reminder and expected unique amount |
| Underpayment | Invoice `partially_paid`, remainder shown to customer |
| Overpayment | Excess to customer saldo; usable on next invoice or refunded |
| One transfer for several invoices | Allocation UI (auto oldest-first, editable) |
| Proof uploaded twice | Hash of image + amount/date duplicate warning |
| Customer ghosts after item obtained | Reminders (D-1, D0, D+2 via Web Push + WA template list for seller); after policy deadline → invoice `expired`, item to "Ready stock" for resale, DP handling per policy, all in ledger |
| Refund owed but customer has no bank account set | Stays as saldo; visible on customer page; seller report "saldo pelanggan" (liability) |

### Logistics
| Case | Handling |
|---|---|
| Cargo delayed | `delayed` status with required public message + new ETA; all affected customers notified once |
| Held by customs / confiscated | `held_by_customs` / item `lost`; refund flow; optional per-trip insurance fee |
| Partial loss in a batch | Per-item `lost` with claim note; refund via ledger |
| Damaged on arrival | Photo evidence on item; seller decides refund/discount; customer sees resolution |
| Address change after packing | Address locked once delivery is `packed`; request goes to seller as a note |
| Wrong resi entered | Editable with audit; customer sees updated resi |
| Item sits in seller warehouse for weeks | Storage reminder; optional storage fee policy after N days |
| Prohibited/limited goods (cosmetics, food, batteries, value limits for personal imports) | Trip-level disclaimer + product flag; Bawaan shows seller a generic reminder to follow current Bea Cukai rules — not legal advice |

### Platform
| Case | Handling |
|---|---|
| Daily free-tier quota exhausted | Static app still loads; API returns friendly "sistem sedang sibuk" state; client retries with backoff; outbox keeps seller writes; admin alerted at 70% |
| Seller loses Google account | Second owner / platform support with identity verification |
| Tenant deleted | 7-day soft delete → read-only export window → purge PII after 30 days; slug quarantined 180 days |
| Phishing store (fake bank/brand) | Blocked slugs, report button on every storefront, platform suspend switch, new stores show "Toko baru" badge |
| Cross-tenant data leak | Mandatory `tenantId` in repositories, integration tests that try reading another tenant's ids, opaque ids (ULID) |
| Safari evicts web storage after 7 days of non-use | Never keep data only on the client; outbox syncs ASAP; encourage installing PWA (home-screen apps are exempt) |
| Timezones (seller in Tokyo, customers in WIB/WITA/WIT) | Store UTC; deadlines defined in store timezone; show customer's local time with zone label |
| Customer opens invoice link months later | Links never die; expired invoices say so and link to the current order page |

---

## 8. Notifications (free-first)

| Channel | Use | Notes |
|---|---|---|
| In-app timeline | Always | Source of truth |
| Web Push (VAPID) | Status changes, approvals, payment verified | iOS: only for PWA added to Home Screen. Send **payload-less** push; service worker fetches `/api/notifications/latest` and shows it (keeps Worker CPU low, no payload encryption) |
| Email | — | Not used in Phase 1–2 (decision D3); Resend free tier planned for Phase 3 |
| WhatsApp click-to-chat | Seller → customer messages via templates | Free; seller taps send. WhatsApp Cloud API as a paid add-on in Phase 3 |

Notification preferences per customer; quiet hours 21:00–07:00 store time for non-urgent messages. Coalesce: one batch update → one notification per customer, not per item.

---

## 9. UI/UX — iOS look & feel on every device

Most users are on iPhone/iPad, so the app should feel like a native iOS app: familiar navigation, materials, typography and gestures. Base it on Apple's current HIG — the **Liquid Glass** language introduced in iOS 26 and carried into iOS 27. Before hi-fi design, check details against the current Apple Design Resources (iOS 27 / iPadOS 27 / macOS UI kits).

Legal note: SF Pro and SF Symbols are licensed for Apple platforms only, so don't bundle them. Use the system font stack (SF renders natively on Apple devices) and an icon set with similar geometry (Lucide/Phosphor at matching stroke weights).

### 9.1 Design tokens
- **Font stack**: `-apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", "Segoe UI", Roboto, sans-serif`; on iOS use `font: -apple-system-body` as the base so **Dynamic Type** (the user's text size setting) is respected, and size everything in `rem`.
- **Type scale (iOS default sizes, pt→px)**: Large Title 34/41 bold · Title1 28/34 · Title2 22/28 · Title3 20/25 · Headline 17/22 semibold · Body 17/22 · Callout 16/21 · Subheadline 15/20 · Footnote 13/18 · Caption1 12/16 · Caption2 11/13. Use `font-variant-numeric: tabular-nums` for money.
- **Colors (light / dark)**: iOS system colors — tint default `systemBlue` (#007AFF / #0A84FF), green #34C759 / #30D158 (Dapat, Lunas), orange #FF9500 / #FF9F0A (Butuh tindakan), red #FF3B30 / #FF453A (Tidak dapat, overdue), gray labels (`label`, `secondaryLabel` 60%, `tertiaryLabel` 30%), backgrounds `systemGroupedBackground` #F2F2F7 / #000, `secondarySystemGroupedBackground` #FFF / #1C1C1E, separators hairline 0.5px.
- **Tenant tint**: seller picks an accent (like iOS tint color); validated for ≥ 4.5:1 contrast against both themes, auto-adjusted otherwise.
- **Shape**: large radii (cards 20–26px, sheets 34px top, buttons capsule). Continuous "squircle" corners via `corner-shape: squircle` where supported, plain `border-radius` fallback.
- **Materials (Liquid Glass)**: nav bars, tab bar, toolbars, sheets and menus use translucent layers: `backdrop-filter: blur(20–30px) saturate(180%)`, subtle inner highlight and edge refraction (gradient border), adaptive tint over content. Glass sits on the navigation layer only — never on list cells or body content (legibility + performance).
- **Motion**: spring-like easing with CSS `linear()` curves (≈ response 0.35–0.5 s, damping 0.8–0.9); same-document **View Transitions** for push/pop; sheets slide with rubber-band overscroll.
- **Accessibility fallbacks**: `prefers-reduced-motion` → cross-fades; reduced transparency (media query where supported + in-app toggle) → opaque materials; `prefers-contrast: more` → stronger separators/labels; `@supports not (backdrop-filter: blur(1px))` → opaque bars. WCAG AA contrast measured on top of the blurred background's worst case.

### 9.2 Components (iOS idioms)
- Navigation bar with **large title** collapsing into an inline title on scroll; search field integrated below it.
- **Tab bar**: floating glass capsule (iOS 26+ style) that shrinks while scrolling down and expands on scroll up; search as a separate circular button beside it.
- **Inset grouped lists** (Settings-style) for forms and detail screens; rows ≥ 44pt; disclosure chevrons; trailing values in secondary label.
- **Sheets** with detents (medium/large) + grabber, drag to dismiss; on iPad/desktop they become centered form sheets or popovers anchored to the trigger.
- **Swipe actions** on list rows (e.g. order row: leading "Dapat", trailing "Tidak dapat"/"Lainnya"); also exposed as context menu + buttons for accessibility and desktop.
- **Context menus** on long-press (touch) / right-click (desktop) with previews.
- **Segmented controls**, **toggles** (`<input type="checkbox" switch>` — native iOS switch with haptic in Safari 17.4+), **steppers** for qty, native date/time pickers.
- **Pull to refresh**, skeleton loading that matches final layout, empty states with one clear action.
- **Toasts** replaced by iOS-style HUD/banner from the top; destructive confirmations via action sheets.
- **Status pills** with color + icon + text (never color only).
- Haptics: Web can't trigger iOS haptics except via native switch; don't fake with `navigator.vibrate`.

### 9.3 Breakpoints & layouts
Size classes like iOS, using container queries for components:

| Class | Width | Devices |
|---|---|---|
| Compact | < 744px | iPhone (375–440), Android phones |
| Regular | 744–1199px | iPad mini/Air/Pro portrait, iPad landscape small, small laptops |
| Wide | ≥ 1200px | iPad Pro landscape, desktop/laptop |

**Seller app**

| | Mobile (compact) | Tablet (regular) | Desktop (wide) |
|---|---|---|---|
| Navigation | Floating bottom tab bar: Hari ini · Pesanan · Belanja · Pelanggan · Lainnya | iPadOS-style top floating tab bar that expands into a collapsible **sidebar** (landscape shows sidebar by default) | Persistent sidebar (collapsible) with sections + store switcher, like macOS Tahoe apps |
| Content | Single column stack, push navigation | **Two columns**: list + detail (split view) | **Three columns**: sidebar · list · detail; inspector panel for item edits |
| Primary actions | `+` in nav bar, swipe actions, sheets | Toolbar buttons, popovers | Toolbar + keyboard: `⌘K` command palette, `J/K` move, `E` mark dapat, `/` search, `⌘↩` save |
| Forms | Full-height sheets | Form sheet centered (~540px) | Inspector or modal (max 640px) |
| Tables | Card rows | Compact rows | Real data table with sortable columns, multi-select with shift-click, column chooser |
| Shopping Mode | Primary target: thumb-zone actions, huge rows, camera access | Split: store groups left, items right | Available, mostly for review |

**Customer storefront & tracking**

| | Mobile | Tablet | Desktop |
|---|---|---|---|
| Catalog | 2-column grid, sticky trip header with countdown | 3-column grid | 4-column grid + sticky cart panel on the right |
| Product | Bottom sheet (large detent) | Form sheet | Side-by-side gallery + details modal |
| Checkout | Step sheets | Two-pane (items · summary) | Two-pane with sticky summary |
| Order tracking | Stacked cards: action needed → items → cargo → payments → delivery | Two columns: items left, timeline + payments right | Same as tablet, max width 1100px centered |

### 9.4 Platform polish
- `viewport-fit=cover`, `env(safe-area-inset-*)` paddings for notch, Dynamic Island and home indicator; `100dvh`/`svh` instead of `100vh`.
- Inputs ≥ 16px to stop iOS zoom; correct `inputmode`/`autocomplete` (`tel`, `email`, `one-time-code`, `street-address`, `numeric` for money).
- PWA manifest + `apple-touch-icon`, `apple-mobile-web-app-status-bar-style`, `theme-color` per light/dark; splash handled by manifest background.
- iOS standalone mode has no browser back: always show a back button in nav bars; don't implement custom edge-swipe in Safari tabs (conflicts with Safari's own).
- Share via `navigator.share` (native iOS share sheet) for store links, invoices, tracking links.
- Camera: `<input type="file" accept="image/*" capture="environment">` for receipts; compress before upload.
- Dark mode follows system; manual override in settings.
- Indonesian copy, friendly and short ("Kak", no jargon). Numbers in `id-ID` format (`Rp 1.250.317`), foreign amounts `¥3.200`.
- Performance budget: first load JS ≤ 170 KB gz on storefront; LCP < 2.5 s on 4G iPhone; route-level code splitting (Shopping Mode, reports and import loaded on demand).

### 9.5 Key screens to design first
1. Customer order tracking page (mobile) — the core value.
2. Seller "Hari ini" queue (mobile + desktop).
3. Shopping Mode item sheet (mobile).
4. Shipment batch update (tablet/desktop).
5. Payment verification (desktop split view).
6. Storefront catalog + checkout (mobile).
7. Onboarding (Google → slug → done).

---

## 10. Security & privacy

- Tenant isolation enforced in the data layer + tests (§7 Platform).
- RBAC checks per endpoint; payments/refunds need explicit permission.
- Private R2 bucket for proofs/receipts/addresses-related images, served through Worker with auth and short-lived signed URLs; public bucket only for catalog images.
- Upload validation: magic-byte sniffing, size ≤ 5 MB raw (≤ 400 KB after client compression), re-encoded on client, random keys.
- No tenant-provided HTML/JS anywhere; store descriptions rendered as plain text/limited markdown; strict CSP.
- Rate limiting on login, tracking lookup (code + phone digits), checkout; Turnstile on anonymous writes.
- Audit log for money, status corrections, role changes, exports.
- **UU PDP (Law 27/2022)**: privacy policy & terms; seller = data controller, Bawaan = processor (DPA in terms); data export & deletion for customers on request; collect minimum PII; mask phone numbers in seller lists by default for staff role.
- Backups: D1 Time Travel + weekly full export to R2 (encrypted), monthly restore drill.

---

## 11. Plans & monetisation (proposal)

| | Gratis | Pro (Rp 49.000/month) |
|---|---|---|
| Active trips | 1 | Unlimited |
| Order items / month | 100 | Unlimited (fair use) |
| Staff | — | Up to 5 |
| Branding | "Dibuat dengan Bawaan" | Removable |
| Custom domain | — | Yes (Phase 3) |
| Reports & export | Basic | Full |

Billing in Phase 1 is manual (transfer + admin approval inside platform admin); payment gateway later. Plan limits enforced softly (warn at 80%, block new trips/orders, never block access to existing data).

---

## 12. Roadmap

### Phase 0 — Foundations (week 1) — ✅ done

- [x] Zone `bawaan.my.id` confirmed on Cloudflare (account "Malang.tech.id", Free plan)
- [x] Resources created (APAC): D1 `bawaan-core` + `bawaan-core-preview`, KV `bawaan-hosts` + `-preview`, R2 `bawaan-public`, `bawaan-private` (+ `-preview`)
- [x] Environments: `preview` (workers.dev, own D1/KV/R2) and production (custom domains + `*.bawaan.my.id/*` route) in `apps/web/wrangler.jsonc`
- [x] Migration `0001_bootstrap.sql` applied locally and on preview
- [x] Monorepo scaffold (pnpm), `packages/shared`: money (kurs micro-units, round-up, proportional allocation), slug rules, phone E.164, host → surface resolver — 65 unit tests
- [x] Worker (Hono): host router, `www` → apex 301, nested/invalid subdomain 404, preview `?host=` override (disabled in production), HTMLRewriter meta/OG injection, security headers + CSP, `/api/health` checking D1/KV/R2 — 15 Workers-runtime tests
- [x] Design tokens (iOS colors light/dark/high-contrast/reduced-transparency, type scale, Dynamic Type on iOS, spring easing) + components: NavBar (large title), TabBar (floating, minimises on scroll), inset grouped List, Sheet (detents, drag), Button/LinkButton/IconButton, Pill, Segmented, native Switch, AppShell (tab bar / slide-over sidebar / pinned sidebar), SplitView
- [x] Surfaces: landing, seller app shell, store shell, not-found, `/gallery`
- [x] Logo, favicon, PWA icons, OG image, manifest
- [x] Playwright: 8 checks × 6 projects (iPhone 17 Pro light/dark, iPad mini portrait, iPad Pro 11 landscape, desktop Safari, desktop Chrome) with screenshot baselines — 48/48 passing; no horizontal scroll on any surface
- [x] CI workflow `.github/workflows/ci.yml` (typecheck, unit, Workers tests, e2e; preview deploy on PR, production on `main`)
- [x] Preview live: https://bawaan-preview.malang-tech-id.workers.dev (`?host=app`, `?host=demo`, `/gallery`)
- [x] Production deployed: `bawaan.my.id`, `www.` (301 → apex), `app.`, `accounts.` as Worker custom domains + `*.bawaan.my.id/*` route; `/api/health` green on production D1/KV/R2; `?host=` override confirmed ignored in production
- [x] DNS: proxied wildcard record `*` → `AAAA 100::` (added by owner in the dashboard); `toko-ayu.bawaan.my.id` serves the store shell over HTTPS
- [x] Local git repo with the Phase 0 commit
- [ ] GitHub repo + `CLOUDFLARE_API_TOKEN` secret for CI deploys (deferred by owner)
- **Done when**: `app.`, apex and `demo.bawaan.my.id` resolve to the right shells over HTTPS; component gallery passes Playwright screenshots on iPhone/iPad/desktop. (All ✅. Hosts queried before their records existed may stay NXDOMAIN-cached by public resolvers for up to the zone's negative TTL.)

### Phase 1 — MVP (weeks 2–6) — ✅ deployed
- [x] Google sign-in (+ dev login locally), onboarding, subdomain rules, store settings, bank/QRIS
- [x] Trips & catalog, storefront, checkout (DP or full), request item ("titip barang lain")
- [x] Orders inbox (filters, search, split view), confirm/reject/cancel, quote requested items, item decisions (dapat/sebagian/tidak/approval; over-limit price auto-asks the customer)
- [x] Invoices (DP, settlement, ongkir), unique code, manual payment verification with proof side by side, record/void/mark paid, saldo ledger
- [x] Shipment batches with timeline and one-tap status updates, domestic delivery + resi (ongkir auto-invoiced)
- [x] Customer tracking page (magic link + code/last-4 lookup), approvals, pay sheet with proof upload, printable invoice page
- [x] WhatsApp templates (editable), Web Push for customers & sellers with the iOS "Add to Home Screen" guide; reminder + auto-expiry cron
- [x] Customer CSV import (column mapping, preview, dedupe by phone) and CSV export — Excel users save as CSV first
- [x] Verified end to end in the browser: onboarding → trip → checkout → confirm → DP paid → shopping decisions → approval → settlement → cargo batch → delivery with resi; e2e 54/54
- Tests after Phase 3: shared 69, Workers 43, e2e 54 (all passing)
- [x] Deploy Phase 1 to preview + production (D1 migrations remote); per-env secrets (`APP_SECRET`, VAPID, Google OAuth client in GCP project `bawaan-my-id`)
- [x] Production walkthrough in the browser (Google sign-in → onboarding → trip → checkout with request item → quote → confirm → DP proof → verify → dapat / tidak dapat / over-limit approval → settlement → cargo batch + weight invoice → JNE delivery + ongkir → reports, CSV zip, team). Fixed on the way: request-item fee dropped on quote, customer/trip list counts always 0 (unqualified correlated subquery), per-order report counted pcs vs lines, DP invoice wording, settings sub-pages nav highlight, CSP blocking the Cloudflare analytics beacon
- [x] Launch readiness: Google OAuth app published (In production, basic scopes only, no logo so no brand verification), `/privasi` and `/syarat` pages linked from landing and login, `demo.bawaan.my.id` sample store (browsable, checkout refused, WhatsApp hidden), walkthrough test data removed from production D1/R2
- [ ] Pilot recruitment in parallel: 3–5 jastip sellers from jastip communities (FB groups, IG, Telegram), ideally including the seller from the source case; onboard them in week 6
- **Done when** a seller can run one complete trip (20 customers, 60 items, 1 cargo batch) with no spreadsheet and each customer can answer "dapat tidak? kargo di mana? harus bayar berapa?" from the tracking page.

### Phase 2 — Efficiency (weeks 7–10) — ✅ deployed
- [x] Shopping Mode offline-first: IndexedDB outbox with idempotency keys, photos queued as blobs, sync banner, auto-sync on reconnect; service worker caches the app shell, bundles, photos and the checklist reads; overwrites by another staff member are last-writer-wins, audited and pushed to the seller
- [x] Weight-based cargo invoicing: per-trip rate/kg, rounding step, minimum, volumetric L×W×H/6000; parcel weights per customer per batch, preview, bulk `cargo` invoices
- [x] Duty allocation proportional to goods value, pass-through (adjustment invoices) or absorb; forwarder cost per batch
- [x] Combined invoices (one unique code, payment spread over the inner invoices) and gabung kirim (customer or seller holds delivery; seller sees what is still on the way)
- [x] Optional customer "Masuk dengan Google" on the store subdomain; orders linked by opening their link while signed in; "Pesananku" page
- [x] Reports per trip (goods value, cost at actual kurs, kurs gain/loss, cargo & duty billed vs paid, unpaid, refunds, gross profit) + CSV; saldo liability
- [x] Staff roles: email-bound invites, owner/admin/staff, grants for money and reports, second owner, last-owner guard, masked phones for staff
- [x] Today queue polish (one-tap verify on exact amounts, ready to ship, cargo to bill), ⌘K palette, `/`, `g`+letter, J/K, E (mark dapat), ⌘↩
- [x] Customer merge (old phone keeps resolving to the survivor); fixed trip/product PATCH resetting defaulted fields
- [x] Migration `0003_phase2.sql`

### Phase 3 — Growth — ✅ deployed (integrations off)
Every third-party integration is off at launch: it only turns on when listed in the `FEATURES` var (`email, apple, courier, domains, qris, wa_cloud, platform_gateway`) **and** its secrets are set. With `FEATURES=""` the UI hides it and its endpoints refuse.
- [x] Transactional email via Resend (`RESEND_API_KEY`, `EMAIL_FROM`): customer notifications with tokenised links, seller alerts, team invites
- [x] Custom domains via Cloudflare for SaaS (`CF_API_TOKEN`, `CF_ZONE_ID`, `CUSTOM_DOMAIN_TARGET`), Pro only; hostname → slug in KV
- [x] Payment gateway: per-store Xendit dynamic QRIS, credentials sealed with AES-GCM, webhook auto-verifies (idempotent); VA not built yet
- [x] WhatsApp Cloud API add-on per store (approved template with one body variable)
- [x] Sign in with Apple (`APPLE_*`) for sellers and customers
- [x] Courier API (Biteship, `BITESHIP_API_KEY`): rate check from the store's origin postal code, tracking history on the order page
- [x] Waitlist on sold-out products (seller alerted when a slot frees), ready-stock shelf (forfeited goods relisted, paid-in-full, skip the hunt), cross-store ready-stock market on the landing page
- [x] Pro billing: plan limits enforced softly (Gratis: 1 open trip, 100 items/month, no staff, branding), 1/3/12-month checkout via Xendit invoice (`PLATFORM_XENDIT_*`) or manual transfer + proof, renewal reminder
- [x] Platform admin (`PLATFORM_ADMINS`): stores, plans, suspend, manual payment review, abuse reports from the storefront "Laporkan toko"
- [x] Store lifecycle: rename once per 30 days with 90-day redirect, pause (no new orders, links keep working), delete with 7-day grace → slug quarantine 180 days → PII purge at 30 days; full CSV zip export
- [x] Migration `0004_phase3.sql`
- [ ] D1 sharding: deferred until a database nears 350 MB (§2.5). The export above is the first step of moving a tenant
- [x] Deploy Phase 2 + 3 (remote migrations 0003–0004 applied on preview and production)
- [ ] User testing with pilot sellers

---

## 13. Testing & quality

- Unit: money math, kurs rounding, invoice generation, status transitions (table-driven, every illegal transition rejected).
- Integration (Workers pool): tenant isolation, quota race (parallel reservations), idempotency, payment allocation, cron jobs.
- E2E (Playwright): WebKit iPhone 16/17 sizes, iPad mini/Pro portrait+landscape, desktop 1440; flows: onboarding, checkout, decide items, verify payment, batch update → customer sees it.
- Visual regression on key screens in light/dark and with larger Dynamic Type.
- Accessibility: axe checks, VoiceOver manual pass on iPhone each release.
- Manual device checklist on real iPhone (Safari tab + installed PWA) and iPad.
- Load sanity: estimate reads/writes per flow and keep a budget table updated in CI (fail if a flow exceeds its write budget).

---

## 14. Decisions

| # | Topic | Decision |
|---|---|---|
| D1 | Pricing | Pro **Rp 49.000/month**. Gratis: 1 active trip, 100 order items/month |
| D2 | Default store policy | **DP 50%** on confirmation; settlement due **3 days** after the item is marked Dapat; unpaid → DP forfeited, item becomes ready stock. Editable per store/trip |
| D3 | Email | **No email in Phase 1–2.** Automated notifications = Web Push; manual = WhatsApp templates. Revisit (Resend free tier) in Phase 3 |
| D4 | Customer access | **Magic link + order code/last 4 phone digits** at launch; customer Google sign-in moves to Phase 2 |
| D5 | Brand tint | **iOS System Blue** (#007AFF light / #0A84FF dark) |
| D6 | Pilot sellers | None yet — recruiting is a Phase 1 task (§12) |
| D7 | Web Push | **Pulled into Phase 1** since there is no email channel |

| D8 | Logo | Tote bag with a check mark on a System Blue squircle ("what you carry home" + the "Dapat" moment). Wordmark: lowercase `bawaan`, rounded system font. Files: `apps/web/public/favicon.svg`, `src/ui/Logo.tsx` |
| D9 | Landing copy | Headline "Jastip rapi, pelanggan tenang." Sub: "Pesanan, invoice, dan status kargo dalam satu link. Pelanggan cek sendiri barangnya dapat atau tidak, tanpa tanya admin berulang kali." CTA "Buat toko gratis" / "Lihat contoh toko" |
| D10 | DP forfeiture wording | Default policy text shown at checkout and on invoices (seller can edit): see below |
| D11 | Accessibility over pixel fidelity | Secondary label alpha 0.76 (iOS uses 0.6) and darker status-text greens/reds so all text passes WCAG AA 4.5:1 |

Default store policy text (D10):

> **Kebijakan DP & pelunasan**
> - DP 50% dibayar setelah pesanan dikonfirmasi. Barang baru dicarikan setelah DP masuk.
> - Kalau barang **tidak dapat**, DP untuk barang itu dikembalikan penuh, ke saldo atau ke rekeningmu (sesuai pilihan saat pesan).
> - Kalau barang **dapat**, pelunasan paling lambat **3 hari** sejak status berubah jadi Dapat. Kami kirim pengingat sebelum batas waktu.
> - Kalau sampai batas waktu belum lunas, pesanan dianggap batal: **DP tidak dikembalikan** dan barang dijual sebagai ready stock.
> - Butuh waktu tambahan? Hubungi kami sebelum batas waktu.

Validate this text with the first pilot sellers; it stays editable per store.
