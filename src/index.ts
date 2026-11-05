import { Elysia } from "elysia";
import staticPlugin from "@elysiajs/static";
import { configFromEnv, getPool, runMigrations } from "./db";
import { hashPassword } from "./auth";
import { seedAll } from "./lib/seed";
import { authRoutes } from "./routes/auth";
import { dashboardRoutes } from "./routes/dashboard";
import { adminRoutes } from "./routes/admin";
import { templateAdminRoutes, templatePredicateRoutes } from "./routes/templates";

/** Bangun aplikasi Elysia (tanpa efek samping; migrasi+seed ada di main()). */
export function createApp() {
  return new Elysia()
    .get("/api/kesehatan", () => ({
      ok: true,
      app: "gezyspv-pro",
      fase: 1,
      domain: "spv.pakgun.web.id",
    }))
    .use(authRoutes)
    .use(dashboardRoutes)
    .use(adminRoutes)
    .use(templateAdminRoutes)
    .use(templatePredicateRoutes)
    // Prefix /static (bukan "/"): plugin statik dengan prefix "/" mendaftarkan
    // route GET / yang menimpa dasbor (NotFoundError untuk direktori public).
    .use(staticPlugin({ assets: "public", prefix: "/static" }))
    .onError(({ code, error, set }) => {
      // Jangan samakan semua error jadi 500: NOT_FOUND harus 404.
      if (code === "NOT_FOUND") {
        set.status = 404;
        return "Halaman tidak ditemukan.";
      }
      if (code === "VALIDATION") {
        set.status = 400;
        return "Data yang dikirim tidak valid.";
      }
      console.error(`[error] ${code}:`, error);
      set.status = 500;
      return "Terjadi kesalahan server. Silakan coba lagi.";
    });
}

async function main(): Promise<void> {
  const config = configFromEnv();
  const pool = getPool(config);
  console.log("[gezyspv-pro] Menjalankan migrasi…");
  const applied = await runMigrations(config);
  console.log(
    `[gezyspv-pro] Migrasi: ${applied.length > 0 ? applied.join(", ") : "tidak ada yang baru"}`,
  );
  const adminPassword = process.env.ADMIN_DEV_PASSWORD || "admin123";
  const counts = await seedAll(pool, hashPassword, adminPassword);
  console.log("[gezyspv-pro] Seed:", JSON.stringify(counts));
  const port = Number(process.env.PORT ?? 3000);
  const app = createApp();
  app.listen(port);
  console.log(`[gezyspv-pro] Berjalan di http://localhost:${port}`);
  console.log(`[gezyspv-pro] Database: ${config.host}:${config.port}/${config.database}`);
}

if (import.meta.main) {
  await main();
}
