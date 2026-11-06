import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type mysql from "mysql2/promise";
import type { RowDataPacket } from "mysql2/promise";

/**
 * Gambar kop laporan — pola GezyRaport (admin unggah satu gambar kop
 * PNG/JPEG maks 2 MB → disimpan di data/kop → tampil di atas laporan).
 *
 * - Nama berkas selalu hasil generate server (kop-<timestamp>.<ext>);
 *   settings.kop_path menyimpan nama berkasnya saja.
 * - Bila kop_path NULL, laporan memakai kop teks lama (nama + alamat
 *   sekolah dari settings).
 * - Berkas TIDAK ikut backup/restore otomatis (di luar folder bukti);
 *   hapus/ganti kop menghapus berkas lama dari disk.
 */

export const MAX_KOP_BYTES = 2 * 1024 * 1024;

export const ALLOWED_KOP_MIME: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
};

export type KopSettings = {
  school_name: string;
  school_address: string | null;
  kop_path: string | null;
};

export function kopDir(): string {
  const base = process.env.DATA_DIR ?? "./data";
  return path.join(base, "kop");
}

/** Validasi satu berkas kop sebelum disimpan; kembalikan pesan error atau null. */
export function validateKop(file: { size: number; type: string }): string | null {
  if (!ALLOWED_KOP_MIME[file.type?.toLowerCase() ?? ""]) {
    return "Gambar kop harus berformat PNG atau JPEG.";
  }
  if (file.size > MAX_KOP_BYTES) {
    return "Ukuran gambar kop melebihi 2 MB.";
  }
  if (file.size <= 0) return "Berkas gambar kop kosong.";
  return null;
}

/** Content-Type untuk berkas kop berdasarkan ekstensi nama berkas. */
export function kopContentType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  return "application/octet-stream";
}

/** Nama berkas kop saat ini dari settings (null bila belum ada / baris belum ada). */
export async function getKopPath(pool: mysql.Pool): Promise<string | null> {
  const [rows] = await pool.query<(RowDataPacket & { kop_path: string | null })[]>(
    "SELECT kop_path FROM settings WHERE id = 1",
  );
  const v = rows[0]?.kop_path ?? null;
  // Tolak nilai yang bukan nama berkas polos (pertahanan traversal).
  if (!v || v.includes("/") || v.includes("\\") || v.includes("..")) return null;
  return v;
}

/** Nama + alamat sekolah + kop_path untuk kop laporan. */
export async function getKopSettings(pool: mysql.Pool): Promise<KopSettings> {
  const [rows] = await pool.query<
    (RowDataPacket & { school_name: string; school_address: string | null; kop_path: string | null })[]
  >("SELECT school_name, school_address, kop_path FROM settings WHERE id = 1");
  return toKopSettings(rows[0] ?? null);
}

/** Normalisasi satu baris settings menjadi KopSettings (kop_path bukan nama berkas polos ditolak). */
export function toKopSettings(
  row: { school_name?: string | null; school_address?: string | null; kop_path?: string | null } | null,
): KopSettings {
  return {
    school_name: row?.school_name ?? "SMPN 1 Punggur",
    school_address: row?.school_address ?? null,
    kop_path:
      row?.kop_path && !row.kop_path.includes("/") && !row.kop_path.includes("..")
        ? row.kop_path
        : null,
  };
}

/** Jalur absolut berkas kop di disk (selalu di dalam kopDir). */
export function kopFilePath(filename: string): string {
  return path.join(kopDir(), path.basename(filename));
}

/**
 * Simpan gambar kop baru: validasi, tulis berkas, hapus berkas lama,
 * catat nama berkas ke settings. Mengembalikan nama berkas yang disimpan.
 */
export async function storeKop(
  pool: mysql.Pool,
  data: Buffer,
  mime: string,
): Promise<string> {
  const err = validateKop({ size: data.length, type: mime });
  if (err) throw new Error(err);
  const ext = ALLOWED_KOP_MIME[mime.toLowerCase()]!;
  const filename = `kop-${Date.now()}${ext}`;
  const dir = kopDir();
  await mkdir(dir, { recursive: true });
  const fullPath = path.join(dir, filename);
  await writeFile(fullPath, data);
  const old = await getKopPath(pool);
  try {
    await pool.query(
      `INSERT INTO settings (id, kop_path) VALUES (1, ?)
       ON DUPLICATE KEY UPDATE kop_path = VALUES(kop_path)`,
      [filename],
    );
  } catch (e) {
    // Jangan tinggalkan berkas yatim bila baris DB gagal ditulis.
    await rm(fullPath, { force: true });
    throw e;
  }
  if (old && old !== filename) await rm(kopFilePath(old), { force: true });
  return filename;
}

/** Hapus gambar kop: berkas fisik + kop_path di settings jadi NULL. */
export async function deleteKop(pool: mysql.Pool): Promise<void> {
  const old = await getKopPath(pool);
  await pool.query("UPDATE settings SET kop_path = NULL WHERE id = 1");
  if (old) await rm(kopFilePath(old), { force: true });
}

/** Escape kecil untuk teks kop (dipakai di luar layout aplikasi). */
function escKop(s: string | null | undefined): string {
  return (s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Blok kop untuk laporan: gambar kop bila ada, bila tidak kop teks
 * (nama sekolah + alamat) seperti halaman Cetak selama ini.
 * Dipakai halaman Cetak dan cetakan halaman rekap.
 */
export function kopBlock(st: KopSettings): string {
  if (st.kop_path) {
    return `<div class="kop-gambar"><img src="/kop" alt="Kop ${escKop(st.school_name)}"></div>`;
  }
  return `<div class="kop">
    <div class="nama">${escKop(st.school_name)}</div>
    ${st.school_address ? `<div class="alamat">${escKop(st.school_address)}</div>` : ""}
  </div>`;
}

/** CSS kop untuk laporan. Halaman Cetak memakai PRINT_CSS-nya sendiri. */
export const KOP_CSS = `
  .kop { text-align: center; border-bottom: 3px double #111; padding-bottom: 10px; margin-bottom: 14px; }
  .kop .nama { font-size: 22px; font-weight: bold; text-transform: uppercase; }
  .kop .alamat { font-size: 12px; color: #333; }
  .kop-gambar { margin-bottom: 14px; }
  .kop-gambar img { width: 100%; height: auto; display: block; }
`;

/**
 * CSS print untuk halaman rekap (layout aplikasi): kop hanya tampil
 * saat mencetak, navigasi/header/footer/tombol disembunyikan.
 * Disisipkan sebagai <style> di badan halaman rekap.
 */
export const REKAP_PRINT_CSS = `
  <style>
    .kop-cetak { display: none; }
    ${KOP_CSS}
    @media print {
      header, footer, .no-print { display: none !important; }
      main { max-width: none !important; padding: 0 !important; }
      .kop-cetak { display: block !important; }
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      @page { margin: 18mm 16mm; }
    }
  </style>
`;
