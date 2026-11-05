# Deploy gezyspv-pro di VPS (spv.pakgun.web.id)

Panduan langkah-demi-langkah untuk VPS Pak Gun. Deploy di tangan Pak Gun;
dokumen ini hanya daftar perintah siap salin-tempel.

**Keadaan VPS saat ini (2026-11-05):** MariaDB **11.8.6** sudah terpasang
(`mariadb.service` aktif, enabled) dan dipakai **GezyCBT** (database
`gezycbt`, API di `/home/ubuntu/gezycbt/current`, domain
`cbt.pakgun.web.id`, listen hanya `127.0.0.1:3306`). gezyspv-pro memakai
server MariaDB yang sama dengan **database + user terpisah** — jangan
pernah menyentuh database, user, atau service GezyCBT.

**Yang dibutuhkan:** Bun terpasang, nginx + HTTPS (certbot), git.

## 1. Buat database + user terpisah

Sebagai root OS (MariaDB memakai otentikasi `unix_socket` untuk root).
Ganti `KATA-SANDI-KUAT` dengan kata sandi baru yang kuat dan simpan di
luar repo. **Jangan** memakai database/user `gezycbt`.

```bash
sudo mysql <<'SQL'
CREATE DATABASE gezyspv CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'gezyspv'@'127.0.0.1' IDENTIFIED BY 'KATA-SANDI-KUAT';
GRANT ALL PRIVILEGES ON gezyspv.* TO 'gezyspv'@'127.0.0.1';
FLUSH PRIVILEGES;
SQL
```

## 2. Ambil kode

```bash
sudo mkdir -p /opt/gezyspv-pro
sudo chown $USER:$USER /opt/gezyspv-pro
cd /opt/gezyspv-pro
git clone https://github.com/pakgun10/gezyspv-pro.git .
bun install
bun run build:css
```

## 3. Isi `.env`

```bash
cp .env.example .env
nano .env
```

Isi yang wajib diubah:

```ini
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=gezyspv
DB_PASSWORD=KATA-SANDI-KUAT
DB_NAME=gezyspv
PORT=3000
DATA_DIR=/opt/gezyspv-pro/data
SESSION_COOKIE_SECURE=true
```

Pastikan port `3000` belum dipakai aplikasi lain di VPS (mis. API
GezyCBT). Cek: `ss -tlnp | grep 3000` — harus kosong sebelum lanjut.

## 4. Migrasi — sekaligus pembuktian MariaDB 11.8

Migrasi aplikasi ditulis dan diuji di MariaDB 10.11 lokal; menjalankan
perintah ini di VPS adalah **pembuktian pertama migrasi di 11.8**.
Bila gagal, hentikan di sini dan laporkan pesannya — jangan lanjut.

```bash
bun run migrate
```

Harapan: `Migrasi: 001_init.sql` (atau "tidak ada yang baru" bila sudah
pernah jalan). Lalu:

```bash
bun run seed
```

## 5. Jalankan sekali untuk tes

```bash
bun start
curl -s http://127.0.0.1:3000/api/kesehatan
# Harapan: {"ok":true,"app":"gezyspv-pro","fase":4,"domain":"spv.pakgun.web.id"}
```

Hentikan dengan `Ctrl+C`. Akun admin awal: username `admin`, kata sandi
`admin123`, **wajib ganti kata sandi saat login pertama**
(`must_change_password = 1`). Ganti segera setelah login pertama di
produksi — jangan biarkan `admin123` hidup di server publik.

## 6. Pasang service systemd

Sesuaikan dulu bila path/user berbeda (berkas contoh memakai
`/opt/gezyspv-pro`, user `gezyspv`, Bun di `/home/gezyspv/.bun/bin/bun`).
Bila aplikasi jalan sebagai user `ubuntu`, ubah `User=` dan
`ExecStart=` serta `WorkingDirectory`/`EnvironmentFile` di berkas itu.

```bash
sudo cp deploy/gezyspv-pro.service /etc/systemd/system/gezyspv-pro.service
sudo nano /etc/systemd/system/gezyspv-pro.service   # sesuaikan bila perlu
sudo systemctl daemon-reload
sudo systemctl enable --now gezyspv-pro
sudo systemctl status gezyspv-pro --no-pager
journalctl -u gezyspv-pro -f   # lihat log; Ctrl+C untuk keluar
```

Unit ini sudah menyatakan `After=mariadb.service` +
`Requires=mariadb.service` (pola yang sama seperti
`gezycbt-api.service`) — aplikasi hanya start sesudah MariaDB siap.

## 7. Reverse proxy HTTPS (nginx) untuk spv.pakgun.web.id

```nginx
server {
    listen 80;
    server_name spv.pakgun.web.id;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name spv.pakgun.web.id;

    ssl_certificate     /etc/letsencrypt/live/spv.pakgun.web.id/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/spv.pakgun.web.id/privkey.pem;

    client_max_body_size 10m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d spv.pakgun.web.id   # bila sertifikat belum ada
```

## 8. Verifikasi akhir

```bash
curl -s https://spv.pakgun.web.id/api/kesehatan
# Harapan: {"ok":true,"app":"gezyspv-pro","fase":4,"domain":"spv.pakgun.web.id"}
```

Buka `https://spv.pakgun.web.id/`, masuk sebagai `admin`, **ganti kata
sandi** saat diminta, lalu buat akun guru, nyalakan flag supervisor pada
akun yang ditunjuk, dan atur penugasan di menu admin. Cek juga halaman cetak satu sesi dan `/admin/backup`
(buat satu backup pertama). Migrasi `002_role_flags.sql` berjalan
otomatis lewat `bun run migrate` dan mengonversi akun supervisor lama
menjadi guru + flag (lihat README bagian "Model peran").

## 9. Backup & restore di VPS

- **Backup:** tombol "Buat Backup Sekarang" di `/admin/backup`, atau
  `bash deploy/backup.sh` dari folder aplikasi. Hasil di
  `data/backups/`: `db-*.sql.gz` + `bukti-*.tar.gz`.
  Contoh cron mingguan (jalankan `crontab -e` sebagai user aplikasi):
  `0 2 * * 0 cd /opt/gezyspv-pro && bash deploy/backup.sh >> data/backups/backup.log 2>&1`
- **Restore:** dari halaman yang sama (`/admin/backup`, bagian Restore)
  — pilih pasangan dump + arsip, ketik `RESTORE`, centang pernyataan.
  Restore mengganti database + folder bukti dan membersihkan semua
  sesi login. **Uji restore di salinan percobaan dulu** sebelum
  restore di produksi (lihat README bagian "Backup & restore").
- Salin berkas backup ke luar VPS secara berkala (`scp`/rsync) — backup
  yang hanya ada di server yang sama bukan backup yang aman.

## 10. Deploy ulang (update)

```bash
cd /opt/gezyspv-pro
git pull
bun install
bun run build:css
sudo systemctl restart gezyspv-pro
curl -s https://spv.pakgun.web.id/api/kesehatan
```

Migrasi baru (bila ada) jalan otomatis saat service start — periksa
log bila restart gagal: `journalctl -u gezyspv-pro -n 50 --no-pager`.

## Yang TIDAK boleh dilakukan

- Jangan memakai database `gezycbt` atau user database GezyCBT untuk
  aplikasi ini.
- Jangan menjalankan `bun run setup-db` di VPS — skrip itu untuk
  pengembangan lokal (membuat `gezyspv_dev`/`gezyspv_test`); di VPS
  pakai SQL langkah 1.
- Jangan commit `.env`, `data/`, atau `node_modules/` ke repo.
- Jangan mengubah `DB_NAME` menjadi `gezycbt` di `.env` mana pun.
