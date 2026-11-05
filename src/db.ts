import mysql from "mysql2/promise";
import type { RowDataPacket } from "mysql2/promise";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type DbConfig = {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
};

export function configFromEnv(prefix = ""): DbConfig {
  const env = process.env;
  return {
    host: env[`${prefix}DB_HOST`] ?? env.DB_HOST ?? "127.0.0.1",
    port: Number(env[`${prefix}DB_PORT`] ?? env.DB_PORT ?? 3306),
    user: env[`${prefix}DB_USER`] ?? env.DB_USER ?? "gezyspv",
    password: env[`${prefix}DB_PASSWORD`] ?? env.DB_PASSWORD ?? "",
    database: env[`${prefix}DB_NAME`] ?? env.DB_NAME ?? "gezyspv_dev",
  };
}

const pools = new Map<string, mysql.Pool>();

export function getPool(config?: DbConfig): mysql.Pool {
  const cfg = config ?? configFromEnv();
  const key = `${cfg.host}:${cfg.port}/${cfg.database}`;
  let p = pools.get(key);
  if (!p) {
    p = mysql.createPool({
      ...cfg,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      dateStrings: true,
    });
    pools.set(key, p);
  }
  return p;
}

export async function closePool(): Promise<void> {
  for (const p of pools.values()) await p.end();
  pools.clear();
}

/** Daftar berkas migrasi di migrations/, terurut berdasarkan nama. */
export async function listMigrationFiles(
  dir?: string,
): Promise<{ name: string; path: string }[]> {
  const migrationsDir =
    dir ??
    path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "migrations");
  const files = (await readdir(migrationsDir))
    .filter((f) => f.endsWith(".sql"))
    .sort();
  return files.map((f) => ({ name: f, path: path.join(migrationsDir, f) }));
}

/**
 * Jalankan semua migrasi yang belum diterapkan, berurutan.
 * Idempotent: berkas yang namanya sudah tercatat di tabel `migrations`
 * dilewati. Setiap berkas dijalankan dalam satu transaksi.
 * Mengembalikan daftar nama migrasi yang baru diterapkan.
 */
export async function runMigrations(
  config?: DbConfig,
  migrationsDir?: string,
): Promise<string[]> {
  const cfg = config ?? configFromEnv();
  const applied: string[] = [];
  // Koneksi khusus migrasi (multipleStatements hanya di sini).
  const conn = await mysql.createConnection({ ...cfg, multipleStatements: true });
  try {
    await conn.query(
      `CREATE TABLE IF NOT EXISTS migrations (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
    );
    const [rows] = await conn.query<(RowDataPacket & { name: string })[]>(
      "SELECT name FROM migrations",
    );
    const done = new Set(rows.map((r) => r.name));
    for (const file of await listMigrationFiles(migrationsDir)) {
      if (done.has(file.name)) continue;
      const sql = await readFile(file.path, "utf-8");
      await conn.beginTransaction();
      try {
        await conn.query(sql);
        await conn.query("INSERT INTO migrations (name) VALUES (?)", [file.name]);
        await conn.commit();
        applied.push(file.name);
      } catch (err) {
        await conn.rollback();
        throw new Error(`Migrasi ${file.name} gagal: ${(err as Error).message}`);
      }
    }
    return applied;
  } finally {
    await conn.end();
  }
}

export async function appliedMigrations(config?: DbConfig): Promise<string[]> {
  const p = getPool(config);
  try {
    const [rows] = await p.query<(RowDataPacket & { name: string })[]>(
      "SELECT name FROM migrations ORDER BY name",
    );
    return rows.map((r) => r.name);
  } catch {
    return [];
  }
}
