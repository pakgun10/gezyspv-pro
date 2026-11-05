import { afterAll, describe, expect, test } from "bun:test";
import { ensureTestDb, closePool } from "./helpers";
import { createApp } from "../src/index";
import { hashPassword } from "../src/auth";
import { seedAll } from "../src/lib/seed";

// Database khusus tes HTTP — terpisah dari tes seed/impor.
process.env.DB_NAME = "gezyspv_test_http";
const pool = await ensureTestDb("gezyspv_test_http");
await seedAll(pool, hashPassword, "admin123");
// Satu akun guru untuk cek RBAC.
await pool.query("DELETE FROM users WHERE username = 'guru_http'");
await pool.query(
  "INSERT INTO users (username, name, password_hash, role, must_change_password) VALUES ('guru_http', 'Guru HTTP', ?, 'guru', 0)",
  [await hashPassword("guru123")],
);

const app = createApp();
const server = app.listen(0);
const port = server.server!.port;
const base = `http://127.0.0.1:${port}`;

afterAll(async () => {
  server.stop();
  await closePool();
});

async function loginAs(username: string, password: string): Promise<string> {
  const res = await fetch(`${base}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username, password }),
    redirect: "manual",
  });
  expect(res.status).toBe(302);
  const cookie = res.headers.get("set-cookie") ?? "";
  expect(cookie).toContain("spv_session=");
  expect(cookie).toContain("HttpOnly");
  expect(cookie).toContain("SameSite=Lax");
  return cookie.split(";")[0]!;
}

describe("HTTP: login + RBAC", () => {
  test("GET /login menampilkan halaman masuk", async () => {
    const res = await fetch(`${base}/login`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("Masuk");
    expect(text).toContain("SMPN 1 Punggur");
  });

  test("GET / tanpa login dialihkan ke /login", async () => {
    const res = await fetch(`${base}/`, { redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/login");
  });

  test("login salah ditolak (401)", async () => {
    const res = await fetch(`${base}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ username: "admin", password: "salah" }),
      redirect: "manual",
    });
    expect(res.status).toBe(401);
  });

  test("admin login lalu bisa membuka /admin/guru; guru mendapat 403", async () => {
    const adminCookie = await loginAs("admin", "admin123");
    // Admin pertama kali diarahkan ke /ganti-sandi (must_change_password=1);
    // ganti sandi dulu agar dasbor bisa dibuka.
    const change = await fetch(`${base}/ganti-sandi`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: adminCookie,
      },
      body: new URLSearchParams({
        old_password: "admin123",
        new_password: "adminBaru123",
        confirm_password: "adminBaru123",
      }),
      redirect: "manual",
    });
    expect(change.status).toBe(302);
    const adminPage = await fetch(`${base}/admin/guru`, {
      headers: { Cookie: adminCookie },
    });
    expect(adminPage.status).toBe(200);
    expect(await adminPage.text()).toContain("Daftar akun");

    const guruCookie = await loginAs("guru_http", "guru123");
    const denied = await fetch(`${base}/admin/guru`, {
      headers: { Cookie: guruCookie },
      redirect: "manual",
    });
    expect(denied.status).toBe(403);
    const guruDash = await fetch(`${base}/`, { headers: { Cookie: guruCookie } });
    expect(guruDash.status).toBe(200);
    expect(await guruDash.text()).toContain("Dasbor Guru");

    // Kembalikan kata sandi admin agar seed tetap idempotent di run berikut.
    await fetch(`${base}/ganti-sandi`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: adminCookie,
      },
      body: new URLSearchParams({
        old_password: "adminBaru123",
        new_password: "admin123",
        confirm_password: "admin123",
      }),
      redirect: "manual",
    });
  });

  test("GET /api/kesehatan tanpa login menjawab ok", async () => {
    const res = await fetch(`${base}/api/kesehatan`);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; app: string };
    expect(json.ok).toBe(true);
    expect(json.app).toBe("gezyspv-pro");
  });
});
