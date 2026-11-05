# gezyspv-pro — Implementation Plan (DRAF)

Aplikasi supervisi akademik berbasis web, mengikuti pola GezyAsko:
supervisor mengobservasi guru secara langsung saat pembelajaran
berlangsung, lalu berdiskusi (pra dan pasca) dan menyusun rencana
tindak lanjut. Bukan CBT, bukan penilaian murid.

Nama aplikasi: **gezyspv-pro**. Repo:
`https://github.com/pakgun10/gezyspv-pro.git` (terverifikasi kosong,
2026-11-05 — belum ada commit). Domain: **spv.pakgun.web.id**
(keputusan Pak Gun 2026-11-05). Sekolah: **SMPN 1 Punggur** (nama
sekolah dan tempat tanda tangan bisa diubah di pengaturan).

Dokumen ini adalah rencana pembangunan. Belum ada kode aplikasi
sampai Pak Gun menyetujui plan ini dan memerintahkan pembangunan.
Semua keputusan di bawah ini berasal dari jawaban Pak Gun
2026-11-05 atau adalah default yang saya usulkan agar bisa dikoreksi
baris per baris — bukan keputusan final.

Sumber instrumen: `INSTRUMEN_SUPERVISI_AKADEMIK_PEMBELAJARAN.docx`
("Instrumen Supervisi Akademik Pembelajaran Berbasis Pola Pikir
Bertumbuh / Growth Mindset (PPB/GM)"), dibaca tuntas 2026-11-05:
47 paragraf, 3 tabel, tanpa header/footer/komentar/gambar. Isi
lengkapnya dipetakan ke model data di bagian 2.

## 1. Keputusan yang sudah terkunci

1. **Single-tenant, satu instalasi = satu sekolah** (SMPN 1
   Punggur). Tidak ada `school_id`, tidak ada middleware tenant,
   tidak ada berbagi antar sekolah. Sama seperti GezyAsko.
2. **Nama sekolah ditulis sendiri oleh admin** di pengaturan
   (default "SMPN 1 Punggur") dan bisa diubah. Aplikasi generik
   sejak MVP; label jenjang/tingkat adalah teks bebas, bukan enum.
3. **Stack: Bun + Elysia + MariaDB** (keputusan Pak Gun 2026-11-05).
   Dinilai tepat: Elysia adalah framework yang memang dibangun
   untuk Bun (cepat, tipe aman); MariaDB adalah database server
   sungguhan — tulis bersamaan dari banyak pengguna, integritas
   relasional, dan backup `mysqldump` yang rapi — cocok untuk
   aplikasi yang dipakai banyak supervisor dan guru sekaligus.
   Foto disimpan sebagai berkas di disk (bukan blob di database);
   MariaDB hanya menyimpan metadatanya. Konsekuensi: VPS butuh
   server MariaDB + satu database + satu user khusus aplikasi
   (dibuat saat deploy pertama).
4. **Peran hanya tiga:** `admin`, `supervisor`, `guru`.
   - `admin`: Pak Gun. Kelola guru, kelas, periode, templat
     instrumen, penugasan supervisor, dan backup. Admin bukan
     supervisor dan bukan guru yang disupervisi.
   - `supervisor`: kepala sekolah, wakasek/pengawas, dan guru yang
     ditunjuk/ditugaskan oleh Kepala Sekolah. Admin yang mengatur
     penugasan ini: admin membuat akun supervisor dan menetapkan
     guru mana saja yang disupervisi oleh supervisor itu (tabel
     `supervisor_assignments`, ditegakkan di server). Satu sesi
     punya tepat satu supervisor. **Pengecualian: Kepala Sekolah
     (akun supervisor dengan flag `is_principal`) bisa
     mensupervisi semua guru tanpa penugasan.**
   - `guru`: guru yang disupervisi. Melihat hasil supervisi dirinya
     sendiri saja, tidak bisa melihat hasil guru lain, tidak bisa
     mengisi skor untuk dirinya sendiri — tetapi **boleh mengetik
     sendiri refleksi pasca-observasinya** pada sesinya (keputusan
     Pak Gun 2026-11-05, lihat bagian 7).
5. **Satu sesi supervisi = satu guru, satu kelas, satu kali
   observasi.** Tidak ada kelompok murid di aplikasi ini — unit yang
   dinilai adalah guru, bukan murid. Data murid tidak masuk aplikasi.
6. **Instrumen sepenuhnya templat (data, bukan kode).** Elemen,
   indikator, pertanyaan pra/pasca, butir tindak lanjut, prinsip,
   label skala, skala penilaian, dan rentang predikat semuanya
   tersimpan di database dan bisa diubah admin. Inilah jawaban atas
   syarat Pak Gun bahwa elemen dan butir bisa berganti tiap tahun:
   ganti templat, bukan ganti kode.
7. **Snapshot instrumen per sesi.** Saat sesi dibuat, seluruh isi
   templat disalin menjadi snapshot sesi itu. Skor dan catatan selalu
   merujuk ke snapshot, sehingga edit templat belakangan tidak pernah
   mengubah riwayat supervisi yang sudah berjalan.
8. **Pergantian tahun = salin templat.** Admin menyalin templat lama
   ("Salin untuk tahun ajaran baru"), mengedit salinannya, lalu
   mengaktifkan yang baru dan mengarsipkan yang lama. Templat punya
   status `draf` / `aktif` / `arsip`; sesi baru hanya boleh memakai
   templat `aktif`.
9. **Rekap selalu menampilkan angka, nilai akhir selalu skala 100,
   dan ada predikat.** Setiap rekap menampilkan rata-rata skala dan
   skor 0–100 berdampingan, plus predikat dari rentang yang diatur
   di templat. Templat mengatur skala penilaian indikator — opsi
   **skala 4, skala 10, atau skala 100** — dan rentang predikatnya.
   **Rentang predikat bisa diubah oleh admin atau supervisor.**
   Rumus ada di bagian 6. Instrumen kertasnya sendiri tidak punya
   rumus skor — rumus di bagian 6 adalah usulan yang sudah
   disetujui polanya oleh Pak Gun (nilai akhir skala 100 +
   predikat); rentang predikat default di bagian 6 sudah disetujui
   dan bisa diubah admin atau supervisor.
10. **Narasi otomatis, bisa diedit, lalu cetak PDF lewat cetak
    HTML.** Narasi dibuat dari skor per elemen plus catatan, bisa
    diedit supervisor sebelum cetak, dan hasil edit disimpan. Ekspor
    Word menyusul di fase berikutnya.
11. **Login memakai username + kata sandi**, bukan email. Akun dibuat
    manual oleh admin dan bisa juga diimpor lewat CSV.
12. **Bukti: catatan teks + foto.** Kolom "Catatan Bukti Spesifik /
    Perilaku Teramati" di instrumen kertas adalah teks — itu tetap
    ada per indikator. Ditambah foto bukti saat supervisi: kompresi
    di sisi klien sampai maksimal 5 MB per berkas, maksimal 5 foto
    per sesi, disimpan di folder data di luar repo; video tidak
    diunggah sebagai berkas di MVP, hanya URL video yang ditempel
    (pola GezyAsko).
13. **Tanda tangan hanya garis cetak.** Halaman cetak menampilkan
    blok tanda tangan (Kepala, Guru, Supervisor + NIP) seperti di
    kertas. Tidak ada tanda tangan digital di MVP.
14. **Offline ditunda ke fase berikutnya.** MVP sepenuhnya online.
15. **Tampilan modern, bersih, UI/UX bagus, responsif.** Mobile-first
    untuk HP, rapi di tablet dan laptop, dan tetap terbaca di layar
    besar / PID (lihat bagian 3).
16. **Impor CSV transaksional** (pelajaran dari GezyAspro dan
    GezyRaport): bila satu baris tidak valid, seluruh impor
    dibatalkan dan admin diberi daftar baris yang bermasalah.

## 2. Pemetaan instrumen kertas → model data

Setiap bagian dokumen dipetakan ke templat + sesi. Templat bawaan
(seed) bernama **"Supervisi Akademik PPB/GM 2026/2027"** berisi isi
dokumen ini persis — jadi begitu aplikasi jalan, supervisi sudah bisa
dilakukan dengan instrumen kertas yang ada, tanpa mengisi apa pun.

| Bagian kertas | Di aplikasi | Isi (dari dokumen) |
|---|---|---|
| Judul + basis | `templates.title` + `templates.basis` | "Instrumen Supervisi Akademik Pembelajaran", basis "Pola Pikir Bertumbuh / Growth Mindset (PPB/GM)" |
| Informasi umum (8 kolom) | Kolom sesi, lihat bawah | Nama Sekolah (dari pengaturan, default SMPN 1 Punggur), Nama Supervisor, Nama Guru, Kelas / Kelompok, Hari / Tanggal, Tema / Sub Tema (Mata pelajaran), Fase / Semester, Waktu Observasi |
| I. Prinsip (3 butir) | `template_principles` + snapshot | 1) Pendekatan Kemitraan (Coaching); 2) Berfokus pada Proses & Strategi; 3) Penerapan The Power of YET |
| II. Pra-observasi (5 pertanyaan) | `template_questions` tahap `pra` + snapshot | Q1 tujuan pembelajaran; Q2 penyisipan PPB/GM dalam modul/RPP; Q3 area spesifik yang ingin diamati; Q4 tantangan yang diperkirakan; Q5 strategi membantu anak kesulitan tanpa memberi jawaban |
| III. Observasi (skala 1–4) | `template_scale_levels` + snapshot | 1 = Belum Teramati; 2 = Mulai Teramati (Perlu Penguatan); 3 = Teramati dengan Baik; 4 = Sangat Teramati & Menginspirasi |
| III. Elemen A–D, 11 indikator | `template_elements` + `template_indicators` + snapshot | A Iklim Belajar Ramah Pertumbuhan (indikator 1–3); B Bahasa & Umpan Balik Guru (4–6); C Fasilitasi Tantangan & Resiliensi Siswa (7–9); D Refleksi Proses & Kesadaran Belajar Siswa (10–11). Teks tiap indikator disalin verbatim dari dokumen, termasuk istilah Inggris dalam kurung |
| IV. Pasca-observasi (5 pertanyaan) | `template_questions` tahap `pasca` + snapshot | Q1 perasaan & hal yang berjalan paling baik; Q2 momen anak gigih/belajar dari kesalahan; Q3 momen umpan balik hasil yang diubah jadi umpan balik proses; Q4 tantangan yang belum sesuai harapan; Q5 strategi baru untuk sesi berikutnya |
| V. Tindak lanjut (3 butir) | `template_rtl_items` + snapshot | 1) Apresiasi Supervisor atas Usaha & Praktik Baik Guru; 2) Area Pengembangan Fokus Pembelajaran PPB/GM Selanjutnya; 3) Dukungan/Fasilitasi yang Dibutuhkan dari Sekolah/Supervisor. Masing-masing dengan kolom Catatan |
| Penutup | Halaman cetak | Tempat + tanggal (tempat dari pengaturan, default "Seputih Agung"; tanggal dari sesi), blok tanda tangan Kepala / Guru / Supervisor + NIP |

Catatan pemetaan:

- **Nama Sekolah** tidak diisi per sesi — diambil dari pengaturan,
  seperti kop di GezyAsko. **Nama Supervisor** adalah nama akun
  supervisor pembuat sesi. **Nama Guru** adalah akun guru yang
  disupervisi (dipilih dari data guru, bukan ketik bebas).
- **Kelas / Kelompok, Tema / Sub Tema (Mata pelajaran), Fase /
  Semester, Waktu Observasi** adalah teks bebas per sesi. Kelas
  juga terikat ke data kelas (`classes`) supaya rekap per kelas
  bisa jalan; label kelasnya teks bebas ("7.1", "TK B1", dst).
- **Hari / Tanggal** adalah tanggal observasi (`observed_at`); hari
  dihitung otomatis dari tanggal, tidak diketik.
- Judul dokumen tertulis "NSTRUMEN" (huruf I hilang) — itu typo di
  berkas sumber dan **tidak** dibawa ke seed templat; judul templat
  memakai ejaan yang benar.
- Bahasa instrumen memakai "anak", "main", "eksperimen" — label dan
  teks templat dipertahankan apa adanya; aplikasi tidak mengunci
  jenjang.

## 3. Stack dan struktur proyek

- Runtime: Bun. Framework: **Elysia** (Bun-native, tipe aman
  end-to-end, plugin; menggantikan Hono dari pola GezyAsko karena
  keputusan stack Pak Gun).
- Database: **MariaDB** (server). Akses lewat driver `mysql2`
  (pool koneksi). Migrasi berupa berkas SQL bernomor di
  `migrations/` yang dijalankan berurutan saat start; tabel
  `migrations` mencatat yang sudah diterapkan.
- Foto bukti disimpan di folder data di luar repo, misalnya
  `DATA_DIR/bukti/` (nilai default `./data/bukti/`), bukan di dalam
  repo dan bukan folder statis publik.
- Kata sandi memakai `Bun.password` (argon2id). Cookie sesi
  `HttpOnly`, `SameSite=Lax`, `Secure` di produksi.
- Frontend: HTML dari server (Elysia + `@elysiajs/html`) + htmx +
  sedikit JS vanilla + **Tailwind CSS v4** (dibangun dengan Bun,
  bukan CDN) + design token sendiri (warna, radius, tipografi).
  Tanpa framework SPA, tanpa pustaka grafik; grafik memakai SVG
  inline.
- Bahasa antarmuka: Indonesia.
- **UI/UX (keputusan Pak Gun): modern, bersih, UI/UX bagus,
  responsif HP, tablet, laptop, sampai PID.** Mobile-first: grid
  skor 1–4 berupa tombol sentuh besar yang bisa ditekan dengan
  satu tangan di HP; di tablet/laptop tampil sebagai tabel lebar
  yang rapi; di layar besar/PID (≥1280px, sampai TV 52 inci)
  tipografi dan tombol membesar lewat breakpoint khusus, dan
  dasbor/rekap memakai layout kolom lebar. Satu basis kode, tidak
  ada versi tampilan terpisah per perangkat. Warna: netral bersih
  dengan satu aksen (teal, mengikuti keluarga GezyAsko) — bukan
  ramai, bukan gelap.

Struktur yang diusulkan:

```text
gezyspv-pro/
  implementation_plan.md
  package.json
  src/
    index.ts            # entrypoint Elysia, static, error handler
    db.ts               # pool MariaDB, migrasi, helper query
    auth.ts             # login, sesi, hash, middleware peran
    rbac.ts             # cek hak: admin / supervisor penugasan / guru pemilik sesi
    lib/
      scores.ts         # rumus skor + predikat (bagian 6), tanpa dependensi HTTP
      narrative.ts      # generator narasi dari skor + catatan
      csv.ts            # parser + validasi impor (transaksional)
      evidence.ts       # nama berkas aman, cek mime/ukuran
    routes/
      auth.ts           # /login, /logout, /ganti-sandi
      dashboard.ts      # /
      sessions.ts       # /supervisi, /supervisi/:id, tahapan pra/observasi/pasca/rtl
      templates.ts      # /admin/templat, /admin/templat/:id/edit, salin, arsip
      teachers.ts       # /guru/:id (profil perkembangan guru)
      recaps.ts         # /rekap/*, /cetak/:sessionId
      evidence.ts       # /bukti/:id (wajib login + cek hak)
      admin.ts          # /admin/*, /admin/backup, /admin/penugasan
  migrations/
    001_init.sql        # skema awal (bagian 5)
  public/
    css/app.css         # Tailwind v4 + design token (dibangun ke public/dist/)
    js/supervisi.js     # interaksi grid skor (mobile-first)
    js/kompres-foto.js  # kompresi foto klien ke <= 5 MB
  data/                 # gitignored: bukti foto (di VPS via DATA_DIR)
  tests/                # bun test
  deploy/
    gezyspv-pro.service # systemd (contoh, disesuaikan VPS Pak Gun)
    backup.sh           # mysqldump + arsip folder bukti
  templates-impor/
    guru.csv
    kelas.csv
```

## 4. Peran dan hak (matriks)

| Rute / aksi | admin | supervisor | guru |
|---|:---:|:---:|:---:|
| Kelola guru, kelas, periode | Ya | Tidak | Tidak |
| Kelola templat (buat/edit/salin/arsip, skala, predikat) | Ya | Ubah rentang predikat: Ya; lainnya Tidak | Tidak |
| Kelola penugasan supervisor → guru | Ya | Tidak | Tidak |
| Buat sesi supervisi | Tidak | Ya, hanya guru yang ditugaskan padanya (kecuali Kepala Sekolah: semua guru) | Tidak |
| Isi pra-observasi | Tidak | Ya, sesi buatannya | Tidak |
| Isi skor observasi + bukti teks/foto | Tidak | Ya, sesi buatannya | Tidak |
| Isi refleksi pasca-observasi | Tidak | Tidak (hanya membaca + menambah catatan) | Ya, hanya sesi atas dirinya |
| Tambah catatan supervisor pada pasca-observasi | Tidak | Ya, sesi buatannya | Tidak |
| Isi tindak lanjut | Tidak | Ya, sesi buatannya | Tidak |
| Lihat hasil supervisi | Ya, semua | Ya, semua | Ya, hanya sesi atas dirinya |
| Lihat rekap guru / rekap sekolah | Ya | Ya | Ya, hanya rekap dirinya |
| Cetak laporan sesi | Ya | Ya | Ya, hanya sesinya sendiri |
| Backup / restore | Ya | Tidak | Tidak |

Aturan ini ditegakkan di server, bukan hanya disembunyikan di tombol
antarmuka. Supervisor hanya boleh membuat sesi untuk guru yang
ditugaskan padanya (cek `supervisor_assignments`) — kecuali Kepala
Sekolah (`users.is_principal = 1`), yang boleh membuat sesi untuk
guru mana pun tanpa penugasan — dan hanya boleh mengubah sesi yang
dibuatnya sendiri; supervisor lain tidak bisa mengedit sesi itu
(tetapi bisa membacanya).

Alur pengisian: pra-observasi dicatat supervisor dari diskusi
perencanaan; skor observasi dan bukti diisi supervisor di kelas;
**refleksi pasca-observasi diketik sendiri oleh guru** pada sesinya
— supervisor membaca refleksi itu dan menambahkan catatan
supervisornya per pertanyaan; tindak lanjut ditulis supervisor.
Guru tidak bisa mengubah skor atau tindak lanjut.

## 5. Skema database (final untuk MVP, dialek MariaDB)

Perubahan penting dibanding pola GezyAsko: tidak ada murid,
kelompok, dan kerangka/tujuan; sebagai gantinya ada penugasan
supervisor, templat bertahap (pra/pasca/RTL) dengan skala dan
predikat yang bisa diatur, snapshot per sesi, refleksi guru yang
terpisah dari catatan supervisor, dan bukti foto per sesi.

```sql
CREATE TABLE settings (
  id INT PRIMARY KEY CHECK (id = 1),
  school_name VARCHAR(255) NOT NULL DEFAULT 'SMPN 1 Punggur',
  school_address VARCHAR(255),
  principal_name VARCHAR(255),        -- nama Kepala Sekolah (blok tanda tangan)
  signature_place VARCHAR(255) NOT NULL DEFAULT 'Seputih Agung'
);

CREATE TABLE users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(100) NOT NULL UNIQUE, -- login; guru: username bebas (bukan NIS)
  name VARCHAR(255) NOT NULL,
  nip VARCHAR(50),                     -- tampil di blok tanda tangan bila diisi
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(20) NOT NULL CHECK (role IN ('admin', 'supervisor', 'guru')),
  is_principal TINYINT(1) NOT NULL DEFAULT 0, -- hanya untuk supervisor:
    -- 1 = Kepala Sekolah, boleh mensupervisi semua guru tanpa penugasan
  must_change_password TINYINT(1) NOT NULL DEFAULT 0,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE user_sessions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  token_hash VARCHAR(255) NOT NULL UNIQUE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL,
  last_seen_at DATETIME,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE periods (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,          -- "2026/2027 Ganjil"
  starts_on DATE, ends_on DATE,
  is_active TINYINT(1) NOT NULL DEFAULT 0 -- ditegakkan di aplikasi: tepat satu aktif
);

CREATE TABLE classes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  period_id INT NOT NULL,
  name VARCHAR(100) NOT NULL,          -- "7.1" (teks bebas)
  level_label VARCHAR(100),            -- teks bebas: "Fase A", "Kelas 7"
  UNIQUE (period_id, name),
  FOREIGN KEY (period_id) REFERENCES periods(id)
);

CREATE TABLE class_teachers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  class_id INT NOT NULL,
  user_id INT NOT NULL,
  subject_label VARCHAR(100),          -- "Matematika", "Wali kelas"
  UNIQUE (class_id, user_id, subject_label),
  FOREIGN KEY (class_id) REFERENCES classes(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Penugasan supervisor → guru (diatur admin; ditegakkan di server)
CREATE TABLE supervisor_assignments (
  supervisor_id INT NOT NULL,
  teacher_id INT NOT NULL,
  PRIMARY KEY (supervisor_id, teacher_id),
  FOREIGN KEY (supervisor_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (teacher_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Templat instrumen (dapat diubah tiap tahun)
CREATE TABLE templates (
  id INT AUTO_INCREMENT PRIMARY KEY,
  owner_id INT,
  title VARCHAR(255) NOT NULL,         -- "Supervisi Akademik PPB/GM 2026/2027"
  basis VARCHAR(255),                  -- "Pola Pikir Bertumbuh / Growth Mindset (PPB/GM)"
  version_label VARCHAR(50),           -- "2026/2027" — label tahun/versi, teks bebas
  score_scale TINYINT NOT NULL DEFAULT 4
    CHECK (score_scale IN (4, 10, 100)), -- opsi skala penilaian indikator
  status VARCHAR(20) NOT NULL DEFAULT 'draf'
    CHECK (status IN ('draf', 'aktif', 'arsip')),
  is_seed TINYINT(1) NOT NULL DEFAULT 0, -- templat bawaan dari dokumen 2026
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (owner_id) REFERENCES users(id)
);

-- Rentang predikat per templat (skala 100, bisa diatur admin)
CREATE TABLE template_predicates (
  id INT AUTO_INCREMENT PRIMARY KEY,
  template_id INT NOT NULL,
  min_score DECIMAL(5,2) NOT NULL,     -- batas bawah (inklusif)
  max_score DECIMAL(5,2) NOT NULL,     -- batas atas (inklusif)
  label VARCHAR(100) NOT NULL,         -- mis. "Sangat Baik"
  sort INT NOT NULL DEFAULT 0,
  FOREIGN KEY (template_id) REFERENCES templates(id) ON DELETE CASCADE
);

CREATE TABLE template_principles (
  id INT AUTO_INCREMENT PRIMARY KEY,
  template_id INT NOT NULL,
  text TEXT NOT NULL,
  sort INT NOT NULL DEFAULT 0,
  FOREIGN KEY (template_id) REFERENCES templates(id) ON DELETE CASCADE
);

CREATE TABLE template_elements (
  id INT AUTO_INCREMENT PRIMARY KEY,
  template_id INT NOT NULL,
  code VARCHAR(10) NOT NULL,           -- "A", "B", "C", "D" (teks bebas)
  title VARCHAR(255) NOT NULL,
  sort INT NOT NULL DEFAULT 0,
  FOREIGN KEY (template_id) REFERENCES templates(id) ON DELETE CASCADE
);

CREATE TABLE template_indicators (
  id INT AUTO_INCREMENT PRIMARY KEY,
  element_id INT NOT NULL,
  text TEXT NOT NULL,                  -- teks indikator verbatim dari dokumen
  sort INT NOT NULL DEFAULT 0,
  FOREIGN KEY (element_id) REFERENCES template_elements(id) ON DELETE CASCADE
);

CREATE TABLE template_scale_levels (
  id INT AUTO_INCREMENT PRIMARY KEY,
  template_id INT NOT NULL,
  v INT NOT NULL,                      -- 1..score_scale (skala 100: 0..100)
  label VARCHAR(255) NOT NULL,         -- "Belum Teramati", dst.
  UNIQUE (template_id, v),
  FOREIGN KEY (template_id) REFERENCES templates(id) ON DELETE CASCADE
);

CREATE TABLE template_questions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  template_id INT NOT NULL,
  stage VARCHAR(10) NOT NULL CHECK (stage IN ('pra', 'pasca')),
  text TEXT NOT NULL,
  sort INT NOT NULL DEFAULT 0,
  FOREIGN KEY (template_id) REFERENCES templates(id) ON DELETE CASCADE
);

CREATE TABLE template_rtl_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  template_id INT NOT NULL,
  title VARCHAR(255) NOT NULL,
  sort INT NOT NULL DEFAULT 0,
  FOREIGN KEY (template_id) REFERENCES templates(id) ON DELETE CASCADE
);

-- Sesi supervisi: satu guru, satu kelas, satu kali observasi
CREATE TABLE sessions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  template_id INT,
  supervisor_id INT NOT NULL,
  teacher_id INT NOT NULL,
  class_id INT NOT NULL,
  period_id INT NOT NULL,
  subject_theme VARCHAR(255),          -- Tema / Sub Tema (Mata pelajaran)
  phase_semester VARCHAR(100),         -- Fase / Semester
  observed_at DATE NOT NULL,           -- tanggal observasi
  observed_time VARCHAR(50),           -- Waktu Observasi, mis. "08.00–09.30"
  status VARCHAR(20) NOT NULL DEFAULT 'pra'
    CHECK (status IN ('pra', 'observasi', 'pasca', 'tindak_lanjut', 'selesai')),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (template_id) REFERENCES templates(id),
  FOREIGN KEY (supervisor_id) REFERENCES users(id),
  FOREIGN KEY (teacher_id) REFERENCES users(id),
  FOREIGN KEY (class_id) REFERENCES classes(id),
  FOREIGN KEY (period_id) REFERENCES periods(id)
);

-- Snapshot instrumen saat sesi dibuat. Skor selalu merujuk ke
-- snapshot, sehingga edit templat belakangan tidak mengubah riwayat.
CREATE TABLE session_principles (
  id INT AUTO_INCREMENT PRIMARY KEY,
  session_id INT NOT NULL,
  text TEXT NOT NULL,
  sort INT NOT NULL DEFAULT 0,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE TABLE session_indicators (
  id INT AUTO_INCREMENT PRIMARY KEY,
  session_id INT NOT NULL,
  source_indicator_id INT,
  element_code VARCHAR(10) NOT NULL,
  element_title VARCHAR(255) NOT NULL,
  text TEXT NOT NULL,
  sort INT NOT NULL DEFAULT 0,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (source_indicator_id) REFERENCES template_indicators(id)
);

CREATE TABLE session_scale_levels (
  id INT AUTO_INCREMENT PRIMARY KEY,
  session_id INT NOT NULL,
  v INT NOT NULL,
  label VARCHAR(255) NOT NULL,
  UNIQUE (session_id, v),
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE TABLE session_predicates (
  id INT AUTO_INCREMENT PRIMARY KEY,
  session_id INT NOT NULL,
  min_score DECIMAL(5,2) NOT NULL,
  max_score DECIMAL(5,2) NOT NULL,
  label VARCHAR(100) NOT NULL,
  sort INT NOT NULL DEFAULT 0,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE TABLE session_questions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  session_id INT NOT NULL,
  source_question_id INT,
  stage VARCHAR(10) NOT NULL CHECK (stage IN ('pra', 'pasca')),
  text TEXT NOT NULL,
  sort INT NOT NULL DEFAULT 0,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (source_question_id) REFERENCES template_questions(id)
);

CREATE TABLE session_rtl_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  session_id INT NOT NULL,
  source_rtl_item_id INT,
  title VARCHAR(255) NOT NULL,
  sort INT NOT NULL DEFAULT 0,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (source_rtl_item_id) REFERENCES template_rtl_items(id)
);

CREATE TABLE pra_responses (
  session_id INT NOT NULL,
  session_question_id INT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (session_id, session_question_id),
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (session_question_id) REFERENCES session_questions(id)
);

CREATE TABLE observation_scores (
  session_id INT NOT NULL,
  session_indicator_id INT NOT NULL,
  value INT,                           -- 1..score_scale, NULL = belum diisi
  evidence TEXT NOT NULL DEFAULT '',   -- Catatan Bukti Spesifik / Perilaku Teramati
  PRIMARY KEY (session_id, session_indicator_id),
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (session_indicator_id) REFERENCES session_indicators(id)
);

-- Refleksi pasca: guru menulis sendiri, supervisor menambah catatan
CREATE TABLE pasca_responses (
  session_id INT NOT NULL,
  session_question_id INT NOT NULL,
  guru_note TEXT NOT NULL DEFAULT '',
  supervisor_note TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (session_id, session_question_id),
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (session_question_id) REFERENCES session_questions(id)
);

CREATE TABLE growth_plan (
  session_id INT NOT NULL,
  session_rtl_item_id INT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (session_id, session_rtl_item_id),
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (session_rtl_item_id) REFERENCES session_rtl_items(id)
);

-- Bukti foto / URL video per sesi (maks 5 foto per sesi)
CREATE TABLE evidence (
  id INT AUTO_INCREMENT PRIMARY KEY,
  session_id INT NOT NULL,
  kind VARCHAR(20) NOT NULL CHECK (kind IN ('foto', 'video_url')),
  path VARCHAR(255),                   -- foto: nama berkas hasil generate server
  url VARCHAR(500),                    -- video_url: tautan https yang ditempel
  caption VARCHAR(200),
  mime VARCHAR(100), bytes INT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((kind = 'foto' AND path IS NOT NULL) OR (kind = 'video_url' AND url IS NOT NULL)),
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

-- Narasi tersimpan per sesi; hasil edit supervisor tidak ditimpa
-- regenerasi otomatis kecuali supervisor menekan "Buat ulang narasi".
CREATE TABLE report_narratives (
  session_id INT PRIMARY KEY,
  narrative TEXT NOT NULL,
  edited_by INT,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (edited_by) REFERENCES users(id)
);

CREATE TABLE audit_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT,
  action VARCHAR(100) NOT NULL,       -- mis. "score.create", "score.update", "session.status"
  entity VARCHAR(50), entity_id INT,
  detail TEXT,                         -- JSON ringkas
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX idx_sessions_teacher ON sessions(teacher_id, observed_at);
CREATE INDEX idx_sessions_period ON sessions(period_id, observed_at);
CREATE INDEX idx_sessions_class ON sessions(class_id, observed_at);
```

Aturan validasi nilai (ditegakkan di server, diuji otomatis):

- `observation_scores.value` harus sama persis dengan salah satu
  `v` di `session_scale_levels` sesi itu, atau NULL (belum diisi).
  Untuk skala 100, `v` yang valid adalah 0–100.
- Sesi boleh disimpan sebagian (beberapa indikator kosong), tetapi
  status tidak bisa maju ke `selesai` sebelum semua indikator
  berskor terisi, semua refleksi guru terisi, dan ketiga butir
  tindak lanjut terisi.
- Template `arsip` tidak bisa dipakai untuk sesi baru dan tidak bisa
  diedit (menyalinnya masih bisa). Template `draf` bisa diedit,
  tetapi belum bisa dipakai untuk sesi baru.
- Menghapus template yang sudah pernah dipakai sesi ditolak — yang
  bisa dilakukan hanya mengarsipkan. Riwayat sesi tidak pernah
  dihapus lewat penghapusan templat.
- Bukti foto: server menolak berkas > 5 MB, mime di luar
  jpg/png/webp, dan nama berkas dari pengguna. Server menyimpan
  dengan nama hasil generate (UUID + ekstensi aman) dan menghapus
  berkas fisiknya saat baris evidence dihapus. URL video hanya
  disimpan sebagai tautan https dan ditampilkan sebagai tautan,
  bukan unduhan dari server. Maksimal 5 foto per sesi.

## 6. Rumus skor dan rekap (selalu ada angka)

Definisi ini mengikat dan harus diimplementasikan persis di
`scores.ts` serta diuji dengan `bun test`. Perlu diingat: dokumen
kertasnya tidak mendefinisikan rumus apa pun — pola di bawah ini
sudah disetujui Pak Gun (nilai akhir selalu skala 100 + predikat
yang bisa diatur); rentang predikat default di bawah ini masih
boleh dikoreksi.

- `score_scale` satu sesi = skala templat snapshot sesi itu (4, 10,
  atau 100). Untuk templat seed: 4.
- **Skor satu indikator** = `value` apa adanya (1–4, 1–10, atau
  0–100 sesuai skala).
- **Skor satu elemen** = rata-rata `value` indikator yang terisi di
  elemen itu.
- **Skor keseluruhan sesi** = rata-rata `value` semua indikator yang
  terisi di sesi itu.
- **Skor 0–100** = `skor / score_scale * 100`, untuk skor elemen
  maupun skor keseluruhan. Contoh (skala 4): rata-rata 3,25 tampil
  sebagai "3,25 dari 4 (81 dari 100)".
- **Nilai akhir sesi** = skor keseluruhan sesi dalam skala 100.
- **Predikat sesi** = label dari `session_predicates` yang
  rentangnya memuat nilai akhir. Rentang default (disetujui Pak Gun,
  bisa diubah admin atau supervisor per templat):
  - 90–100: Sangat Baik
  - 80–89: Baik
  - 70–79: Cukup
  - 60–69: Kurang
  - 0–59: Sangat Kurang
  Bila nilai akhir jatuh di luar semua rentang (mis. admin belum
  mengatur predikat), predikat tampil sebagai "—" dan tidak
  dikarang.
- **Distribusi per indikator:** berapa kali tiap label level muncul
  di semua sesi guru itu dalam satu periode.
- **Skor guru per periode:** rata-rata nilai akhir dari semua sesi
  guru itu dalam periode tersebut, selalu ditampilkan bersama
  rincian per sesi dan predikat masing-masing, supaya campuran
  instrumen yang berbeda tidak disalahartikan sebagai satu nilai
  tunggal yang murni.
- **Tren guru:** grafik SVG: sumbu-x tanggal observasi, sumbu-y
  skor 0–100, satu titik per sesi, diberi label tema saat diarahkan.
- **Rekap sekolah per periode:** rata-rata nilai akhir per elemen
  di semua sesi, distribusi predikat, dan daftar guru yang belum
  disupervisi pada periode aktif.
- **Rekap kelas:** rata-rata nilai akhir sesi-sesi di kelas itu
  dalam periode aktif (kelas yang sama bisa punya beberapa
  guru/mapel).

## 7. Alur sesi dan peta route (MVP)

Alur satu sesi, sesuai urutan dokumen — dengan satu perubahan
penting dari kertas: refleksi pasca-observasi diketik sendiri oleh
guru (keputusan Pak Gun).

```text
Buat sesi (pilih templat aktif, guru yang ditugaskan, kelas, tema,
           fase/semester, tanggal + waktu observasi)
  → status 'pra'          supervisor isi 5 jawaban pra-observasi
                          (boleh sebagian, simpan)
  → status 'observasi'    supervisor isi skor + bukti teks per indikator
                          (grid tap, HP) + foto bukti (maks 5)
  → status 'pasca'        GURU isi sendiri 5 refleksi pasca-observasi;
                          supervisor membaca lalu menambah catatan
                          supervisor per pertanyaan
  → status 'tindak_lanjut' supervisor isi 3 catatan tindak lanjut +
                          pratinjau narasi
  → status 'selesai'      terkunci dari edit skor; narasi masih bisa diedit
                          sampai dicetak; perubahan sesudah selesai tercatat
                          di audit log
```

Status hanya bisa maju selangkah demi selangkah; supervisor bisa
kembali ke tahap sebelumnya selama sesi belum `selesai` untuk
melengkapi isian. Guru hanya bisa mengisi refleksi saat status
`pasca`; di luar itu form refleksi terkunci (tampil baca saja).
Sesi `selesai` tidak bisa dihapus.

```text
/login, /logout, /ganti-sandi
/                                  dasbor: supervisor → sesi saya + guru yang
                                   ditugaskan padanya yang belum disupervisi;
                                   guru → sesi atas diri saya (termasuk yang
                                   menunggu refleksi saya);
                                   admin → ringkasan sekolah + penugasan
/supervisi/baru                    pilih templat aktif, guru yang ditugaskan,
                                   kelas, tema, fase/semester,
                                   tanggal + waktu
/supervisi/:id                     ringkasan sesi + tahapan (pra → observasi →
                                   pasca → tindak lanjut → selesai)
/supervisi/:id/pra                 form 5 pertanyaan pra-observasi (supervisor)
/supervisi/:id/observasi           grid indikator per elemen, tap skor +
                                   bukti teks per indikator + foto bukti
/supervisi/:id/pasca               form 5 pertanyaan pasca-observasi:
                                   guru isi refleksi, supervisor isi catatan
/supervisi/:id/tindak-lanjut       form 3 butir RTL + pratinjau narasi (edit)
/supervisi/:id/cetak               pratinjau cetak: kop, identitas, prinsip,
                                   pra, observasi, pasca, RTL, narasi, foto,
                                   tanda tangan → cetak PDF via print
/guru/:id                          profil perkembangan guru: tren skor,
                                   semua sesi, distribusi per indikator,
                                   predikat per sesi
/rekap/periode/:id                 rekap sekolah per periode
/rekap/guru/:id                    rekap satu guru per periode
/bukti/:id                         berkas foto, wajib login + cek hak
                                   (bukan statis publik)
/admin                             dasbor admin
/admin/pengaturan                  nama sekolah, kepala sekolah, alamat,
                                   tempat tanda tangan
/admin/guru                        daftar, tambah manual, impor CSV
/admin/kelas                       daftar, tambah, atur guru pengampu
/admin/periode                     daftar, tambah, aktifkan (tepat satu aktif)
/admin/penugasan                   tetapkan supervisor → guru (tambah/hapus)
/admin/templat                     daftar templat + status
/admin/templat/:id/edit            edit elemen/indikator/pertanyaan/RTL/skala/
                                   label skala/predikat
/admin/templat/:id/salin           salin templat (untuk tahun ajaran baru)
/admin/backup                      unduh backup, restore (dengan konfirmasi)
/api/kesehatan                      health check tanpa login (untuk systemd/VPS)
```

## 8. Narasi, cetak, dan bukti

- Narasi dibuat otomatis per sesi dari: skor per elemen (elemen
  terkuat dan elemen yang perlu penguatan), predikat sesi, label
  skala yang paling sering muncul, dan catatan bukti/pasca/RTL.
  Kalimat narasi memakai label level apa adanya, tidak mengarang
  capaian yang tidak ada datanya.
- Supervisor bisa mengedit narasi di halaman pratinjau cetak. Hasil
  edit disimpan di `report_narratives`. Regenerasi otomatis tidak
  menimpa narasi yang sudah diedit, kecuali supervisor menekan
  "Buat ulang narasi".
- Cetak MVP: halaman cetak dengan CSS print yang mengikuti susunan
  dokumen kertas (kop sekolah dari pengaturan, identitas 8 kolom,
  prinsip, tabel pra, tabel observasi dengan skor + bukti, tabel
  pasca dengan refleksi guru dan catatan supervisor, tindak lanjut,
  narasi, tempat + tanggal, blok tanda tangan Kepala / Guru /
  Supervisor dengan NIP). Supervisor/guru mencetak lewat dialog
  print browser menjadi PDF. Tidak ada pustaka PDF server di MVP.
- Bukti foto: kompresi di klien (canvas, JPEG) sampai <= 5 MB;
  server menolak berkas > 5 MB, mime di luar jpg/png/webp, dan nama
  berkas dari pengguna. Server menyimpan dengan nama hasil generate
  (UUID + ekstensi aman) dan menghapus berkas fisiknya saat baris
  evidence dihapus. URL video hanya disimpan sebagai tautan https
  dan ditampilkan sebagai tautan, bukan unduhan dari server.

## 9. Impor CSV (pelajaran dari GezyAspro dan GezyRaport)

- Semua impor berjalan dalam satu transaksi: bila satu baris tidak
  valid, seluruh impor dibatalkan dan admin diberi daftar baris yang
  bermasalah. Tidak ada impor setengah jalan.
- Pencocokan nama memakai cocok-persis, bukan pencocokan mirip.
- `guru.csv`: kolom `username,nama,nip,password_awal`. Bila
  `password_awal` kosong, admin wajib mengisi satu kata sandi awal
  untuk batch itu di form impor; semua akun impor ditandai
  `must_change_password = 1`. NIP boleh kosong.
- `kelas.csv` (opsional): kolom `nama_kelas,level_label`. Kelas
  tujuan periode aktif; satu nama kelas hanya sekali per periode.
- Template contoh selalu tersedia untuk diunduh dari halaman impor.
- Tidak ada impor murid — aplikasi ini tidak punya data murid.

## 10. Urutan pembangunan (MVP, lalu fase berikutnya)

### Fase 0 — Fondasi

MariaDB + migrasi, auth username + kata sandi, sesi login,
middleware peran dan cek penugasan/pemilik sesi, pengaturan sekolah
(SMPN 1 Punggur, Seputih Agung), CRUD periode/kelas/guru, penugasan
supervisor → guru dan flag Kepala Sekolah, impor CSV guru dan kelas, seed templat bawaan
dari dokumen 2026 (3 prinsip, 4 elemen, 11 indikator, skala 4,
5+5 pertanyaan, 3 butir RTL, predikat default), halaman login dan
dasbor, `bun test` dasar, dan skrip backup.

### Fase 1 — Templat dan versi tahunan

CRUD templat (elemen, indikator, pertanyaan pra/pasca, butir RTL,
prinsip, label skala, skala penilaian 4/10/100, rentang predikat),
status draf/aktif/arsip, salin templat untuk tahun ajaran baru,
larangan edit templat arsip dan larangan hapus templat yang sudah
dipakai, serta snapshot templat saat sesi dibuat (diuji: edit
templat tidak mengubah sesi lama).

### Fase 2 — Sesi, pencatatan cepat, dan bukti foto

Pembuatan sesi (hanya guru yang ditugaskan), alur status pra →
observasi → pasca → tindak lanjut → selesai, grid skor per
indikator dengan target sekitar 10 detik per indikator di HP,
bukti teks per indikator, foto bukti terkompresi (maks 5 per sesi)
dan URL video, jawaban pra-observasi, refleksi pasca oleh guru +
catatan supervisor, catatan RTL, dan penyimpanan sebagian di tiap
tahap.

### Fase 3 — Profil, rekap, dan narasi

Profil guru (tren skor SVG, semua sesi, distribusi per indikator,
predikat per sesi), rekap sekolah dan rekap kelas per periode,
daftar guru yang belum disupervisi pada periode aktif, generator
narasi dan editor narasi.

### Fase 4 — Cetak, backup, dan hardening MVP

Halaman cetak PDF via print (susunan mengikuti dokumen kertas),
backup dan restore (mysqldump + arsip folder bukti, dengan
konfirmasi dan pembersihan sesi login setelah restore), audit log
perubahan skor dan status, pengujian akhir (termasuk uji tampilan
di HP, tablet, laptop, dan layar besar/PID), dan panduan deploy VPS.

### Fase berikutnya (di luar MVP)

- Tanggapan/keberatan guru atas hasil supervisi yang sudah selesai
  (tanpa mengubah skor supervisor).
- Ekspor Word (docx) memakai kembali alur pembuatan dokumen yang
  sudah dipakai Pak Gun sebelumnya.
- Antrean offline: IndexedDB + `/api/sync` idempoten, agar
  observasi di kelas bisa dicatat tanpa sinyal.
- Tanda tangan digital / foto tanda tangan, bila nanti diputuskan.

## 11. Asumsi yang saya pakai (koreksi bila salah)

- **A1 — Nama aplikasi "gezyspv-pro".** Repo
  `pakgun10/gezyspv-pro` (sudah ada, masih kosong). Domain:
  **spv.pakgun.web.id** (keputusan Pak Gun 2026-11-05).
- **A2 — Penugasan supervisor per guru, kecuali Kepala Sekolah.**
  Satu supervisor hanya membuat sesi untuk guru yang ditugaskan
  admin padanya. Kepala Sekolah (`is_principal = 1`) boleh
  mensupervisi semua guru tanpa penugasan. Bila sebenarnya semua
  supervisor boleh mensupervisi semua guru, tabel
  `supervisor_assignments` tetap ada tetapi admin cukup menugaskan
  semua guru ke semua supervisor — beri tahu bila penugasan tidak
  perlu seketat ini.
- **A3 — Guru mengisi refleksi, supervisor menambah catatan.**
  Kolom pasca di kertas ("Respon Refleksi Guru & Catatan
  Supervisor") dipecah jadi dua kolom di aplikasi: `guru_note`
  (ditulis guru) dan `supervisor_note` (ditulis supervisor).
  Keduanya tampil berdampingan di cetak.
- **A4 — Rentang predikat default (disetujui Pak Gun).** 90–100
  Sangat Baik, 80–89 Baik, 70–79 Cukup, 60–69 Kurang, 0–59 Sangat
  Kurang. Rentang ini bisa diubah oleh admin atau supervisor per
  templat; perubahan hanya berlaku untuk sesi baru (sesi lama
  memakai snapshot predikatnya).
- **A5 — Foto maksimal 5 per sesi**, maks 5 MB per berkas setelah
  kompresi (mengikuti pola GezyAsko). Batas per berkas tetap 5 MB
  setelah kompresi.
- **A6 — Tanda tangan hanya garis cetak.** Tidak ada tanda tangan
  digital atau foto tanda tangan di MVP.
- **A7 — Periode aktif tepat satu.** Mengaktifkan periode baru
  menonaktifkan periode lama secara otomatis. Periode = semester
  ("2026/2027 Ganjil").
- **A8 — Tidak ada data murid.** Kelas hanya label + guru pengampu;
  tidak ada roster murid, tidak ada impor murid, tidak ada akun
  murid/orang tua. Bila nanti supervisi perlu melihat daftar murid
  kelas, itu fitur susulan.
- **A9 — "Kelas / Kelompok" = satu kelas.** Sesi mengikat satu
  `class_id`; bila satu sesi supervisi mencakup gabungan
  kelas/kelompok, catat di kolom Tema atau Waktu Observasi, atau
  beri tahu bila perlu dukungan multi-kelas.
- **A10 — Templat aktif boleh lebih dari satu.** Sesi baru memilih
  salah satu templat aktif (mis. templat PPB/GM dan templat lain
  bila nanti ada). Bila yang diinginkan tepat satu templat aktif,
  beri tahu.
- **A11 — Admin (Pak Gun) tidak merangkap supervisor.** Bila Pak Gun
  juga perlu melaksanakan supervisi, dibuatkan akun `supervisor`
  terpisah untuknya — satu akun satu peran.

## 12. Keamanan, backup, dan deploy (MVP)

- Setiap route memeriksa peran di server; supervisor hanya untuk
  guru yang ditugaskan padanya (cek `supervisor_assignments`) dan
  hanya mengedit sesi buatannya (cek `sessions.supervisor_id`);
  guru hanya untuk sesi atas dirinya (cek `sessions.teacher_id`).
- Foto tidak pernah dilayani sebagai file statis publik; selalu
  lewat `/bukti/:id` dengan cek login dan hak.
- Backup = `mysqldump` database + arsip folder bukti + cap waktu.
  Restore mengganti keduanya dan membersihkan semua sesi login.
  Database dan folder bukti tidak pernah di-commit ke repo.
- Akun admin awal wajib diganti kata sandinya saat deploy pertama;
  kredensial database dan admin tidak ditulis di repo maupun di
  plan ini.
- Deploy di tangan Pak Gun (pola yang sama seperti GezyAsko dan
  GezyRaport): `git pull` di VPS + restart service systemd di balik
  reverse proxy HTTPS. Sebelum deploy pertama, di VPS disiapkan:
  server MariaDB + database + user khusus aplikasi, dan
  `DATA_DIR` untuk foto bukti. Domain: **spv.pakgun.web.id**
  (DNS + reverse proxy dipasang Pak Gun saat deploy).
- Kriteria selesai MVP: semua route di bagian 7 bisa dipakai tanpa
  login ganda yang bocor, rumus bagian 6 lolos `bun test`, impor CSV
  yang salah dibatalkan penuh, snapshot instrumen terbukti tidak
  berubah setelah edit templat, sesi tidak bisa ditandai selesai
  sebelum semua indikator terisi dan refleksi guru lengkap,
  supervisor tidak bisa membuat sesi untuk guru yang tidak
  ditugaskan padanya, Kepala Sekolah bisa membuat sesi untuk guru
  mana pun, dan backup hasil deploy bisa di-restore di salinan
  percobaan.

## 13. Yang belum diputuskan (butuh kata Pak Gun)

Semua hal yang dulu ada di bagian ini sudah diputuskan Pak Gun
pada 2026-11-05:

1. Domain: **spv.pakgun.web.id**.
2. Rentang predikat default dipakai (90–100 Sangat Baik, 80–89
   Baik, 70–79 Cukup, 60–69 Kurang, 0–59 Sangat Kurang) dan bisa
   diubah oleh admin atau supervisor.
3. Penugasan supervisor per guru, dengan pengecualian Kepala
   Sekolah yang bisa mensupervisi semua guru.

Yang tersisa hanyalah persetujuan plan ini — sesudah itu pembangunan
dimulai dari Fase 0.
