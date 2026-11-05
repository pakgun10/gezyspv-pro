import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import mysql from "mysql2/promise";
import type { RowDataPacket } from "mysql2/promise";
import { ensureTestDb, closePool } from "./helpers";
import { configFromEnv, getPool, runMigrations } from "../src/db";
import { createApp } from "../src/index";
import { hashPassword } from "../src/auth";
import { seedAll } from "../src/lib/seed";
import {
  canViewSession,
  createSession,
  listSessionsForUser,
  loadSession,
  loadSnapshot,
  savePascaGuru,
  setSessionStatus,
} from "../src/lib/sessions";
import { canViewTeacher } from "../src/lib/recap";
import { isSupervisor } from "../src/rbac";
import type { SessionUser } from "../src/auth";

// Database khusus tes model peran "satu akun dua peran".
process.env.DB_NAME = "gezyspv_test_roles";

// ---------- 1. Migrasi bertahap: 001 saja → supervisor lama → 002 ----------
const migDir = await mkdtemp(path.join(tmpdir(), "spv-mig-"));
await writeFile(path.join(migDir, "001_init.sql"), await readFile("migrations/001_init.sql", "utf-8"));
const root = await mysql.createConnection({
  socketPath: "/run/mysqld/mysqld.sock",
  user: "root",
});
await root.query("DROP DATABASE IF EXISTS `gezyspv_test_roles`");
await root.query(
  "CREATE DATABASE IF NOT EXISTS `gezyspv_test_roles` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci",
);
await root.end();
const migConfig = { ...configFromEnv(), database: "gezyspv_test_roles" };
await runMigrations(migConfig, migDir);
const migPool = mysql.createPool(migConfig);
const migHash = await hashPassword("rahasia123");
await migPool.query(
  "INSERT INTO users (username, name, password_hash, role, is_principal, must_change_password) VALUES ('sup_lama','Supervisor Lama',?,'supervisor',0,0), ('kepsek_lama','Kepsek Lama',?,'supervisor',1,0)",
  [migHash, migHash],
);
const migApplied = await runMigrations(migConfig);
const [converted] = (await migPool.query(
  "SELECT username, role, is_supervisor, is_principal FROM users WHERE username LIKE 'sup_lama' OR username LIKE 'kepsek_lama' ORDER BY username",
)) as RowDataPacket[][];
let checkRejected: string | null = null;
try {
  await migPool.query(
    "INSERT INTO users (username, name, password_hash, role, must_change_password) VALUES ('sup_tolak','Supervisor Ditolak',?,'supervisor',0)",
    [migHash],
  );
} catch (e: any) {
  checkRejected = String(e.sqlMessage ?? e.message ?? "");
}
await migPool.query("DELETE FROM users WHERE username IN ('sup_lama','kepsek_lama','sup_tolak')");
await migPool.end();

// ---------- 2. Setup DB tes (migrasi 002 sudah diterapkan di atas) ----------
const pool = await ensureTestDb("gezyspv_test_roles");
await seedAll(pool, hashPassword, "admin123");

const [periodRows] = await pool.query<(RowDataPacket & { id: number })[]>(
  "SELECT id FROM periods WHERE is_active = 1 ORDER BY id LIMIT 1",
);
const periodId = periodRows[0]!.id;
const [classRows] = await pool.query<(RowDataPacket & { id: number })[]>(
  "SELECT id FROM classes WHERE period_id = ? ORDER BY id LIMIT 1",
  [periodId],
);
let classId: number;
if (classRows.length === 0) {
  const [res] = await pool.query<mysql.ResultSetHeader>(
    "INSERT INTO classes (period_id, name, level_label) VALUES (?, '9A', 'Kelas 9')",
    [periodId],
  );
  classId = res.insertId;
} else {
  classId = classRows[0]!.id;
}
const [seedTplRows] = await pool.query<(RowDataPacket & { id: number })[]>(
  "SELECT id FROM templates WHERE is_seed = 1",
);
const seedTemplateId = seedTplRows[0]!.id;

async function makeUser(
  username: string,
  name: string,
  role: "admin" | "guru" = "guru",
  isPrincipal = 0,
  isSupervisorFlag = 0,
): Promise<SessionUser> {
  const [existing] = await pool.query<(RowDataPacket & { id: number })[]>(
    "SELECT id FROM users WHERE username = ?",
    [username],
  );
  if (existing.length > 0) {
    const uid = existing[0]!.id;
    await pool.query("DELETE FROM sessions WHERE supervisor_id = ? OR teacher_id = ?", [uid, uid]);
    await pool.query(
      "DELETE FROM supervisor_assignments WHERE supervisor_id = ? OR teacher_id = ?",
      [uid, uid],
    );
    await pool.query("DELETE FROM user_sessions WHERE user_id = ?", [uid]);
    await pool.query("DELETE FROM audit_logs WHERE user_id = ?", [uid]);
    await pool.query("DELETE FROM users WHERE id = ?", [uid]);
  }
  const [res] = await pool.query<mysql.ResultSetHeader>(
    "INSERT INTO users (username, name, password_hash, role, is_supervisor, is_principal, must_change_password) VALUES (?, ?, ?, ?, ?, ?, 0)",
    [username, name, await hashPassword("rahasia123"), role, isSupervisorFlag, isPrincipal],
  );
  return {
    id: res.insertId,
    username,
    name,
    nip: null,
    role,
    is_supervisor: isSupervisorFlag === 1,
    is_principal: isPrincipal === 1,
    must_change_password: false,
    active: true,
  };
}

const admin = await makeUser("admin_peran", "Admin Peran", "admin");
const supA = await makeUser("sup_peran_a", "Supervisor A", "guru", 0, 1);
const supB = await makeUser("sup_peran_b", "Supervisor B", "guru", 0, 1);
const supC = await makeUser("sup_peran_c", "Supervisor C Tanpa Tugas", "guru", 0, 1);
const kepsek = await makeUser("kepsek_peran", "Kepala Sekolah", "guru", 1, 1);
const guru1 = await makeUser("guru_peran1", "Guru Satu", "guru");
const guru2 = await makeUser("guru_peran2", "Guru Dua", "guru");

await pool.query("INSERT INTO supervisor_assignments (supervisor_id, teacher_id) VALUES (?, ?)", [
  supA.id,
  guru1.id,
]);
await pool.query("INSERT INTO supervisor_assignments (supervisor_id, teacher_id) VALUES (?, ?)", [
  supA.id,
  supB.id,
]);

function sessionInput(teacherId: number) {
  return {
    templateId: seedTemplateId,
    teacherId,
    classId,
    subject_theme: "Bilangan Bulat",
    phase_semester: "Semester 1",
    observed_at: "2026-11-06",
    observed_time: "09:00",
  };
}

/** Buat sesi lalu majukan ke tahap pasca (tanpa skor — cukup untuk uji refleksi). */
async function sessionAtPasca(sup: SessionUser, teacherId: number): Promise<number> {
  const id = await createSession(pool, sup, sessionInput(teacherId));
  await setSessionStatus(pool, sup, id, "observasi");
  await setSessionStatus(pool, sup, id, "pasca");
  return id;
}

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
  return cookie.split(";")[0]!;
}

describe("migrasi 002_role_flags", () => {
  test("002 diterapkan; supervisor lama → guru+flag; kepsek lama → guru+flag+principal", () => {
    expect(migApplied).toContain("002_role_flags.sql");
    const sup = (converted as any[]).find((r) => r.username === "sup_lama");
    const kep = (converted as any[]).find((r) => r.username === "kepsek_lama");
    expect(sup.role).toBe("guru");
    expect(sup.is_supervisor).toBe(1);
    expect(sup.is_principal).toBe(0);
    expect(kep.role).toBe("guru");
    expect(kep.is_supervisor).toBe(1);
    expect(kep.is_principal).toBe(1);
  });

  test("CHECK baru menolak role 'supervisor'", () => {
    expect(checkRejected).toContain("CONSTRAINT `role` failed");
  });
});

describe("isSupervisor — satu akun dua peran", () => {
  test("guru+flag dan kepsek adalah supervisor; guru biasa dan admin bukan", () => {
    expect(isSupervisor(supA)).toBe(true);
    expect(isSupervisor(kepsek)).toBe(true);
    expect(isSupervisor(guru1)).toBe(false);
    expect(isSupervisor(admin)).toBe(false);
    expect(isSupervisor(null)).toBe(false);
  });
});

describe("buat sesi — supervisor bisa disupervisi", () => {
  test("supervisor-flag membuat sesi untuk guru biasa yang ditugaskan", async () => {
    const id = await createSession(pool, supA, sessionInput(guru1.id));
    expect(id).toBeGreaterThan(0);
    await pool.query("DELETE FROM sessions WHERE id = ?", [id]);
  });

  test("supervisor-flag membuat sesi untuk supervisor lain yang ditugaskan", async () => {
    const id = await createSession(pool, supA, sessionInput(supB.id));
    expect(id).toBeGreaterThan(0);
    await pool.query("DELETE FROM sessions WHERE id = ?", [id]);
  });

  test("Kepsek membuat sesi untuk siapa pun tanpa penugasan", async () => {
    const id = await createSession(pool, kepsek, sessionInput(guru2.id));
    expect(id).toBeGreaterThan(0);
    const id2 = await createSession(pool, kepsek, sessionInput(supC.id));
    expect(id2).toBeGreaterThan(0);
    await pool.query("DELETE FROM sessions WHERE id IN (?, ?)", [id, id2]);
  });

  test("supervisi diri sendiri ditolak", async () => {
    await expect(createSession(pool, supA, sessionInput(supA.id))).rejects.toThrow(
      "diri sendiri",
    );
    await expect(createSession(pool, kepsek, sessionInput(kepsek.id))).rejects.toThrow(
      "diri sendiri",
    );
  });

  test("guru biasa tidak bisa membuat sesi", async () => {
    await expect(createSession(pool, guru1, sessionInput(guru2.id))).rejects.toThrow(
      "Hanya supervisor",
    );
  });

  test("supervisor tidak bisa membuat sesi untuk guru yang tidak ditugaskan", async () => {
    await expect(createSession(pool, supA, sessionInput(guru2.id))).rejects.toThrow(
      "tidak ditugaskan",
    );
  });
});

describe("refleksi pasca — supervisor sebagai guru", () => {
  test("supervisor yang disupervisi bisa mengisi refleksi; pembuat sesi tidak bisa", async () => {
    const id = await sessionAtPasca(supA, supB.id);
    const snap = await loadSnapshot(pool, id);
    const qid = snap.pascaQuestions[0]!.id;
    await savePascaGuru(pool, supB, id, { [qid]: "Refleksi dari supervisor B." });
    const snap2 = await loadSnapshot(pool, id);
    expect(snap2.pascaQuestions[0]!.guru_note).toBe("Refleksi dari supervisor B.");
    // Pembuat sesi (supA) bukan guru pada sesi ini → tidak bisa isi guru_note.
    await expect(savePascaGuru(pool, supA, id, { [qid]: "Bukan refleksi saya." })).rejects.toThrow(
      "Hanya guru yang disupervisi",
    );
  });
});

describe("hak lihat sesi — dipersempit (pembuat + yang disupervisi + admin/Kepsek)", () => {
  test("pembuat, yang disupervisi, admin, dan Kepsek boleh; supervisor lain 403", async () => {
    const id = await createSession(pool, supA, sessionInput(supB.id));
    const s = (await loadSession(pool, id))!;
    expect(canViewSession(supA, s)).toBe(true);
    expect(canViewSession(supB, s)).toBe(true);
    expect(canViewSession(admin, s)).toBe(true);
    expect(canViewSession(kepsek, s)).toBe(true);
    expect(canViewSession(supC, s)).toBe(false);
    expect(canViewSession(guru1, s)).toBe(false);
  });

  test("dasbor supervisor-flag menampilkan kedua sisi (dibuat + atas dirinya)", async () => {
    const id = await createSession(pool, supA, sessionInput(supB.id));
    const mine = await listSessionsForUser(pool, supB);
    expect(mine.some((x) => x.id === id && x.supervisor_id === supA.id)).toBe(true);
    const created = await listSessionsForUser(pool, supA);
    expect(created.some((x) => x.id === id)).toBe(true);
    const other = await listSessionsForUser(pool, supC);
    expect(other.some((x) => x.id === id)).toBe(false);
  });
});

describe("profil/rekap — supervisor sebagai guru", () => {
  test("supervisor-flag melihat profil guru yang ditugaskan (termasuk supervisor lain); guru lain 403", async () => {
    expect(await canViewTeacher(pool, supA, supB.id)).toBe(true);
    expect(await canViewTeacher(pool, supA, guru1.id)).toBe(true);
    expect(await canViewTeacher(pool, supA, guru2.id)).toBe(false);
    expect(await canViewTeacher(pool, supB, supB.id)).toBe(true);
    expect(await canViewTeacher(pool, supB, supA.id)).toBe(false);
    expect(await canViewTeacher(pool, kepsek, supC.id)).toBe(true);
  });
});

describe("HTTP — hak lihat sesi + dasbor dua sisi + refleksi", () => {
  test("supervisor ketiga GET sesi → 403; pembuat, yang disupervisi, admin, Kepsek → 200", async () => {
    const id = await sessionAtPasca(supA, supB.id);
    const cA = await loginAs("sup_peran_a", "rahasia123");
    const cB = await loginAs("sup_peran_b", "rahasia123");
    const cC = await loginAs("sup_peran_c", "rahasia123");
    const cK = await loginAs("kepsek_peran", "rahasia123");
    const cAdmin = await loginAs("admin_peran", "rahasia123");
    const get = (cookie: string) =>
      fetch(`${base}/supervisi/${id}`, { headers: { Cookie: cookie }, redirect: "manual" });
    expect((await get(cA)).status).toBe(200);
    expect((await get(cB)).status).toBe(200);
    expect((await get(cK)).status).toBe(200);
    expect((await get(cAdmin)).status).toBe(200);
    expect((await get(cC)).status).toBe(403);
  });

  test("dasbor supervisor yang disupervisi menampilkan 'Supervisi atas Anda' + badge menunggu refleksi", async () => {
    const id = await sessionAtPasca(supA, supB.id);
    void id;
    const cB = await loginAs("sup_peran_b", "rahasia123");
    const dash = await fetch(`${base}/`, { headers: { Cookie: cB } });
    const text = await dash.text();
    expect(dash.status).toBe(200);
    expect(text).toContain("Supervisi atas Anda");
    expect(text).toContain("Menunggu refleksi Anda");
    expect(text).toContain("Sesi supervisi saya");
  });

  test("supervisor sebagai guru mengisi refleksi lewat form → ok", async () => {
    const id = await sessionAtPasca(supA, supB.id);
    const snap = await loadSnapshot(pool, id);
    const cB = await loginAs("sup_peran_b", "rahasia123");
    const res = await fetch(`${base}/supervisi/${id}/pasca`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cB },
      body: new URLSearchParams({
        field: "guru",
        ...Object.fromEntries(snap.pascaQuestions.map((q) => [`guru[${q.id}]`, "Refleksi via form."])),
      }),
      redirect: "manual",
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toMatch(/ok=/);
    const snap2 = await loadSnapshot(pool, id);
    expect(snap2.pascaQuestions[0]!.guru_note).toBe("Refleksi via form.");
  });
});
