#!/usr/bin/env bash
# gezyspv-pro — backup database + folder bukti.
# Dipakai oleh tombol "Buat Backup" di /admin/backup dan manual:
#   bash deploy/backup.sh
# Membaca kredensial dari environment (.env dimuat oleh pemanggil
# atau systemd EnvironmentFile). Hasil: data/backups/
#   db-YYYYMMDD-HHMMSS.sql.gz dan bukti-YYYYMMDD-HHMMSS.tar.gz
set -euo pipefail

cd "$(dirname "$0")/.."
# Muat .env bila ada (tanpa mengekspor rahasia ke log).
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-3306}"
DB_USER="${DB_USER:-gezyspv}"
DB_NAME="${DB_NAME:-gezyspv_dev}"
DATA_DIR="${DATA_DIR:-./data}"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="$DATA_DIR/backups"
mkdir -p "$OUT"

# MYSQL_PWD dipakai agar kata sandi tidak tampil di daftar proses.
export MYSQL_PWD="${DB_PASSWORD:-}"
mysqldump -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" \
  --single-transaction --routines --triggers "$DB_NAME" \
  | gzip > "$OUT/db-$STAMP.sql.gz"
unset MYSQL_PWD
echo "dump: $OUT/db-$STAMP.sql.gz"

if [ -d "$DATA_DIR/bukti" ]; then
  tar -czf "$OUT/bukti-$STAMP.tar.gz" -C "$DATA_DIR" bukti
  echo "bukti: $OUT/bukti-$STAMP.tar.gz"
else
  echo "bukti: folder $DATA_DIR/bukti belum ada, dilewati."
fi

echo "Backup selesai: $STAMP"
