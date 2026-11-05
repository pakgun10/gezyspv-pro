-- 002_role_flags.sql — Model peran "satu akun dua peran" (keputusan Pak Gun 2026-11-05).
--
-- Supervisor BUKAN lagi peran tersendiri, melainkan flag is_supervisor di
-- akun guru — sama seperti is_principal untuk Kepala Sekolah. Akun hanya
-- dua macam: admin dan guru. Satu akun guru bisa dua peran: membuat sesi
-- (sebagai supervisor) dan menjadi guru yang disupervisi di sesi lain.
--
-- Aman diulang dan aman di database yang sudah berisi data Fase 0–4:
-- ADD COLUMN / DROP CONSTRAINT / ADD CONSTRAINT memakai IF NOT EXISTS /
-- IF EXISTS, dan UPDATE konversi tidak mengubah baris yang sudah guru.
-- CHECK lama bernama `role` (dibuat inline di 001_init.sql; nama ini
-- terverifikasi di information_schema pada MariaDB 10.11.14 dan 11.8
-- dari berkas 001 yang sama). Bila di suatu database nama CHECK-nya
-- berbeda, DROP ... IF EXISTS menjadi no-op dan CHECK lama tetap ada —
-- kode tetap tidak pernah lagi memakai role 'supervisor', tetapi
-- penegakan di level database untuk role tersebut tidak berlaku di
-- database itu (lihat README bagian "Model peran").

ALTER TABLE users ADD COLUMN IF NOT EXISTS is_supervisor TINYINT(1) NOT NULL DEFAULT 0;

-- Konversi akun supervisor lama → guru + flag supervisor.
-- Akun Kepala Sekolah lama (role supervisor + is_principal=1) ikut
-- terkonversi menjadi guru + is_supervisor=1 + is_principal=1.
UPDATE users SET role = 'guru', is_supervisor = 1 WHERE role = 'supervisor';

-- CHECK role lama ('admin','supervisor','guru') → baru ('admin','guru').
ALTER TABLE users DROP CONSTRAINT IF EXISTS role;
ALTER TABLE users ADD CONSTRAINT IF NOT EXISTS role CHECK (role IN ('admin', 'guru'));
