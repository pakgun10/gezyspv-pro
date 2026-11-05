import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { RowDataPacket } from "mysql2/promise";
import { ensureTestDb, closePool } from "./helpers";
import { importGuruCsv, importKelasCsv } from "../src/lib/csv";
import { hashPassword } from "../src/auth";
import { seedAll } from "../src/lib/seed";

const pool = await ensureTestDb(process.env.TEST_DB_NAME ?? "gezyspv_test");

beforeAll(async () => {
  await seedAll(pool, hashPassword, "admin123");
  await pool.query("DELETE FROM users WHERE username != 'admin'");
  await pool.query("DELETE FROM classes");
});

afterAll(async () => {
  await closePool();
});

describe("impor CSV guru (transaksional)", () => {
  test("impor valid masuk semua; password_awal kosong memakai default", async () => {
    const r = await importGuruCsv(
      pool,
      "username,nama,nip,password_awal\nimp1,Guru Impor Satu,111,\nimp2,Guru Impor Dua,,rahasia2\n",
      "guru123",
      hashPassword,
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.inserted).toBe(2);
    const [rows] = await pool.query<(RowDataPacket & { username: string; must_change_password: number })[]>(
      "SELECT username, must_change_password FROM users WHERE username IN ('imp1','imp2')",
    );
    expect(rows).toHaveLength(2);
    expect(rows.every((u) => u.must_change_password === 1)).toBe(true);
  });

  test("satu baris salah = seluruh impor batal (rollback)", async () => {
    const before = await pool.query<(RowDataPacket & { c: number })[]>(
      "SELECT COUNT(*) AS c FROM users WHERE username LIKE 'imp%'",
    );
    const r = await importGuruCsv(
      pool,
      "username,nama,nip,password_awal\nimp3,Guru Impor Tiga,,\nimp4,,,\n",
      "guru123",
      hashPassword,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.message.includes("nama kosong"))).toBe(true);
    const after = await pool.query<(RowDataPacket & { c: number })[]>(
      "SELECT COUNT(*) AS c FROM users WHERE username LIKE 'imp%'",
    );
    expect(after[0]![0]!.c).toBe(before[0]![0]!.c); // imp3 TIDAK ikut masuk
  });

  test("username yang sudah ada di database membatalkan impor", async () => {
    const r = await importGuruCsv(
      pool,
      "username,nama,nip,password_awal\nimp1,Duplikat,,\nimp5,Baru,,\n",
      "guru123",
      hashPassword,
    );
    expect(r.ok).toBe(false);
    const [rows] = await pool.query<(RowDataPacket & { c: number })[]>(
      "SELECT COUNT(*) AS c FROM users WHERE username = 'imp5'",
    );
    expect(rows[0]!.c).toBe(0);
  });
});

describe("impor CSV kelas (transaksional)", () => {
  test("impor valid ke periode aktif; duplikat membatalkan semua", async () => {
    const [periods] = await pool.query<(RowDataPacket & { id: number })[]>(
      "SELECT id FROM periods WHERE is_active = 1",
    );
    const periodId = periods[0]!.id;
    const ok = await importKelasCsv(pool, "nama_kelas,level_label\n7.1,Kelas 7\n7.2,Kelas 7\n", periodId);
    expect(ok.ok).toBe(true);
    const bad = await importKelasCsv(pool, "nama_kelas,level_label\n8.1,Kelas 8\n7.1,Kelas 7\n", periodId);
    expect(bad.ok).toBe(false);
    const [rows] = await pool.query<(RowDataPacket & { c: number })[]>(
      "SELECT COUNT(*) AS c FROM classes WHERE name = '8.1'",
    );
    expect(rows[0]!.c).toBe(0); // 8.1 ikut batal karena 7.1 duplikat
  });
});
