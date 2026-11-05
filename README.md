# gezyspv-pro

Aplikasi supervisi akademik berbasis web untuk **SMPN 1 Punggur**
(domain: `spv.pakgun.web.id`). Supervisor melakukan diskusi pra
observasi, kemudian mengobservasi guru secara langsung saat
pembelajaran berlangsung, dilanjutkan dengan diskusi pasca observasi
dan menyusun rencana tindak lanjut. Bukan CBT, bukan penilaian murid.

Stack: **Bun + Elysia + MariaDB**, Tailwind CSS v4. Rencana lengkap:
`../gezyspv-pro-plan/implementation_plan.md`.

> **Status: Fase 0 (fondasi) selesai.** Yang sudah ada: migrasi
> MariaDB, auth username + kata sandi, pengaturan sekolah, CRUD
> periode/kelas/akun, penugasan supervisor → guru, impor CSV
> transaksional, seed templat PPB/GM, halaman login + dasbor, dan
> skrip backup. Sesi supervisi, skor, rekap, dan cetak dibangun
> pada Fase 1–4.

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

## Tes

```bash
bun test
```

Tes memakai database terpisah (`gezyspv_test`, dan
`gezyspv_test_http` untuk tes HTTP) yang dibuat otomatis oleh
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
