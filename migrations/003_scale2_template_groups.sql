-- 003_scale2_template_groups.sql — Skala 2 + kelompok templat (keputusan Pak Gun 2026-11-06).
--
-- 1. Skala penilaian 2 (0/1/2) untuk 4 instrumen supervisi Kurikulum
--    Merdeka (I Administrasi, II ATP, III Modul Ajar, IV Pelaksanaan).
-- 2. Kelompok templat: satu paket berisi beberapa templat
--    (template_groups + template_group_items; satu templat hanya di
--    satu kelompok) dan supervisi berkelompok (session_groups +
--    sessions.session_group_id).
--
-- PERHATIAN — cara menghapus CHECK lama (temuan 2026-11-06, MariaDB
-- 10.11.13): CHECK `score_scale` di 001 ditulis INLINE pada kolom
-- (`score_scale TINYINT ... CHECK (...)`), bukan sebagai CONSTRAINT
-- tabel. Nama yang tampil di information_schema hanyalah nama kolom,
-- dan `ALTER TABLE ... DROP CONSTRAINT IF EXISTS score_scale` menjadi
-- NO-OP untuk CHECK seperti itu — CHECK lama tetap berlaku dan
-- skala 2 tetap ditolak (ini juga yang terjadi pada CHECK `role` di
-- migrasi 002: CHECK lama `IN ('admin','supervisor','guru')` masih
-- ada sampai sekarang — tidak berbahaya karena ia superset dari yang
-- baru — tetapi JANGAN meniru pola DROP itu). Satu-satunya cara
-- menghapus CHECK inline adalah MODIFY kolom tanpa klausa CHECK.
-- Karena itu di bawah ini dipakai MODIFY, bukan DROP CONSTRAINT.
--
-- Aman diulang: semua CREATE/ADD memakai IF NOT EXISTS / IF EXISTS,
-- kecuali ADD CONSTRAINT fk_sessions_group (tanpa IF NOT EXISTS:
-- MariaDB menolak `ADD CONSTRAINT IF NOT EXISTS ... FOREIGN KEY`).
-- Idempotensi migrasi dijamin runner (nama berkas dicatat di tabel
-- `migrations`; berkas yang sudah tercatat tidak dijalankan lagi).
-- Bila berkas ini dijalankan manual dua kali, hapus dulu FK
-- fk_sessions_group bila sudah ada.

-- Skala 2: (2, 4, 10, 100). MODIFY menghapus CHECK inline lama.
ALTER TABLE templates MODIFY score_scale TINYINT NOT NULL DEFAULT 4;
ALTER TABLE templates ADD CONSTRAINT IF NOT EXISTS score_scale CHECK (score_scale IN (2, 4, 10, 100));

CREATE TABLE IF NOT EXISTS template_groups (
  id INT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS template_group_items (
  group_id INT NOT NULL,
  template_id INT NOT NULL,
  sort INT NOT NULL DEFAULT 0,
  PRIMARY KEY (group_id, template_id),
  UNIQUE (template_id),
  FOREIGN KEY (group_id) REFERENCES template_groups(id) ON DELETE CASCADE,
  FOREIGN KEY (template_id) REFERENCES templates(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS session_groups (
  id INT AUTO_INCREMENT PRIMARY KEY,
  group_id INT NOT NULL,
  supervisor_id INT NOT NULL,
  teacher_id INT NOT NULL,
  class_id INT NOT NULL,
  period_id INT NOT NULL,
  subject_theme VARCHAR(255),
  phase_semester VARCHAR(100),
  observed_at DATE NOT NULL,
  observed_time VARCHAR(50),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (group_id) REFERENCES template_groups(id),
  FOREIGN KEY (supervisor_id) REFERENCES users(id),
  FOREIGN KEY (teacher_id) REFERENCES users(id),
  FOREIGN KEY (class_id) REFERENCES classes(id),
  FOREIGN KEY (period_id) REFERENCES periods(id)
);

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS session_group_id INT NULL;
ALTER TABLE sessions ADD CONSTRAINT fk_sessions_group
  FOREIGN KEY (session_group_id) REFERENCES session_groups(id) ON DELETE SET NULL;
