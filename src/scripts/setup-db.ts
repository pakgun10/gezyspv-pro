import mysql from "mysql2/promise";

/**
 * Menyiapkan database + user MariaDB untuk pengembangan lokal.
 * Dijalankan sebagai root OS (otentikasi unix_socket MariaDB):
 *   sudo bun src/scripts/setup-db.ts
 * Membaca DB_USER / DB_PASSWORD / DB_NAME / TEST_DB_NAME dari .env.
 * Membuat database dev + test dan user aplikasi dengan hak penuh
 * atas keduanya. TIDAK membuat user root baru.
 */
const dbUser = process.env.DB_USER ?? "gezyspv";
const dbPassword = process.env.DB_PASSWORD ?? "";
const dbName = process.env.DB_NAME ?? "gezyspv_dev";
const testDbName = process.env.TEST_DB_NAME ?? "gezyspv_test";

if (!dbPassword) {
  console.error("DB_PASSWORD kosong. Isi dulu di .env (lihat .env.example).");
  process.exit(1);
}

const root = await mysql.createConnection({
  socketPath: "/run/mysqld/mysqld.sock",
  user: "root",
});

const q = async (sql: string) => {
  console.log(">", sql);
  await root.query(sql);
};

await q(`CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
await q(`CREATE DATABASE IF NOT EXISTS \`${testDbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
await q(`CREATE USER IF NOT EXISTS '${dbUser}'@'127.0.0.1' IDENTIFIED BY '${dbPassword.replace(/'/g, "''")}'`);
await q(`GRANT ALL PRIVILEGES ON \`${dbName}\`.* TO '${dbUser}'@'127.0.0.1'`);
await q(`GRANT ALL PRIVILEGES ON \`${testDbName}\`.* TO '${dbUser}'@'127.0.0.1'`);
await q(`GRANT ALL PRIVILEGES ON \`gezyspv_test_http\`.* TO '${dbUser}'@'127.0.0.1'`);
await q("FLUSH PRIVILEGES");
await root.end();

console.log("\nSelesai. Isi .env Anda:");
console.log(`  DB_USER=${dbUser}`);
console.log(`  DB_PASSWORD=<yang Anda isi di .env>`);
console.log(`  DB_NAME=${dbName}`);
console.log(`  TEST_DB_NAME=${testDbName}`);
