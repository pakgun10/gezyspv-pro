import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type mysql from "mysql2/promise";
import type { RowDataPacket } from "mysql2/promise";

/**
 * Bukti foto / URL video — Fase 2 (plan bagian 5 & 8, pola GezyAsko).
 *
 * - Foto: kompresi di klien (canvas JPEG) sampai <= 5 MB; server menolak
 *   berkas > 5 MB, mime di luar jpg/png/webp, dan nama berkas dari
 *   pengguna (server selalu memakai nama hasil generate UUID + ekstensi
 *   aman). Maksimal 5 foto per sesi.
 * - Video: tidak diunggah sebagai berkas di MVP; hanya URL https yang
 *   ditempel dan ditampilkan sebagai tautan.
 * - Berkas disimpan di DATA_DIR/bukti (default ./data/bukti), bukan
 *   folder statis publik; dilayani lewat /bukti/:id dengan cek hak.
 */

export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
export const MAX_PHOTOS_PER_SESSION = 5;

export const ALLOWED_PHOTO_MIME: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

export type EvidenceRow = {
  id: number;
  session_id: number;
  kind: "foto" | "video_url";
  path: string | null;
  url: string | null;
  caption: string | null;
  mime: string | null;
  bytes: number | null;
  created_at: string;
};

export function evidenceDir(): string {
  const base = process.env.DATA_DIR ?? "./data";
  return path.join(base, "bukti");
}

/** Validasi satu berkas foto sebelum disimpan; kembalikan pesan error atau null. */
export function validatePhoto(file: { size: number; type: string }): string | null {
  if (!ALLOWED_PHOTO_MIME[file.type]) {
    return "Foto harus berformat JPG, PNG, atau WebP.";
  }
  if (file.size > MAX_PHOTO_BYTES) {
    return "Ukuran foto melebihi 5 MB. Kecilkan dulu (kompresi otomatis di halaman akan membantu).";
  }
  if (file.size <= 0) return "Berkas foto kosong.";
  return null;
}

/** Validasi URL video: harus https. */
export function validateVideoUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return "URL video tidak valid.";
  }
  if (parsed.protocol !== "https:") return "URL video harus memakai https.";
  return null;
}

export async function countPhotos(pool: mysql.Pool, sessionId: number): Promise<number> {
  const [rows] = await pool.query<(RowDataPacket & { c: number })[]>(
    "SELECT COUNT(*) AS c FROM evidence WHERE session_id = ? AND kind = 'foto'",
    [sessionId],
  );
  return rows[0]?.c ?? 0;
}

export async function listEvidence(pool: mysql.Pool, sessionId: number): Promise<EvidenceRow[]> {
  const [rows] = await pool.query<(RowDataPacket & EvidenceRow)[]>(
    "SELECT * FROM evidence WHERE session_id = ? ORDER BY created_at, id",
    [sessionId],
  );
  return rows as EvidenceRow[];
}

export async function getEvidence(pool: mysql.Pool, id: number): Promise<EvidenceRow | null> {
  const [rows] = await pool.query<(RowDataPacket & EvidenceRow)[]>(
    "SELECT * FROM evidence WHERE id = ?",
    [id],
  );
  return (rows[0] as EvidenceRow | undefined) ?? null;
}

/**
 * Simpan satu foto. `data` adalah isi berkas (sudah terkompresi di klien);
 * nama berkas selalu hasil generate server (UUID + ekstensi aman).
 */
export async function storePhoto(
  pool: mysql.Pool,
  sessionId: number,
  data: Buffer,
  mime: string,
  caption: string,
): Promise<number> {
  const err = validatePhoto({ size: data.length, type: mime });
  if (err) throw new Error(err);
  if ((await countPhotos(pool, sessionId)) >= MAX_PHOTOS_PER_SESSION) {
    throw new Error(`Maksimal ${MAX_PHOTOS_PER_SESSION} foto per sesi.`);
  }
  const ext = ALLOWED_PHOTO_MIME[mime]!;
  const filename = `${randomUUID()}${ext}`;
  const dir = evidenceDir();
  await mkdir(dir, { recursive: true });
  const fullPath = path.join(dir, filename);
  await writeFile(fullPath, data);
  try {
    const [res] = await pool.query<import("mysql2/promise").ResultSetHeader>(
      `INSERT INTO evidence (session_id, kind, path, caption, mime, bytes)
       VALUES (?, 'foto', ?, ?, ?, ?)`,
      [sessionId, filename, caption.slice(0, 200), mime, data.length],
    );
    return res.insertId;
  } catch (e) {
    // Jangan tinggalkan berkas yatim bila baris DB gagal ditulis.
    await rm(fullPath, { force: true });
    throw e;
  }
}

/** Simpan satu URL video (tautan https saja). */
export async function addVideoUrl(
  pool: mysql.Pool,
  sessionId: number,
  url: string,
  caption: string,
): Promise<number> {
  const err = validateVideoUrl(url);
  if (err) throw new Error(err);
  const [res] = await pool.query<import("mysql2/promise").ResultSetHeader>(
    `INSERT INTO evidence (session_id, kind, url, caption)
     VALUES (?, 'video_url', ?, ?)`,
    [sessionId, url.trim(), caption.slice(0, 200)],
  );
  return res.insertId;
}

/** Hapus satu bukti; bila foto, hapus juga berkas fisiknya. */
export async function deleteEvidence(pool: mysql.Pool, id: number): Promise<void> {
  const row = await getEvidence(pool, id);
  if (!row) throw new Error("Bukti tidak ditemukan.");
  await pool.query("DELETE FROM evidence WHERE id = ?", [id]);
  if (row.kind === "foto" && row.path) {
    const fullPath = path.join(evidenceDir(), path.basename(row.path));
    await rm(fullPath, { force: true });
  }
}
