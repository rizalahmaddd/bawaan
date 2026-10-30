# Deploy ke Cloudflare

Bawaan berjalan sebagai satu Worker yang melayani apex, `www`, `app`, `accounts`, dan semua subdomain toko. Panduan ini memakai contoh domain `contoh.id`; ganti dengan domainmu.

## 1. Zona dan DNS

Domain harus memakai DNS Cloudflare. Tambahkan record wildcard yang di-proxy supaya semua subdomain toko masuk ke Worker:

| Tipe | Nama | Isi | Proxy |
|---|---|---|---|
| AAAA | `*` | `100::` | Proxied |

Apex, `www`, `app`, dan `accounts` dipasang sebagai *custom domain* Worker lewat `routes` di `wrangler.jsonc`.

## 2. Buat resource

```bash
npx wrangler login
npx wrangler d1 create bawaan-core
npx wrangler r2 bucket create bawaan-public
npx wrangler r2 bucket create bawaan-private
npx wrangler kv namespace create HOSTS
```

## 3. Sesuaikan `apps/web/wrangler.jsonc`

- `account_id`, `database_id`, dan id KV `HOSTS` dengan milikmu.
- `vars.ROOT_DOMAIN` jadi `contoh.id`, dan semua `routes` diganti ke domainmu.
- `vars.SUPPORT_WA`: nomor WhatsApp support yang tampil di halaman Paket.
- `vars.PLATFORM_QRIS`: payload QRIS statis untuk pembayaran paket Pro (isi teks hasil scan QR, bukan gambarnya). Kosongkan kalau tidak dipakai; halaman Paket akan meminta transfer manual.
- Blok `env.preview` boleh dihapus kalau tidak butuh lingkungan preview.

Frontend memakai `VITE_ROOT_DOMAIN` saat build untuk menampilkan alamat toko. Set variabel ini (mis. `VITE_ROOT_DOMAIN=contoh.id pnpm deploy:production`) kalau domainmu bukan `bawaan.my.id`.

## 4. Secret

```bash
cd apps/web
openssl rand -hex 32 | npx wrangler secret put APP_SECRET
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put PLATFORM_ADMINS        # email Google admin platform, pisahkan dengan koma
```

Web Push (disarankan, terutama untuk iPhone):

```bash
node scripts/vapid-keys.mjs                    # salin tiap nilai ke secret berikut
npx wrangler secret put VAPID_PUBLIC_KEY
npx wrangler secret put VAPID_PRIVATE_JWK
npx wrangler secret put VAPID_SUBJECT          # mis. mailto:kamu@contoh.id
```

Anti-bot di checkout (disarankan untuk production): buat widget Turnstile, isi `vars.TURNSTILE_SITE_KEY`, lalu `npx wrangler secret put TURNSTILE_SECRET`.

`APP_SECRET` jangan diganti setelah ada pesanan. Secret ini menandatangani link pesanan dan menyegel kredensial integrasi, jadi kalau diganti, link lama tidak berlaku dan kunci integrasi harus diisi ulang.

## 5. Google OAuth

Di Google Cloud Console, buat OAuth client tipe *Web application*:

- Authorized redirect URI: `https://accounts.contoh.id/api/auth/google/callback`
- Scope cukup `openid`, `email`, dan `profile`, jadi aplikasi bisa dipublikasikan tanpa verifikasi Google.
- Halaman `https://contoh.id/privasi` dan `https://contoh.id/syarat` sudah tersedia untuk diisi di consent screen. Sesuaikan isinya di `apps/web/src/surfaces/Legal.tsx`.

## 6. Deploy

```bash
pnpm deploy:production   # migrasi D1 remote, build, lalu wrangler deploy
```

Cek hasilnya di `https://contoh.id/api/health`; semua komponen harus `ok`.

## 7. CI (opsional)

`.github/workflows/ci.yml` selalu menjalankan typecheck, unit test, dan e2e. Job deploy hanya berjalan kalau repo punya variable `CLOUDFLARE_DEPLOY=true` dan secret `CLOUDFLARE_API_TOKEN`. Push ke `main` di-deploy ke production, sedangkan pull request di-deploy ke preview.

## Integrasi opsional

Tambahkan namanya ke `vars.FEATURES` (dipisah koma) lalu pasang secret-nya:

| Fitur | `FEATURES` | Secret |
|---|---|---|
| Email transaksional (Resend) | `email` | `RESEND_API_KEY`, `EMAIL_FROM` |
| Sign in with Apple | `apple` | `APPLE_CLIENT_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY` |
| Ongkir & lacak kurir (Biteship) | `courier` | `BITESHIP_API_KEY` |
| Domain sendiri (Cloudflare for SaaS) | `domains` | `CF_API_TOKEN`, `CF_ZONE_ID`, `CUSTOM_DOMAIN_TARGET` |
| QRIS dinamis per toko (Xendit) | `qris` | diisi seller sendiri di Pengaturan, disegel dengan `APP_SECRET` |
| WhatsApp Cloud API | `wa_cloud` | diisi seller sendiri di Pengaturan |
| Gateway pembayaran paket Pro | `platform_gateway` | `PLATFORM_XENDIT_KEY`, `PLATFORM_XENDIT_CALLBACK_TOKEN` |

Callback Xendit: QRIS per toko ke `https://app.contoh.id/api/webhooks/xendit/<tenantId>` (seller melihat URL lengkapnya di Pengaturan), dan pembayaran paket Pro ke `https://app.contoh.id/api/webhooks/xendit`. Token callback harus sama dengan yang diisi di dashboard Xendit; token kosong selalu ditolak.

## Cron

Trigger `7 * * * *` (tiap jam) menjalankan: kedaluwarsa persetujuan harga, pembatalan pesanan yang DP-nya tidak dibayar, barang hangus kalau pelunasan lewat batas, pengingat pelunasan, pengingat perpanjangan paket Pro, penghapusan toko yang sudah lewat masa tunggu, dan pembersihan data sementara. Tidak perlu Worker terpisah.

## Backup

```bash
npx wrangler d1 export bawaan-core --remote --output backup.sql
```
