# Memulai

Panduan menjalankan Bawaan di komputer sendiri. Semua layanan Cloudflare (D1, R2, KV, rate limiter) disimulasikan lokal oleh Miniflare, jadi tidak perlu akun Cloudflare untuk mencoba.

## Prasyarat

- Node.js 22 (`nvm use` membaca `.nvmrc`)
- pnpm 10 (`corepack enable` sudah cukup)

## Langkah

```bash
pnpm install
cp apps/web/.dev.vars.example apps/web/.dev.vars
pnpm db:migrate:local
pnpm dev
```

Di `apps/web/.dev.vars`, minimal isi `APP_SECRET` dengan 32 karakter acak atau lebih:

```bash
openssl rand -hex 32
```

Worker sengaja menolak jalan kalau `APP_SECRET` kosong atau terlalu pendek, karena secret itu yang menandatangani link pesanan pelanggan.

## Membuka tiap permukaan

Satu Worker melayani semua host. Di lokal, subdomain `*.localhost` langsung dikenali browser modern:

| Alamat | Isi |
|---|---|
| `http://localhost:5173` | Landing page |
| `http://app.localhost:5173` | Aplikasi seller |
| `http://<slug>.localhost:5173` | Toko online seller dengan slug itu |

Kalau browser atau alat yang dipakai tidak mendukung `*.localhost`, tambahkan `?host=app` atau `?host=<slug>` di URL. Worker menyimpan pilihan itu di cookie. Override ini hanya aktif di luar production.

## Login

Tanpa `GOOGLE_CLIENT_ID`, halaman login menampilkan **dev login**: masukkan email apa pun lalu langsung masuk. Endpoint `/api/auth/dev-login` hanya ada saat `ENVIRONMENT=development`.

Untuk mencoba login Google sungguhan, buat OAuth client tipe *Web application* di Google Cloud Console, lalu isi `GOOGLE_CLIENT_ID` dan `GOOGLE_CLIENT_SECRET`. Di lokal, callback memakai origin tempat login dimulai, jadi daftarkan redirect URI `http://app.localhost:5173/api/auth/google/callback` (dan `http://<slug>.localhost:5173/...` kalau ingin mencoba login pelanggan).

## Notifikasi push (opsional)

```bash
node apps/web/scripts/vapid-keys.mjs >> apps/web/.dev.vars
```

## Integrasi opsional

Email, Apple, kurir, domain sendiri, QRIS per toko, WhatsApp Cloud API, dan gateway paket Pro hanya aktif kalau namanya ada di `FEATURES` (mis. `FEATURES=email,qris`) dan secret-nya terisi. Daftar variabelnya ada di `apps/web/.dev.vars.example`.

## Test

```bash
pnpm typecheck
pnpm test                    # Vitest di runtime Workers, D1 dimigrasi dari folder migrations/
pnpm e2e                     # Playwright di 6 profil perangkat
pnpm e2e --update-snapshots  # perbarui baseline screenshot (render di macOS)
```

CI menjalankan e2e dengan `--ignore-snapshots` karena render font di Linux berbeda dari baseline macOS.

## Mengubah database

1. Ubah skema di `apps/web/worker/db/schema.ts`.
2. Tambahkan file migrasi baru di `migrations/` dengan nomor berikutnya. Jangan mengubah migrasi yang sudah dirilis.
3. Jalankan `pnpm db:migrate:local`.
