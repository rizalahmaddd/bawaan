# Arsitektur

## Gambaran besar

```
            ┌───────────────────────── Cloudflare Worker "bawaan" ─────────────────────────┐
browser ──▶ │ surface router (hostname) → landing | app | accounts | store:{slug} | 404     │
            │   /api/*   Hono: auth · tenants · t/:tenantId (seller) · store · admin · push  │
            │   /media/* R2 publik (cache 1 tahun)                                          │
            │   lainnya  SPA dari Workers Assets, <html data-surface> diisi oleh Worker      │
            └──────┬───────────────┬────────────────┬───────────────┬──────────────────────┘
                   │               │                │               │
                  D1              R2               KV          Cron tiap jam
           (data semua toko)  publik/privat   domain sendiri  (pengingat & kedaluwarsa)
```

Satu Worker dan satu bundle frontend melayani semua permukaan. Worker menentukan permukaan dari hostname (`packages/shared/src/host.ts`), lalu frontend membaca `data-surface` di `<html>` untuk memilih aplikasi yang dirender: landing, aplikasi seller, atau toko.

## Struktur folder

```
apps/web/
  src/
    seller/        aplikasi seller (layar, sheet, hooks, navigasi)
    store/         toko online dan halaman pesanan pelanggan
    surfaces/      entry tiap permukaan: Landing, Store, Legal, NotFound
    ui/            komponen bergaya iOS: NavBar, TabBar, List, Sheet, AppShell, Button
    lib/           router, API client, outbox offline, format, push
  worker/
    index.ts       routing host, CSRF, security header, aset, media
    auth/          sesi, Google/Apple OAuth, dev login
    seller/        route seller per toko, tim, laporan, upload, pengaturan toko
    store/         route toko publik: katalog, checkout, lacak, bayar, akun pelanggan
    platform/      paket Pro, admin platform, webhook
    services/      logika bisnis: pesanan, tagihan, pembayaran, kargo, notifikasi
    db/schema.ts   skema Drizzle
  e2e/             Playwright
packages/shared/   zod schema, uang & kurs, slug, host, izin, QRIS, varian
migrations/        SQL D1 berurutan
```

## Alur pesanan dan uang

1. **Checkout** di toko: pesanan berstatus `requested` dan kuota barang dipesan (`reserved`). Pelanggan menerima kode pesanan dan link bertoken HMAC.
2. **Seller konfirmasi**: harga barang titipan harus diisi dulu. Tagihan DP terbit dari `harga × kurs`, dibulatkan, ditambah fee, lalu diberi kode unik.
3. **Bayar**: pelanggan mengunggah bukti (bucket privat) atau membayar QRIS kalau integrasi aktif. Seller memverifikasi; kelebihan bayar masuk saldo.
4. **Belanja**: tiap barang diputuskan dapat, dapat sebagian, tidak ada, atau butuh persetujuan harga baru. Keputusan dari mode offline dikirim ulang dengan idempotency key.
5. **Pelunasan**: setelah semua barang punya hasil, tagihan pelunasan terbit otomatis, dikurangi DP dan ditambah selisih harga.
6. **Kargo & kirim**: barang dikelompokkan ke batch pengiriman. Berat per pelanggan menghasilkan tagihan ongkir, lalu barang dikirim dengan resi. Pesanan selesai saat semua barangnya diterima.

Semua nominal disimpan sebagai bilangan bulat (rupiah, atau satuan terkecil mata uang asing). Kurs disimpan dalam satuan mikro supaya tidak ada pembulatan floating point.

## Multi-tenant

- Setiap tabel data toko punya kolom `tenant_id`. Route seller berada di `/api/t/:tenantId/*` dan middleware `requireTenant` memastikan user adalah anggota toko itu.
- Service menerima `tenantId` dan selalu memfilter dengannya; ID dari URL tidak pernah dipakai tanpa filter tenant.
- Peran `owner`, `admin`, dan `staff`, dengan izin tambahan `money` dan `reports` untuk staf (`packages/shared/src/perm.ts`).

## Login

Google tidak mengizinkan redirect URI wildcard, jadi semua callback OAuth mendarat di `accounts.{domain}`. Dari sana user diserahkan ke host tujuan (`app.` atau subdomain toko) lewat kode sekali pakai berumur 60 detik. Kode itu di-hash bersama cookie yang dipasang saat login dimulai, sehingga hanya berlaku di browser yang sama. Sesi seller dan sesi pelanggan memakai cookie host-only masing-masing.

## Notifikasi

Push dikirim tanpa payload. Service worker lalu mengambil pesan terbaru dari `/api/push/inbox`, sehingga Worker tidak perlu mengenkripsi payload dan iOS tetap menampilkan notifikasi. Email dan WhatsApp Cloud API dikirim kalau integrasinya aktif.

## Batasan yang disengaja

- Pembayaran manual (transfer, QRIS statis) tetap butuh verifikasi manusia. Hanya QRIS lewat Xendit yang tercatat otomatis.
- Menyambungkan pesanan ke akun Google cukup dengan memiliki link pesanan (yang bertoken). Link pesanan sebaiknya diperlakukan seperti kata sandi.
- Free plan Workers membatasi CPU per request, jadi verifikasi tanda tangan ID token Google dilewati. Token diambil langsung dari endpoint token Google lewat TLS, dan klaim `aud`, `iss`, `exp`, serta `email_verified` tetap dicek.
