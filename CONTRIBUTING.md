# Berkontribusi

Terima kasih sudah tertarik berkontribusi ke Bawaan!

## Alur

1. Buka issue dulu untuk perubahan besar, supaya arahnya disepakati sebelum mulai coding.
2. Fork repo, buat branch dari `main`.
3. Jalankan project di lokal mengikuti [docs/getting-started.md](./docs/getting-started.md).
4. Pastikan semua cek lolos sebelum membuat pull request:

   ```bash
   pnpm typecheck
   pnpm test
   pnpm e2e --ignore-snapshots
   ```

5. Kalau mengubah `apps/web/worker/db/schema.ts`, tambahkan file migrasi baru di `migrations/` (jangan mengubah migrasi yang sudah ada).
6. Kalau mengubah tampilan, perbarui baseline screenshot dengan `pnpm e2e --update-snapshots` di macOS.

## Panduan kode

- TypeScript strict, tanpa `any` implisit.
- Teks yang terlihat pengguna memakai Bahasa Indonesia; kode, komentar, dan commit memakai bahasa Inggris atau Indonesia secara konsisten.
- Logika yang dipakai client dan server (uang, kurs, skema input) ditaruh di `packages/shared` dan diberi test.
- Setiap query di route seller wajib dibatasi `tenant_id`; cek izin di server, bukan hanya menyembunyikan tombol.
- Tulis komentar hanya untuk menjelaskan *alasan*, bukan mengulang apa yang dilakukan kode.
- Jangan pernah meng-commit secret, `.dev.vars`, atau hasil `wrangler secret`.
- Jangan menambah dependency baru kalau bisa diselesaikan dengan API platform (Workers, D1, R2, KV).

## Melaporkan bug

Gunakan template **Laporan bug** saat membuat issue. Sertakan langkah reproduksi, perangkat/browser, dan pesan error. Untuk celah keamanan, ikuti [SECURITY.md](./SECURITY.md).
