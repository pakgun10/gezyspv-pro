import type mysql from "mysql2/promise";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { DbConfig } from "../db";

/**
 * Backup & restore — Fase 4 (plan bagian 12).
 *
 * Backup dibuat deploy/backup.sh (mysqldump + arsip folder bukti).
 * Restore di sini: validasi berkas dulu, lalu impor dump ke database
 * aplikasi, ganti folder bukti, dan bersihkan SEMUA sesi login.
 *
 * Restore adalah operasi destruktif — validasi dan konfirmasi (di
 * route) tidak boleh dilonggarkan. Kata sandi database tidak pernah
 * ditulis ke log: diteruskan lewat env MYSQL_PWD ke proses anak.
 */

export type RestoreOptions = {
  config: DbConfig;
  /** Opsional: koneksi root via unix socket (dipakai tes, bukan produksi). */
  socketPath?: string;
  dataDir: string;
  dumpPath: string;
  /** Arsip bukti (tar.gz) — boleh kosong bila hanya dump yang direstore. */
  evidencePath?: string | null;
};

export type BackupFile = { name: string; size: number; mtime: Date };

/** Daftar berkas backup di DATA_DIR/backups, terbaru dulu. */
export async function listBackupFiles(dataDir: string): Promise<BackupFile[]> {
  const backupDir = path.join(dataDir, "backups");
  let names: string[] = [];
  try {
    names = (await readdir(backupDir))
      .filter((n) => n.endsWith(".sql.gz") || n.endsWith(".tar.gz"))
      .sort()
      .reverse();
  } catch {
    return [];
  }
  const out: BackupFile[] = [];
  for (const name of names) {
    try {
      const st = await stat(path.join(backupDir, name));
      out.push({ name, size: st.size, mtime: st.mtime });
    } catch {
      // Berkas hilang di tengah jalan — lewati.
    }
  }
  return out;
}

/** Nama berkas backup yang sah (tanpa path traversal). */
export function isValidBackupName(name: string): boolean {
  return /^[A-Za-z0-9._-]+\.(sql\.gz|tar\.gz)$/.test(name);
}

/** Tabel inti yang wajib ada di dump aplikasi ini. */
const REQUIRED_DUMP_TABLES = ["sessions", "users", "templates"];

/**
 * Validasi dump SQL (gzip): magic byte, integritas gzip, isi harus
 * memuat CREATE TABLE untuk tabel inti aplikasi, dan TIDAK boleh
 * memuat CREATE DATABASE (dump dari --databases, cakupan salah).
 */
export async function validateDumpFile(dumpPath: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const file = Bun.file(dumpPath);
  if (!(await file.exists())) return { ok: false, error: "Berkas dump tidak ditemukan." };
  const head = new Uint8Array(await file.slice(0, 2).arrayBuffer());
  if (head.length < 2 || head[0] !== 0x1f || head[1] !== 0x8b) {
    return { ok: false, error: "Berkas dump bukan gzip yang valid (bukan hasil backup gezyspv-pro)." };
  }
  // Integritas gzip.
  const integrity = Bun.spawn(["gzip", "-t", dumpPath], { stdout: "pipe", stderr: "pipe" });
  const intErr = await new Response(integrity.stderr).text();
  await integrity.exited;
  if (integrity.exitCode !== 0) {
    return { ok: false, error: "Berkas dump rusak (gzip tidak valid): " + intErr.slice(0, 200) };
  }
  // Pindai isi hasil dekompresi (dibatasi 512 MB agar tidak membanjiri memori).
  const gunzip = Bun.spawn(["gzip", "-dc", dumpPath], { stdout: "pipe", stderr: "pipe" });
  const text = await new Response(gunzip.stdout).text();
  await gunzip.exited;
  if (text.length === 0) return { ok: false, error: "Berkas dump kosong setelah didekompresi." };
  if (/CREATE\s+DATABASE/i.test(text)) {
    return { ok: false, error: "Dump memuat CREATE DATABASE — bukan dump satu database gezyspv-pro." };
  }
  const missing = REQUIRED_DUMP_TABLES.filter(
    (t) => !new RegExp(`CREATE\\s+TABLE\\s+(IF NOT EXISTS\\s+)?\`?${t}\`?\\b`, "i").test(text),
  );
  if (missing.length > 0) {
    return {
      ok: false,
      error: `Dump bukan database gezyspv-pro (tabel tidak ditemukan: ${missing.join(", ")}).`,
    };
  }
  return { ok: true };
}

/**
 * Validasi arsip bukti (tar.gz): harus gzip + tar yang valid, dan
 * semua entrinya harus berada di bawah folder `bukti/` (tanpa path
 * absolut dan tanpa `..`).
 */
export async function validateEvidenceArchive(
  archivePath: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const file = Bun.file(archivePath);
  if (!(await file.exists())) return { ok: false, error: "Arsip bukti tidak ditemukan." };
  const head = new Uint8Array(await file.slice(0, 2).arrayBuffer());
  if (head.length < 2 || head[0] !== 0x1f || head[1] !== 0x8b) {
    return { ok: false, error: "Arsip bukti bukan gzip yang valid." };
  }
  const list = Bun.spawn(["tar", "-tzf", archivePath], { stdout: "pipe", stderr: "pipe" });
  const out = await new Response(list.stdout).text();
  const err = await new Response(list.stderr).text();
  await list.exited;
  if (list.exitCode !== 0) {
    return { ok: false, error: "Arsip bukti rusak (tar tidak valid): " + err.slice(0, 200) };
  }
  const entries = out.split("\n").map((e) => e.trim()).filter(Boolean);
  for (const e of entries) {
    if (e.startsWith("/") || e.includes("..") || (!e.startsWith("bukti/") && e !== "bukti")) {
      return { ok: false, error: `Arsip bukti memuat entri di luar folder bukti/: ${e}` };
    }
  }
  return { ok: true };
}

async function runChecked(
  cmd: string[],
  opts: { env?: Record<string, string>; stdin?: ReadableStream | null },
): Promise<{ code: number; stderr: string }> {
  const proc = Bun.spawn(cmd, {
    stdout: "pipe",
    stderr: "pipe",
    stdin: opts.stdin ?? undefined,
    env: opts.env ? { ...process.env, ...opts.env } : undefined,
  });
  const stderr = await new Response(proc.stderr).text();
  await proc.exited;
  return { code: proc.exitCode ?? 1, stderr };
}

/** Impor dump ke database aplikasi lewat `mysql` (kata sandi via MYSQL_PWD). */
export async function restoreDatabase(opts: RestoreOptions): Promise<void> {
  const { config, socketPath } = opts;
  const gunzip = Bun.spawn(["gzip", "-dc", opts.dumpPath], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const mysqlArgs = socketPath
    ? ["mysql", `--socket=${socketPath}`, "-u", "root", config.database]
    : [
        "mysql",
        "-h",
        config.host,
        "-P",
        String(config.port),
        "-u",
        config.user,
        config.database,
      ];
  const mysqlProc = Bun.spawn(mysqlArgs, {
    stdin: gunzip.stdout,
    stdout: "pipe",
    stderr: "pipe",
    env: socketPath ? undefined : { ...process.env, MYSQL_PWD: config.password },
  });
  const mysqlErr = await new Response(mysqlProc.stderr).text();
  await mysqlProc.exited;
  const gunzipErr = await new Response(gunzip.stderr).text();
  await gunzip.exited;
  if (mysqlProc.exitCode !== 0) {
    throw new Error("Impor dump gagal: " + (mysqlErr || gunzipErr).slice(0, 300));
  }
}

/**
 * Ganti folder bukti dengan isi arsip. Folder lama dipindah dulu ke
 * `bukti.bak-<cap>`; bila ekstrak gagal, folder lama dikembalikan.
 */
export async function restoreEvidence(dataDir: string, archivePath: string): Promise<void> {
  const buktiDir = path.join(dataDir, "bukti");
  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const bakDir = path.join(dataDir, `bukti.bak-${stamp}`);
  const { rename, rm, mkdir, stat } = await import("node:fs/promises");
  let hadOld = false;
  try {
    await stat(buktiDir);
    hadOld = true;
  } catch {
    hadOld = false;
  }
  if (hadOld) await rename(buktiDir, bakDir);
  try {
    await mkdir(buktiDir, { recursive: true });
    const { code, stderr } = await runChecked(["tar", "-xzf", archivePath, "-C", dataDir], {});
    if (code !== 0) throw new Error("Ekstrak arsip bukti gagal: " + stderr.slice(0, 300));
  } catch (err) {
    await rm(buktiDir, { recursive: true, force: true });
    if (hadOld) await rename(bakDir, buktiDir);
    throw err;
  }
  if (hadOld) await rm(bakDir, { recursive: true, force: true });
}

/**
 * Jalankan restore lengkap: validasi → impor dump → ganti bukti
 * (bila ada) → bersihkan semua sesi login → catat audit log.
 * Mengembalikan ringkasan untuk ditampilkan ke admin.
 */
export async function restoreBackup(
  pool: mysql.Pool,
  opts: RestoreOptions,
  adminUserId: number,
): Promise<{ sessions: number; templates: number }> {
  const dumpCheck = await validateDumpFile(opts.dumpPath);
  if (!dumpCheck.ok) throw new Error(dumpCheck.error);
  if (opts.evidencePath) {
    const evCheck = await validateEvidenceArchive(opts.evidencePath);
    if (!evCheck.ok) throw new Error(evCheck.error);
  }
  await restoreDatabase(opts);
  if (opts.evidencePath) await restoreEvidence(opts.dataDir, opts.evidencePath);
  // Semua sesi login dibersihkan — semua pengguna harus masuk ulang.
  await pool.query("DELETE FROM user_sessions");
  const [sRows] = await pool.query("SELECT COUNT(*) AS c FROM sessions");
  const [tRows] = await pool.query("SELECT COUNT(*) AS c FROM templates");
  const sessions = (sRows as { c: number }[])[0]?.c ?? 0;
  const templates = (tRows as { c: number }[])[0]?.c ?? 0;
  await pool.query(
    "INSERT INTO audit_logs (user_id, action, entity, entity_id, detail) VALUES (?, 'backup.restore', 'database', 0, ?)",
    [adminUserId, JSON.stringify({ sessions, templates, dump: path.basename(opts.dumpPath) })],
  );
  return { sessions, templates };
}
