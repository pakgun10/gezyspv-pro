import mysql from "mysql2/promise";
import { configFromEnv, getPool, runMigrations, closePool } from "../src/db";

/**
 * Siapkan database tes: buat bila belum ada (butuh akses root MariaDB
 * via unix socket — jalankan `bun test` sebagai root atau user yang
 * punya hak CREATE DATABASE), lalu jalankan migrasi.
 */
export async function ensureTestDb(dbName: string): Promise<mysql.Pool> {
  const root = await mysql.createConnection({
    socketPath: "/run/mysqld/mysqld.sock",
    user: "root",
  });
  await root.query(
    `CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  );
  await root.end();
  const config = { ...configFromEnv(), database: dbName };
  await runMigrations(config);
  return getPool(config);
}

export { closePool };
