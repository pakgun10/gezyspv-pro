/**
 * Seed kelompok templat Kurikulum Merdeka — dijalankan manual:
 *   bun run seed:kurmer
 * Menjalankan migrasi dulu (agar 003 ada), lalu membuat 4 templat
 * skala 0–2 + kelompoknya. Idempotent; tidak mengubah templat
 * PPB/GM yang sudah ada.
 */
import { configFromEnv, getPool, runMigrations, closePool } from "../db";
import { seedKurmer } from "../lib/seed-kurmer";

const config = configFromEnv();
await runMigrations(config);
const result = await seedKurmer(getPool(config));
console.log(
  `Kelompok "Instrumen Supervisi Kurikulum Merdeka" (id ${result.groupId}) — ${result.groupCreated ? "baru dibuat" : "sudah ada"}; version_label "${result.versionLabel}" (dari periode aktif).`,
);
for (const t of result.templates) {
  console.log(`  ${t.created ? "baru" : "sudah ada"}: ${t.title} — ${t.indicators} indikator (id ${t.id})`);
}
console.log("Selesai.");
await closePool();
process.exit(0);
