import { configFromEnv, getPool, runMigrations, closePool } from "../db";
import { hashPassword } from "../auth";
import { seedAll } from "../lib/seed";

const config = configFromEnv();
await runMigrations(config);
const adminPassword = process.env.ADMIN_DEV_PASSWORD || "admin123";
const counts = await seedAll(getPool(config), hashPassword, adminPassword);
console.log("Seed selesai:", JSON.stringify(counts, null, 2));
await closePool();
process.exit(0);
