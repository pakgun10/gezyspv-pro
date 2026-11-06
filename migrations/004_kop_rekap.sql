-- 004_kop_rekap.sql — Gambar kop laporan + menu Rekap (keputusan Pak Gun 2026-11-06).
--
-- 1. Kop laporan: settings.kop_path menyimpan nama berkas gambar kop
--    (PNG/JPEG, maks 2 MB) yang diunggah admin di /admin/pengaturan.
--    Berkasnya di data/kop/kop-<timestamp>.<ext>, dilayani lewat GET /kop.
--    Bila NULL, halaman Cetak dan cetakan rekap memakai kop teks lama
--    (nama + alamat sekolah dari settings) — tidak ada perubahan perilaku.
-- 2. Menu Rekap + tombol cetak di rekap TIDAK butuh perubahan skema
--    (hanya route + tampilan); migrasi ini hanya menambah kolom kop_path.
--
-- Aman diulang: ADD COLUMN IF NOT EXISTS.

ALTER TABLE settings ADD COLUMN IF NOT EXISTS kop_path VARCHAR(255) NULL;
