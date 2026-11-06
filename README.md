# gezyspv-pro

Aplikasi supervisi akademik berbasis web untuk **SMPN 1 Punggur**
(domain: `spv.pakgun.web.id`). Supervisor melakukan diskusi pra
observasi, kemudian mengobservasi guru secara langsung saat
pembelajaran berlangsung, dilanjutkan dengan diskusi pasca observasi
dan menyusun rencana tindak lanjut. Bukan CBT, bukan penilaian murid.

Stack: **Bun + Elysia + MariaDB**, Tailwind CSS v4. Rencana lengkap:
`../gezyspv-pro-plan/implementation_plan.md`.

> **Status: MVP selesai — Fase 4 (cetak, backup/restore, audit log,
> hardening) selesai.** Yang sudah ada: migrasi MariaDB, auth username +
> kata sandi, pengaturan sekolah, CRUD periode/kelas/akun, penugasan
> supervisor → guru, impor CSV transaksional, seed templat PPB/GM,
> halaman login + dasbor, skrip backup, **CRUD templat instrumen**
> (elemen, indikator, pertanyaan pra/pasca, butir RTL, prinsip, label
> skala, rentang predikat), status draf/aktif/arsip, salin templat
> untuk tahun ajaran baru, serta snapshot templat per sesi, **sesi
> supervisi lengkap** (buat sesi dari templat aktif, alur status
> pra → observasi → pasca → tindak_lanjut → selesai, pra-observasi,
> skor observasi per indikator, refleksi pasca oleh guru, rencana
> tindak lanjut, foto bukti + URL video), **profil guru, rekap, dan
> narasi** (tren skor SVG, distribusi per indikator, skor guru per
> periode, rekap sekolah dan kelas, daftar guru yang belum disupervisi
> pada periode aktif, generator + editor narasi), **dan halaman cetak,
> backup/restore lewat web, serta audit log** (perubahan skor dan
> status tercatat; halaman `/admin/log`). **Model peran: satu akun dua
> peran** (keputusan 2026-11-05, migrasi `002_role_flags.sql`) — lihat
> bagian di bawah.

## Model peran — satu akun dua peran

Akun hanya dua macam: **admin** dan **guru**. Supervisor **bukan**
peran tersendiri, melainkan flag `is_supervisor` pada akun guru — sama
seperti `is_principal` untuk Kepala Sekolah. Guru biasa: akun guru
tanpa flag. Supervisor (wakasek/pengawas/guru yang ditunjuk): akun guru
+ `is_supervisor=1`. Kepala Sekolah: akun guru + `is_principal=1`
(otomatis juga supervisor, bisa mensupervisi semua guru).

- **Satu akun bisa dua peran**: akun supervisor tetap bisa membuat
  sesi, dan akun yang sama bisa menjadi guru yang disupervisi di sesi
  orang lain. Supervisor boleh disupervisi oleh **supervisor mana pun
  yang ditugaskan admin** (bukan hanya Kepsek).
- **Tidak boleh mensupervisi diri sendiri** — ditolak server.
- **Hak lihat satu sesi**: hanya pembuat sesi + guru yang disupervisi
  + admin + Kepsek. Supervisor lain **tidak** bisa membuka sesi itu
  (403).
- **Admin mengatur flag** di `/admin/guru`: tiap akun guru punya
  centang *Supervisor* dan *Kepsek* + tombol *Simpan Flag*. Flag tidak
  bisa diubah pada akun admin. Menyalakan *Kepsek* otomatis menyalakan
  *Supervisor*. Impor CSV guru tetap membuat akun guru biasa — flag
  diatur admin sesudahnya lewat UI.
- **Migrasi 002** mengonversi akun supervisor lama menjadi guru +
  flag (`role='supervisor'` → `role='guru', is_supervisor=1`; Kepsek
  lama ikut membawa `is_principal=1`) dan mengubah CHECK `role`
  menjadi `('admin','guru')`. CHECK lama bernama `role` (dari
  `001_init.sql`); bila di suatu database nama CHECK-nya berbeda,
  penghapusan CHECK lama menjadi no-op dan CHECK lama tetap ada —
  kode tetap tidak pernah lagi memakai role `'supervisor'`.

## Cetak, backup & restore, audit log (Fase 4)

1. **Cetak** (`/supervisi/:id/cetak`, tombol "🖨 Cetak Laporan" di
   ringkasan sesi): susunan mengikuti dokumen kertas — kop sekolah
   dari pengaturan, identitas 8 kolom, prinsip, tabel pra-observasi,
   tabel observasi (skor + bukti per indikator), tabel pasca (refleksi
   guru berdampingan dengan catatan supervisor), tindak lanjut,
   narasi, foto bukti (thumbnail), tempat + tanggal, blok tanda tangan
   Kepala / Guru / Supervisor dengan NIP. PDF dihasilkan lewat dialog
   print browser (tombol "Cetak / Simpan PDF") — tanpa pustaka PDF
   server. Narasi bisa diedit langsung dari halaman cetak (form
   edit, hanya supervisor pembuat sesi; kembali ke halaman cetak
   setelah disimpan). Toolbar dan form edit disembunyikan saat
   mencetak.
2. **Backup** (`/admin/backup`, admin saja): tombol "Buat Backup
   Sekarang" menjalankan `deploy/backup.sh` (mysqldump + arsip folder
   bukti, cap waktu) dan daftar backup bisa diunduh.
3. **Restore** (halaman yang sama, admin saja): pilih pasangan dump
   + arsip bukti yang sudah ada atau unggah berkas baru. Berkas
   divalidasi dulu (harus gzip + dump gezyspv-pro yang sah; arsip
   bukti hanya boleh berisi entri di dalam `bukti/`). Restore wajib
   konfirmasi ganda — ketik `RESTORE` + centang pernyataan — lalu
   mengganti database + folder bukti dan **membersihkan semua sesi
   login** (semua pengguna harus masuk ulang).
4. **Audit log** (`/admin/log`, admin saja): setiap perubahan skor
   (`score.create` / `score.update`, nilai lama → nilai baru) dan
   perubahan status sesi (`session.status`, dari → ke) tercatat di
   `audit_logs` beserta pengguna dan waktunya; edit narasi sesudah
   sesi selesai juga tercatat. Halaman log bisa difilter per aksi dan
   per pengguna, terbaru dulu.

## Checklist kriteria selesai MVP (plan bagian 12)

Semua kriteria di bawah ini dibuktikan oleh tes otomatis atau smoke
live (lihat `tests/print-backup.test.ts` bila tidak disebut lain):

| Kriteria | Bukti |
|---|---|
| Semua route bagian 7 bisa dipakai tanpa login ganda yang bocor | Sweep 24 route tanpa login → 302 ke `/login`; guru 403 di `/admin/*` (`tests/print-backup.test.ts`) |
| Rumus bagian 6 lolos `bun test` | `tests/sessions.test.ts` (rata-rata elemen, skala 100, predikat) |
| Impor CSV yang salah dibatalkan penuh | `tests/import.test.ts` (rollback transaksional) |
| Snapshot tidak berubah setelah edit templat | `tests/templates.test.ts` |
| Sesi tidak bisa selesai sebelum lengkap | `tests/sessions.test.ts` (skor + refleksi + RTL) |
| Supervisor tidak bisa membuat sesi untuk guru yang tidak ditugaskan | `tests/sessions.test.ts` |
| Kepala Sekolah bisa membuat sesi untuk guru mana pun | `tests/sessions.test.ts` |
| Backup hasil deploy bisa di-restore di salinan percobaan | `tests/print-backup.test.ts`: backup → rusak data → restore → jumlah sesi/templat sama, sesi login bersih |
| Halaman cetak memuat kop/identitas/narasi/tanda tangan | `tests/print-backup.test.ts` + smoke live (cetak 200) |
| Perubahan skor + status tercatat di audit log | `tests/print-backup.test.ts` (old → new) + `/admin/log` |
| Tampilan HP/tablet/laptop/PID | Inspeksi CSS + render halaman (lihat catatan di bawah) |

**Uji tampilan:** Chromium headless di VM ini tidak bisa start langsung
(kebijakan WebGL membutuhkan browser-daemon), jadi uji dilakukan lewat
inspeksi CSS + render halaman dari server dev: semua tabel aplikasi
dibungkus `overflow-x-auto`, grid skor memakai `flex flex-wrap`, nav
memakai `flex-wrap`, kontainer `max-w-6xl` + `px-4`, dan tipografi
dasar dibesarkan sedikit di ≥1920px (`public/css/app.css`).
Satu temuan diperbaiki: tautan video URL panjang kini memakai
`break-all` (dan `overflow-wrap` di halaman cetak) agar tidak meluber
di layar HP. Halaman login, dasbor, buat sesi, ringkasan, observasi,
profil, rekap, dan cetak semuanya render 200.

## Profil, rekap, dan narasi (Fase 3)

1. **Profil guru** (`/guru/:id`, tautan "Profil" di dasbor dan di
   ringkasan sesi): grafik tren SVG (satu titik per sesi selesai,
   arahkan kursor untuk melihat tema + nilai), skor guru per periode
   (rata-rata nilai akhir **selalu bersama rincian per sesi +
   predikat masing-masing**), distribusi per indikator (berapa kali
   tiap label level muncul dalam satu periode), daftar semua sesi,
   dan sesi yang masih berjalan ditampilkan terpisah sebagai "dalam
   proses" tanpa skor. Hanya sesi berstatus `selesai` yang masuk
   tren, distribusi, dan rata-rata.
2. **Rekap sekolah** (`/rekap/periode/:id`, tautan "Rekap" di dasbor
   admin): rata-rata nilai akhir per elemen di semua sesi selesai
   pada periode itu, distribusi predikat, dan — hanya pada periode
   aktif — daftar guru yang belum disupervisi.
3. **Rekap satu guru** (`/rekap/guru/:id`): rata-rata nilai akhir per
   periode beserta rincian per sesi.
4. **Rekap kelas** (`/rekap/kelas/:id`, tautan dari rekap sekolah):
   rata-rata nilai akhir sesi-sesi selesai di kelas itu beserta
   rincian per guru dan per sesi (satu kelas bisa punya beberapa
   guru/mapel).
5. **Narasi**: disusun otomatis per sesi dari skor per elemen
   (terkuat + yang perlu penguatan), predikat, label yang paling
   sering muncul, serta catatan bukti, refleksi pasca, dan tindak
   lanjut — tanpa mengarang capaian. Bila sesi belum lengkap,
   narasi menyatakan jujur bahwa sesi belum selesai. Supervisor
   pembuat sesi bisa mengedit narasi di halaman tindak lanjut (dan
   sesudah sesi selesai; perubahan itu dicatat di audit log); narasi
   hasil edit **tidak** ditimpa regenerasi otomatis — hanya tombol
   "Buat ulang narasi" yang menimpa secara eksplisit. Guru hanya
   bisa membaca narasi.
6. **Hak lihat**: admin melihat semua; supervisor hanya profil/rekap
   guru yang ditugaskan padanya (Kepala Sekolah boleh semua); guru
   hanya profil/rekap dirinya sendiri. Rekap sekolah/kelas untuk
   supervisor non-Kepsek dan guru hanya mencakup lingkup yang boleh
   mereka lihat (diberi label lingkup di halaman). Akses ke guru yang
   tidak ditugaskan → 403.

## Memakai sesi supervisi (Fase 2)

1. **Admin** membuat akun guru, menyalakan flag supervisor pada akun
   yang ditunjuk (menu Guru & Akun → *Simpan Flag*), dan mengatur
   penugasan di menu Penugasan (Kepala Sekolah, flag Kepsek, bisa
   mensupervisi semua guru tanpa penugasan).
2. **Supervisor** membuka menu Supervisi → **Buat Sesi Baru**: pilih
   templat berstatus aktif, guru yang ditugaskan, kelas, tema/mapel,
   fase/semester, tanggal + waktu observasi. Isi templat otomatis
   disalin menjadi snapshot sesi — perubahan templat sesudahnya tidak
   mengubah sesi yang sudah dibuat.
3. **Pra-observasi**: supervisor mengisi 5 pertanyaan diskusi (boleh
   sebagian), lalu lanjut ke Observasi.
4. **Observasi**: ketuk skor tiap indikator (tombol besar, ramah HP)
   dan isi bukti teks bila perlu; foto bukti diunggah dari halaman ini
   (maks 5 foto/sesi, maks 5 MB/foto, dikompresi otomatis di perangkat
   sebelum diunggah; JPG/PNG/WebP) atau tempel URL video https.
   Skor di luar skala templat ditolak server.
5. **Pasca-observasi**: **guru mengisi sendiri refleksinya** pada
   5 pertanyaan; supervisor membaca lalu menambah catatan. Guru tidak
   bisa mengubah skor atau tindak lanjut; supervisor tidak bisa
   mengisi kolom refleksi guru.
6. **Tindak lanjut**: supervisor mengisi 3 butir RTL; halaman ini
   menampilkan narasi otomatis dari skor + catatan yang bisa diedit
   supervisor (lihat bagian Fase 3).
7. **Selesai**: sesi hanya bisa ditandai selesai bila semua indikator
   berskor, semua refleksi guru terisi, dan ketiga butir RTL terisi.
   Sesi selesai terkunci — tidak bisa dihapus dan skornya tidak bisa
   diubah (perubahan status dicatat di audit log).

Status hanya berpindah satu tahap (maju atau mundur) selama belum
selesai. Dasbor supervisor menampilkan sesi buatannya dan guru yang
ditugaskan yang belum disupervisi pada periode aktif; bila supervisor
itu sendiri sedang disupervisi, dasbornya juga menampilkan kartu
**"Supervisi atas Anda"** (termasuk yang **"Menunggu refleksi
Anda"**). Dasbor guru menampilkan sesi atas dirinya, termasuk yang
**"Menunggu refleksi Anda"**. Supervisor juga guru: daftar guru yang
belum disupervisi mencakup akun supervisor yang belum pernah
disupervisi sebagai guru pada periode aktif. Foto bukti disimpan di `DATA_DIR/bukti` (default `./data/bukti`)
dengan nama hasil generate server dan hanya dilayani lewat `/bukti/:id`
setelah cek login + hak — bukan folder statis publik.

## Menjalankan lokal

```bash
cd gezyspv-pro-app
cp .env.example .env   # lalu isi DB_PASSWORD
bun install
bun run build:css      # membangun public/dist/app.css (Tailwind v4)
bun run setup-db       # sebagai root: buat database + user MariaDB
bun start              # migrasi + seed otomatis, lalu listen :3000
```

Buka `http://localhost:3000`, masuk dengan akun admin dev:

| | |
|---|---|
| Username | `admin` |
| Kata sandi | `admin123` |

Akun ini ditandai `must_change_password = 1` — saat login pertama
aplikasi memaksa ganti kata sandi sebelum bisa melanjutkan.
**Kata sandi di atas hanya untuk pengembangan lokal.** Di server
produksi, buat akun admin dengan kata sandi kuat dan segera ganti
saat deploy pertama.

Perintah lain:

```bash
bun run dev        # mode watch
bun test           # bun test (butuh database tes, lihat bawah)
bun run migrate    # jalankan migrasi saja
bun run seed       # jalankan seed saja (idempotent)
bash deploy/backup.sh   # backup mysqldump + arsip bukti
```

## Menyiapkan database MariaDB

### Di VM / VPS Ubuntu/Debian

```bash
sudo apt-get update
sudo apt-get install -y mariadb-server mariadb-client
sudo systemctl enable --now mariadb
```

### Membuat database + user aplikasi

```bash
# Sebagai root OS (MariaDB memakai otentikasi unix_socket untuk root):
sudo bun run setup-db
```

Skrip itu membuat database `gezyspv_dev` dan `gezyspv_test` serta
user `gezyspv` (kata sandi dari `DB_PASSWORD` di `.env`) dengan hak
penuh atas kedua database. Manual (bila tidak memakai skrip):

```sql
CREATE DATABASE gezyspv_dev CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE gezyspv_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'gezyspv'@'127.0.0.1' IDENTIFIED BY 'kata-sandi-yang-kuat';
GRANT ALL PRIVILEGES ON gezyspv_dev.* TO 'gezyspv'@'127.0.0.1';
GRANT ALL PRIVILEGES ON gezyspv_test.* TO 'gezyspv'@'127.0.0.1';
FLUSH PRIVILEGES;
```

Aplikasi membaca kredensial hanya dari environment (`.env`,
gitignored). Jangan pernah menulis kata sandi database di kode
atau di README.

## Templat instrumen

Instrumen supervisi adalah **data, bukan kode**: admin mengelolanya di
menu **Templat** (`/admin/templat`). Templat bawaan "Supervisi
Akademik PPB/GM 2026/2027" (3 prinsip, 4 elemen, 11 indikator,
10 pertanyaan, 3 butir RTL, 5 predikat) sudah terisi dari seed.

- **Status:** `draf` (bisa diedit, belum bisa dipakai sesi baru),
  `aktif` (bisa dipakai sesi baru), `arsip` (tidak bisa diedit dan
  tidak bisa dipakai sesi baru; menyalinnya tetap bisa). Ubah status
  hanya lewat tombol **Aktifkan** / **Arsipkan** / **Kembalikan ke draf**
  — bukan lewat form edit.
- **Salin untuk tahun ajaran baru:** tombol **Salin** menduplikasi
  lengkap isi templat (prinsip, elemen + indikator, label skala,
  pertanyaan, RTL, predikat) menjadi templat baru berstatus `draf`
  dengan judul lama + " (Salinan)". Templat seed boleh disalin.
- **Hapus:** templat yang sudah pernah dipakai sesi mana pun
  **tidak boleh dihapus** (tolak dengan pesan; yang bisa dilakukan
  hanya mengarsipkan). Templat seed juga tidak boleh dihapus.
  Templat yang belum pernah dipakai boleh dihapus (dengan konfirmasi).
- **Skala penilaian:** 2, 4, 10, atau 100. Skala 2 (0/1/2) dipakai
  instrumen Kurikulum Merdeka. Mengubah skala ditolak bila
  ada label skala yang nilainya di luar rentang baru. Nilai akhir
  sesi selalu skala 100 + predikat.
- **Predikat:** rentang min–max (0–100) + label, **tidak boleh
  tumpang tindih**. Rentang predikat boleh diubah oleh admin
  **atau supervisor** — lewat halaman terpisah
  (`/templat/:id/predikat`, ditautkan dari dasbor supervisor).
  Supervisor tidak bisa mengubah bagian templat lainnya; guru
  tidak bisa membuka halaman templat sama sekali (403).
- **Snapshot:** saat sesi dibuat (Fase 2), isi templat disalin ke
  tabel `session_*` (fungsi `snapshotTemplateForSession` di
  `src/lib/snapshot.ts`). Edit templat sesudahnya tidak mengubah
  sesi lama — riwayat aman dari pergantian instrumen tahunan.

## Kelompok templat & supervisi berkelompok (Kurikulum Merdeka)

Keputusan Pak Gun 2026-11-06 (opsi B): empat instrumen supervisi
Kurikulum Merdeka disajikan sebagai **satu kelompok templat**, bukan
4 templat lepas dan bukan 1 templat raksasa. Satu supervisi
berkelompok membuka keempat pengisian yang terhubung — masing-masing
dengan Nilai Akhir + predikat sendiri.

Isi kelompok "Instrumen Supervisi Kurikulum Merdeka" (data dari
berkas seed paralel
`~/workspace/your_files/templat-instrumen-supervisi/seed-templat-instrumen-I-IV.ts`;
ejaan tanpa spasi di dokumen dinormalisasi — lihat catatan di
`src/lib/seed-kurmer-data.ts`):

| Templat | Indikator | Skala |
| --- | --- | --- |
| I — Administrasi Pembelajaran | 12 | 0–2 |
| II — Penelaahan Alur Tujuan Pembelajaran | 12 | 0–2 |
| III — Telaah Modul Ajar | 24 | 0–2 |
| IV — Supervisi Pelaksanaan Pembelajaran | 38 | 0–2 |

Label skala **generik** untuk keempat templat (disetujui Pak Gun
2026-11-06): 0 "Tidak Ada / Tidak Sesuai", 1 "Kurang Lengkap /
Sesuai Sebagian", 2 "Lengkap / Sesuai".

Tiap templat: 0 prinsip, 0 pertanyaan pra-observasi, 1 pertanyaan
pasca ("Apa tanggapan dan refleksi Anda atas hasil supervisi ini?"),
2 butir tindak lanjut ("Catatan", "Tindak Lanjut"), dan 4 predikat
dokumen: 91–100 Sangat Baik, 81–90 Baik, 71–80 Cukup, 0–70 Kurang.
Rumus Nilai Akhir tetap rumus aplikasi (rata-rata/skala × 100) — sama
dengan rumus dokumen (Skor/Skor Maksimal × 100%).

**version_label** tiap templat diambil dari nama periode aktif di
`/admin/periode` saat seed berjalan (saat ini "2026/2027 Ganjil") —
bukan hardcode; dokumen tidak mencantumkan tahun ajaran. Bila tidak
ada periode aktif, fallback "2026/2027". Mekanisme:
`resolveKurmerVersionLabel()` di `src/lib/seed-kurmer.ts`.

### Seed

```bash
bun run seed:kurmer   # migrasi dulu, lalu buat 4 templat + kelompoknya
```

Idempotent (jalan kedua tidak menduplikasi) dan tidak mengubah
templat PPB/GM — tetapi seed **tidak memperbarui** templat yang
sudah ada: bila isi data berubah (atau periode aktif berganti dan
version_label harus ikut), hapus dulu templat/kelompok lama (atau
pakai database baru) sebelum seed ulang. Data seed ada di
`src/lib/seed-kurmer-data.ts` (salinan berkas seed paralel di atas,
dengan dua penyesuaian yang didokumentasikan di header berkas itu);
logika seed di `src/lib/seed-kurmer.ts`, dijalankan lewat
`src/scripts/seed-kurmer.ts`.

### Memakai

- **Admin** — menu **Kelompok** (`/admin/kelompok`): buat kelompok,
  tambah/hapus templat (hanya templat **aktif** yang bisa masuk;
  satu templat hanya di satu kelompok), atur urutan (tombol ↑/↓).
  Templat di dalam kelompok tetap bisa diedit seperti templat biasa
  (sesi lama memakai snapshot). Templat di dalam kelompok **tidak
  bisa dihapus** sebelum dikeluarkan dari kelompok. Kelompok yang
  sudah pernah dipakai supervisi berkelompok tidak bisa dihapus.
- **Supervisor** — **Buat Supervisi Berkelompok**
  (`/supervisi/kelompok/baru`, ditautkan dari dasbor supervisor):
  pilih kelompok + guru yang ditugaskan padanya (Kepsek bebas;
  penugasan memakai `canSupervise`) + kelas + tema + fase/semester +
  tanggal/waktu → satu `session_group` + satu sesi per templat,
  dibuat dalam **satu transaksi** (gagal di tengah → tidak ada yang
  tersimpan). Gagal bila ada templat di kelompok yang bukan aktif —
  pesan galat menyebut nama templatnya. Supervisi diri sendiri
  tetap ditolak.
- **Alur tiap sesi** tetap pra → observasi → pasca → tindak lanjut →
  selesai (kode yang sudah ada dipakai ulang). Templat tanpa
  pertanyaan pra menampilkan halaman pra yang bisa langsung
  dilewati; 0 prinsip tidak merusak halaman cetak/ringkasan
  (bagian Prinsip dan Pra-Observasi disembunyikan bila kosong;
  subjudul cetak memakai basis templat, mis. "Berbasis Kurikulum
  Merdeka").
- **Ringkasan kelompok** (`/supervisi/kelompok/:id`): status +
  Nilai Akhir + predikat per sesi (hanya sesi selesai yang
  menampilkan Nilai Akhir) + tautan ke tiap sesi dan halaman
  cetaknya. Kelompok dianggap selesai bila keempat sesinya selesai.
  Hak lihat sama dengan sesi: pembuat + yang disupervisi +
  admin/Kepsek; supervisor lain 403. Ditautkan dari dasbor
  (supervisor melihat kelompok buatannya; guru melihat kelompok
  atas dirinya) dan dari ringkasan tiap sesi.
- **Rekap tidak berubah:** rekap guru dan rekap sekolah tetap
  menghitung per sesi. Hanya ringkasan kelompok yang menampilkan
  keempat Nilai Akhir berdampingan.

### Catatan teknis

- **Skala 2** ditambahkan lewat migrasi `003_scale2_template_groups.sql`
  (CHECK `score_scale` menjadi `IN (2, 4, 10, 100)`; migrasi 001/002
  tidak diubah). Migrasi 003 juga menambah `template_groups`,
  `template_group_items` (UNIQUE `template_id` — satu templat hanya
  di satu kelompok), `session_groups`, dan kolom `sessions.session_group_id`.
- **Catatan CHECK inline (temuan 2026-11-06):** CHECK `score_scale` di
  001 ditulis inline pada kolom, dan `DROP CONSTRAINT IF EXISTS`
  adalah no-op untuk CHECK seperti itu (nama di information_schema
  hanyalah nama kolom) — CHECK lama tetap berlaku dan skala 2 tetap
  ditolak. Karena itu 003 menghapusnya lewat `MODIFY` kolom tanpa
  klausa CHECK, bukan lewat DROP. Hal yang sama terjadi pada CHECK
  `role` di migrasi 002 (CHECK lama `IN ('admin','supervisor','guru')`
  masih ada — tidak berbahaya karena superset dari yang baru — tetapi
  jangan meniru pola DROP itu). Untuk FOREIGN KEY, MariaDB menolak
  `ADD CONSTRAINT IF NOT EXISTS ... FOREIGN KEY`, jadi FK
  `fk_sessions_group` ditambahkan tanpa IF NOT EXISTS; idempotensi
  migrasi dijamin runner (nama berkas dicatat di tabel `migrations`).
- **Penyimpangan dari dokumen:** (1) Dokumen IV tidak punya butir
  bernomor 1–38 — yang dinilai adalah **sub-poin a–f** dari 11 butir
  induk (A: 1–3, B: 1–6, C: 1–2); tiap sub-poin menjadi satu
  indikator dengan nama sub-bagiannya di depan teks
  ("Orientasi — Guru menyiapkan …"; huruf a/b/c tidak dicantumkan).
  Total tetap 38 (7+23+8). (2) Label skala **generik** untuk keempat
  templat (keputusan Pak Gun 2026-11-06) — dokumen memakai wording
  berbeda per instrumen/bagian; wording III yang berbeda ("Tidak
  Sesuai / Sesuai Sebagian / Sesuai Seluruhnya") tetap dicantumkan
  di akhir judul elemen C, F, G, H. (3) Dokumen I tidak punya
  pengelompokan — ke-12 butirnya dimasukkan dalam satu elemen
  "Administrasi Pembelajaran" (kode A). (4) Ejaan tanpa spasi di
  dokumen dinormalisasi ("pesertadidik" → "peserta didik",
  "dataatau" → "data atau", "instrument" → "instrumen", dst.);
  ejaan "tehnik" dipertahankan. Artefak footer "Jumlah Skor Total
  Nilai Akhir Ketercapaian" di akhir dokumen IV tidak dimasukkan.
  (5) Judul templat dipersingkat ("I — Administrasi Pembelajaran",
  dst.); nama lengkap dokumen ("Instrumen Supervisi Akademik
  (Kurikulum Merdeka)") tersimpan di deskripsi kelompok, dan `basis`
  tetap "Kurikulum Merdeka" agar subjudul cetak tetap "Berbasis
  Kurikulum Merdeka". (6) version_label mengikuti periode aktif
  (lihat di atas), bukan tahun di baris tanda tangan dokumen
  (2025). (7) Di luar yang diminta: halaman cetak menyembunyikan
  bagian Prinsip/Pra yang kosong dan subjudul cetak memakai basis
  templat — agar instrumen KurMer tidak tercetak dengan judul
  "PPB/GM".

## Tes

```bash
bun test
```

Tes memakai database terpisah (`gezyspv_test`,
`gezyspv_test_http` untuk tes HTTP, dan `gezyspv_test_templates`
untuk tes templat, `gezyspv_test_groups` untuk tes kelompok templat)
yang dibuat otomatis oleh
helper tes — dengan catatan MariaDB sudah terinstal dan proses tes
berjalan sebagai root OS (untuk `CREATE DATABASE` via unix socket),
atau database tes sudah dibuat sebelumnya lewat `setup-db`.

Isi tes:

- `tests/csv.test.ts` — parser CSV (petik, CRLF, BOM) dan validasi
  CSV guru/kelas.
- `tests/auth.test.ts` — hash/verifikasi kata sandi argon2id dan
  aturan penugasan supervisor (termasuk Kepala Sekolah).
- `tests/seed.test.ts` — seed templat PPB/GM lengkap dan idempotent,
  teks indikator/pertanyaan verbatim dari dokumen.
- `tests/import.test.ts` — impor CSV transaksional (rollback bila
  satu baris salah).
- `tests/http.test.ts` — login lewat HTTP, cookie sesi, dan RBAC
  (guru mendapat 403 di `/admin`).
- `tests/templates.test.ts` — CRUD templat + validasi, aturan status
  draf/aktif/arsip, salin lengkap, tolak hapus templat terpakai,
  RBAC predikat (supervisor boleh, guru 403), dan snapshot yang
  tidak berubah setelah templat diedit.
- `tests/narrative.test.ts` + `tests/profile-recap.test.ts` — generator
  + editor narasi (edit tidak tertimpa regenerasi), profil guru (tren
  SVG, distribusi, rata-rata per periode beserta rincian), rekap
  sekolah/kelas, dan hak lihat per peran.
- `tests/print-backup.test.ts` — halaman cetak (isi + 302/403),
  audit log skor + status (old → new), halaman `/admin/log`,
  validasi berkas restore, backup → restore ke salinan percobaan,
  dan sweep perlindungan 24 route tanpa login (kriteria selesai MVP
  bagian 12).
- `tests/template-groups.test.ts` — skala 2 (dan 4/10/100 tetap
  jalan, CHECK menolak skala 3), migrasi 003 idempotent, seed
  KurMer (4 templat + 1 kelompok, hitungan 12/12/24/38, predikat
  dokumen, label generik, version_label dari periode aktif +
  fallback, teks dari berkas seed paralel), kelola kelompok admin, buat supervisi
  berkelompok (1 grup + 4 sesi + snapshot), penugasan + larangan
  supervisi diri + Kepsek bebas, templat non-aktif menggagalkan
  pembuatan grup, sesi 0 pra bisa maju, selesai hanya bila lengkap
  (Nilai Akhir 100 → Sangat Baik; 50 → Kurang), hak lihat kelompok
  (supervisor lain 403), templat di kelompok tidak bisa dihapus,
  dan regresi sesi tunggal PPB/GM skala 4.

## Backup & restore

Backup dibuat lewat tombol di `/admin/backup` atau:

```bash
bash deploy/backup.sh
```

Hasilnya di `data/backups/`: `db-YYYYMMDD-HHMMSS.sql.gz` (dump
MariaDB) dan `bukti-YYYYMMDD-HHMMSS.tar.gz` (arsip foto bukti).

**Restore lewat web** (admin saja, di halaman yang sama): pilih
pasangan dump + arsip bukti (atau unggah berkas baru), ketik `RESTORE`,
centang pernyataan kesadaran. Restore mengganti database + folder
bukti, membersihkan semua sesi login, dan tercatat di audit log
(`backup.restore`). Berkas tidak valid ditolak sebelum apa pun
diubah. Setelah restore, semua pengguna harus login ulang.

**Restore manual** (bila web tidak bisa dipakai):

```bash
# Hentikan aplikasi dulu, lalu:
zcat data/backups/db-<cap>.sql.gz | mysql -u gezyspv -p gezyspv_dev
tar -xzf data/backups/bukti-<cap>.tar.gz -C data/
# Restore membersihkan sesi login: semua pengguna harus login ulang.
mysql -u gezyspv -p -e "DELETE FROM gezyspv_dev.user_sessions;"
```

**Uji restore di salinan percobaan** (wajib sebelum restore di
produksi): buat database percobaan, impor dump ke sana, dan bandingkan
jumlah sesi/templat — persis seperti yang dilakukan tes otomatis
`tests/print-backup.test.ts` (bagian "backup → restore ke salinan
percobaan").

## Deploy (VPS)

Panduan lengkap langkah-demi-langkah: **`deploy/DEPLOY.md`**
(database + user terpisah dari GezyCBT, migrasi sebagai pembuktian
MariaDB 11.8, service systemd, reverse proxy HTTPS untuk
`spv.pakgun.web.id`, ganti kata sandi admin awal, backup/restore).

Ringkasan:

1. Siapkan MariaDB + database + user (bagian di atas).
2. `git pull` lalu `bun install && bun run build:css`.
3. Salin `.env.example` ke `.env`, isi kredensial.
4. Pasang `deploy/gezyspv-pro.service` ke systemd (sesuaikan path
   dan user di berkas itu), lalu `systemctl enable --now gezyspv-pro`.
5. Arahkan reverse proxy HTTPS ke `127.0.0.1:3000` dan pasang DNS
   `spv.pakgun.web.id`. Set `SESSION_COOKIE_SECURE=true` di `.env`
   bila sudah di balik HTTPS.

## Struktur

```text
src/
  index.ts            # entrypoint Elysia
  db.ts               # pool MariaDB + runner migrasi
  auth.ts             # hash argon2id, sesi login (cookie)
  rbac.ts             # cek peran + penugasan supervisor
  lib/csv.ts          # parser + impor CSV transaksional
  lib/seed.ts         # seed templat PPB/GM (verbatim dari docx)
  lib/scores.ts       # rumus skor bagian 6 (murni, tanpa DB)
  lib/sessions.ts     # service sesi + audit log perubahan skor/status
  lib/snapshot.ts     # salin templat menjadi snapshot sesi
  lib/narrative.ts    # generator + editor narasi
  lib/recap.ts        # profil guru, rekap, tren SVG
  lib/evidence.ts     # foto bukti + URL video
  lib/backup.ts       # validasi + restore backup (dump + arsip bukti)
  routes/auth.ts      # /login, /logout, /ganti-sandi
  routes/dashboard.ts # / (dasbor per peran)
  routes/admin.ts     # /admin/* (pengaturan, guru, kelas,
                      #   periode, penugasan, backup, log)
  routes/sessions.ts  # /supervisi/* (sesi, pra, observasi, pasca, RTL)
  routes/profile.ts   # /guru/:id, /rekap/*
  routes/print.ts     # /supervisi/:id/cetak (halaman cetak)
  routes/templates.ts # /admin/templat, /templat/:id/predikat
  scripts/            # migrate.ts, seed.ts, setup-db.ts
migrations/001_init.sql
public/css/app.css    # sumber Tailwind v4
public/dist/app.css   # hasil build (dibangun ulang tiap rilis)
tests/                # bun test
deploy/               # backup.sh, gezyspv-pro.service, DEPLOY.md
                      # (restore diimplementasi di lib/backup.ts,
                      #  dipanggil dari route /admin/backup/restore)
templates-impor/      # contoh guru.csv, kelas.csv
```
