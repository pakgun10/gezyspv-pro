import type mysql from "mysql2/promise";
import type { RowDataPacket } from "mysql2/promise";

export type CsvError = { row: number; message: string };
export type CsvResult<T> = { ok: true; rows: T[] } | { ok: false; errors: CsvError[] };

/**
 * Parser CSV minimal: menangani koma, tanda petik ganda ("..."),
 * petik ganda di dalam petik (""), dan baris CRLF/LF.
 * Baris kosong dilewati. Baris pertama adalah header.
 */
export function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };
  const src = text.replace(/^\uFEFF/, ""); // buang BOM
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      pushField();
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      pushRow();
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length > 0) pushRow();
  const nonEmpty = rows.filter((r) => r.some((c) => c.trim() !== ""));
  if (nonEmpty.length === 0) return { headers: [], rows: [] };
  const headers = nonEmpty[0]!.map((h) => h.trim());
  return { headers, rows: nonEmpty.slice(1) };
}

export type GuruRow = {
  username: string;
  nama: string;
  nip: string;
  password_awal: string;
};

export type KelasRow = { nama_kelas: string; level_label: string };

function checkHeaders(
  headers: string[],
  expected: string[],
): CsvError[] {
  const errors: CsvError[] = [];
  for (const col of expected) {
    if (!headers.includes(col)) {
      errors.push({ row: 1, message: `Kolom wajib tidak ada: ${col}` });
    }
  }
  return errors;
}

function toObject(headers: string[], row: string[]): Record<string, string> {
  const obj: Record<string, string> = {};
  headers.forEach((h, i) => {
    obj[h] = (row[i] ?? "").trim();
  });
  return obj;
}

/** Validasi isi CSV guru (tanpa menyentuh DB). */
export function validateGuruCsv(text: string): CsvResult<GuruRow> {
  const { headers, rows } = parseCsv(text);
  const errors = checkHeaders(headers, ["username", "nama", "nip", "password_awal"]);
  if (errors.length > 0) return { ok: false, errors };
  const out: GuruRow[] = [];
  const seen = new Set<string>();
  rows.forEach((r, i) => {
    const line = i + 2; // baris 1 = header
    const o = toObject(headers, r);
    const username = o.username ?? "";
    if (!username) {
      errors.push({ row: line, message: "username kosong" });
      return;
    }
    if (!/^[a-zA-Z0-9._-]{3,50}$/.test(username)) {
      errors.push({ row: line, message: `username tidak valid: ${username}` });
      return;
    }
    if (seen.has(username)) {
      errors.push({ row: line, message: `username duplikat di berkas: ${username}` });
      return;
    }
    seen.add(username);
    if (!o.nama) {
      errors.push({ row: line, message: "nama kosong" });
      return;
    }
    out.push({
      username,
      nama: o.nama,
      nip: o.nip ?? "",
      password_awal: o.password_awal ?? "",
    });
  });
  if (errors.length > 0) return { ok: false, errors };
  if (out.length === 0) {
    return { ok: false, errors: [{ row: 1, message: "Tidak ada baris data" }] };
  }
  return { ok: true, rows: out };
}

/** Validasi isi CSV kelas (tanpa menyentuh DB). */
export function validateKelasCsv(text: string): CsvResult<KelasRow> {
  const { headers, rows } = parseCsv(text);
  const errors = checkHeaders(headers, ["nama_kelas", "level_label"]);
  if (errors.length > 0) return { ok: false, errors };
  const out: KelasRow[] = [];
  const seen = new Set<string>();
  rows.forEach((r, i) => {
    const line = i + 2;
    const o = toObject(headers, r);
    if (!o.nama_kelas) {
      errors.push({ row: line, message: "nama_kelas kosong" });
      return;
    }
    if (seen.has(o.nama_kelas)) {
      errors.push({ row: line, message: `nama_kelas duplikat di berkas: ${o.nama_kelas}` });
      return;
    }
    seen.add(o.nama_kelas);
    out.push({ nama_kelas: o.nama_kelas, level_label: o.level_label ?? "" });
  });
  if (errors.length > 0) return { ok: false, errors };
  if (out.length === 0) {
    return { ok: false, errors: [{ row: 1, message: "Tidak ada baris data" }] };
  }
  return { ok: true, rows: out };
}

export type ImportResult =
  | { ok: true; inserted: number }
  | { ok: false; errors: CsvError[] };

/**
 * Impor guru secara transaksional: satu baris bermasalah (validasi
 * gagal, atau username sudah ada di database) membatalkan SELURUH
 * impor. Akun baru ditandai must_change_password = 1. Bila
 * password_awal kosong, dipakai defaultPassword dari form impor.
 * Peran yang dibuat: guru.
 */
export async function importGuruCsv(
  pool: mysql.Pool,
  text: string,
  defaultPassword: string,
  hashPassword: (plain: string) => Promise<string>,
): Promise<ImportResult> {
  const parsed = validateGuruCsv(text);
  if (!parsed.ok) return parsed;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [existing] = await conn.query<(RowDataPacket & { username: string })[]>(
      "SELECT username FROM users WHERE username IN (?)",
      [parsed.rows.map((r) => r.username)],
    );
    if (existing.length > 0) {
      await conn.rollback();
      return {
        ok: false,
        errors: existing.map((e) => ({
          row: 0,
          message: `username sudah ada di database: ${e.username}`,
        })),
      };
    }
    for (const r of parsed.rows) {
      const hash = await hashPassword(r.password_awal || defaultPassword);
      await conn.query(
        `INSERT INTO users (username, name, nip, password_hash, role, must_change_password)
         VALUES (?, ?, ?, ?, 'guru', 1)`,
        [r.username, r.nama, r.nip || null, hash],
      );
    }
    await conn.commit();
    return { ok: true, inserted: parsed.rows.length };
  } catch (err) {
    await conn.rollback();
    return { ok: false, errors: [{ row: 0, message: (err as Error).message }] };
  } finally {
    conn.release();
  }
}

/**
 * Impor kelas secara transaksional ke satu periode. Nama kelas harus
 * unik per periode (cocok-persis); duplikat membatalkan seluruh impor.
 */
export async function importKelasCsv(
  pool: mysql.Pool,
  text: string,
  periodId: number,
): Promise<ImportResult> {
  const parsed = validateKelasCsv(text);
  if (!parsed.ok) return parsed;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [periods] = await conn.query<(RowDataPacket & { id: number })[]>(
      "SELECT id FROM periods WHERE id = ?",
      [periodId],
    );
    if (periods.length === 0) {
      await conn.rollback();
      return { ok: false, errors: [{ row: 0, message: `Periode tidak ditemukan: ${periodId}` }] };
    }
    const [existing] = await conn.query<(RowDataPacket & { name: string })[]>(
      "SELECT name FROM classes WHERE period_id = ? AND name IN (?)",
      [periodId, parsed.rows.map((r) => r.nama_kelas)],
    );
    if (existing.length > 0) {
      await conn.rollback();
      return {
        ok: false,
        errors: existing.map((e) => ({
          row: 0,
          message: `kelas sudah ada di periode ini: ${e.name}`,
        })),
      };
    }
    for (const r of parsed.rows) {
      await conn.query(
        "INSERT INTO classes (period_id, name, level_label) VALUES (?, ?, ?)",
        [periodId, r.nama_kelas, r.level_label || null],
      );
    }
    await conn.commit();
    return { ok: true, inserted: parsed.rows.length };
  } catch (err) {
    await conn.rollback();
    return { ok: false, errors: [{ row: 0, message: (err as Error).message }] };
  } finally {
    conn.release();
  }
}
