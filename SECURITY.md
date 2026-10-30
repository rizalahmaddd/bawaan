# Kebijakan Keamanan

## Melaporkan celah keamanan

Mohon **jangan** melaporkan celah keamanan lewat issue publik.

Laporkan secara privat lewat tab **Security → Report a vulnerability** di repo ini (GitHub Private Vulnerability Reporting). Sertakan:

- jenis celah dan dampaknya,
- langkah untuk mereproduksi,
- versi atau commit yang terdampak.

Laporan akan ditanggapi secepatnya. Setelah perbaikan dirilis, pelapor akan dicantumkan di catatan rilis kalau berkenan.

## Praktik keamanan proyek

- Sesi disimpan di D1 sebagai hash SHA-256, cookie `__Host-` HttpOnly SameSite=Lax, dan bisa dicabut saat logout.
- Request yang mengubah data ditolak kalau `Origin`-nya bukan origin yang sama.
- Login Google/Apple memakai PKCE dan `state` sekali pakai; kode serah-terima login diikat ke browser yang memulai login lewat cookie.
- Setiap route seller memeriksa keanggotaan toko, peran, dan izin di server; setiap query dibatasi `tenant_id`.
- Link pesanan pelanggan ditandatangani HMAC dengan `APP_SECRET` (minimal 32 karakter; Worker menolak jalan dengan secret yang lebih pendek) dan bisa dicabut.
- Kredensial integrasi per toko disegel AES-GCM sebelum disimpan.
- Upload divalidasi ukuran dan magic bytes; bukti transfer disimpan di bucket privat dan hanya bisa dibuka anggota toko.
- Webhook memakai token bersama yang dibandingkan constant-time; token kosong selalu ditolak.
- Link dari pelanggan dibatasi `http(s)` dan endpoint Web Push dibatasi ke layanan push resmi.
- CSP tanpa `unsafe-inline` untuk script, HSTS, `frame-ancestors 'none'`, dan rate limit untuk checkout, lacak pesanan, dan upload.
- Secret hanya lewat `wrangler secret put`, tidak pernah masuk repo.

## Versi yang didukung

Perbaikan keamanan hanya dirilis untuk versi terbaru di branch `main`.
