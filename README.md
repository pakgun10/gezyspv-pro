# gezyspv-pro

Aplikasi supervisi akademik berbasis web untuk **SMPN 1 Punggur**
(domain: `spv.pakgun.web.id`). Supervisor melakukan diskusi pra
observasi, kemudian mengobservasi guru secara langsung saat
pembelajaran berlangsung, dilanjutkan dengan diskusi pasca observasi
dan menyusun rencana tindak lanjut. Bukan CBT, bukan penilaian murid.

Stack: **Bun + Elysia + MariaDB**, Tailwind CSS v4. Rencana lengkap:
`../gezyspv-pro-plan/implementation_plan.md`.

> **Status: Fase 3 (profil, rekap, dan narasi) selesai.** Yang sudah ada:
> migrasi MariaDB, auth username + kata sandi, pengaturan sekolah,
> CRUD periode/kelas/akun, penugasan supervisor → guru, impor CSV
> transaksional, seed templat PPB/GM, halaman login + dasbor, skrip
> backup, **CRUD templat instrumen** (elemen, indikator,
> pertanyaan pra/pasca, butir RTL, prinsip, label skala, rentang
> predikat), status draf/aktif/arsip, salin templat untuk tahun ajaran
> baru, serta snapshot templat per sesi, **sesi supervisi
> lengkap** (buat sesi dari templat aktif, alur status
> pra → observasi → pasca → tindak_lanjut → selesai, pra-observasi,
> skor observasi per indikator, refleksi pasca oleh guru, rencana
> tindak lanjut, foto bukti + URL video), **dan profil guru, rekap,
> dan narasi** (tren skor SVG, distribusi per indikator, skor guru
> per periode, rekap sekolah dan kelas, daftar guru yang belum
> disupervisi pada periode aktif, generator + editor narasi).
> Cetak dibangun pada Fase 4.

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

1. **Admin** membuat akun supervisor + guru dan mengatur penugasan
   di menu Penugasan (Kepala Sekolah, flag Kepsek, bisa mensupervisi
   semua guru tanpa penugasan).
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
ditugaskan yang belum disupervisi pada periode aktif; dasbor guru
menampilkan sesi atas dirinya, termasuk yang **"Menunggu refleksi
Anda"**. Foto bukti disimpan di `DATA_DIR/bukti` (default `./data/bukti`)
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
- **Skala penilaian:** 4, 10, atau 100. Mengubah skala ditolak bila
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

## Tes

```bash
bun test
```

Tes memakai database terpisah (`gezyspv_test`,
`gezyspv_test_http` untuk tes HTTP, dan `gezyspv_test_templates`
untuk tes templat) yang dibuat otomatis oleh
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

## Backup & restore

Backup dibuat lewat tombol di `/admin/backup` atau:

```bash
bash deploy/backup.sh
```

Hasilnya di `data/backups/`: `db-YYYYMMDD-HHMMSS.sql.gz` (dump
MariaDB) dan `bukti-YYYYMMDD-HHMMSS.tar.gz` (arsip foto bukti).
Restore manual:

```bash
# Hentikan aplikasi dulu, lalu:
zcat data/backups/db-<cap>.sql.gz | mysql -u gezyspv -p gezyspv_dev
tar -xzf data/backups/bukti-<cap>.tar.gz -C data/
# Restore membersihkan sesi login: semua pengguna harus login ulang.
mysql -u gezyspv -p -e "DELETE FROM gezyspv_dev.user_sessions;"
```

## Deploy (VPS)

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
  routes/auth.ts      # /login, /logout, /ganti-sandi
  routes/dashboard.ts # / (dasbor per peran)
  routes/admin.ts     # /admin/* (pengaturan, guru, kelas,
                      #   periode, penugasan, backup)
  scripts/            # migrate.ts, seed.ts, setup-db.ts
migrations/001_init.sql
public/css/app.css    # sumber Tailwind v4
public/dist/app.css   # hasil build (dibangun ulang tiap rilis)
tests/                # bun test
deploy/               # backup.sh, gezyspv-pro.service
templates-impor/      # contoh guru.csv, kelas.csv
```
