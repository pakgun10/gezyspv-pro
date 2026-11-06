import { afterAll, describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import mysql from "mysql2/promise";
import type { RowDataPacket } from "mysql2/promise";
import { ensureTestDb, closePool } from "./helpers";
import { createApp } from "../src/index";
import { configFromEnv, getPool } from "../src/db";
import { hashPassword } from "../src/auth";
import { seedAll } from "../src/lib/seed";
import {
  createSession,
  loadSnapshot,
  savePascaGuru,
  savePascaSupervisor,
  savePra,
  saveRtl,
  saveScores,
  setSessionStatus,
} from "../src/lib/sessions";
import {
  restoreBackup,
  validateDumpFile,
  validateEvidenceArchive,
} from "../src/lib/backup";
import type { SessionUser } from "../src/auth";

// Database + folder data khusus tes Fase 4. JANGAN restore ke gezyspv_dev.
process.env.DB_NAME = "gezyspv_test_print";
const TEST_DATA_DIR = "/tmp/gezyspv-test-print";
const RESTORE_TMP = "/tmp/gezyspv-test-print-restore";
process.env.DATA_DIR = TEST_DATA_DIR;

const pool = await ensureTestDb("gezyspv_test_print");
await seedAll(pool, hashPassword, "admin123");
await pool.query("UPDATE users SET must_change_password = 0 WHERE username = 'admin'");

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
    await pool.query("DELETE FROM supervisor_assignments WHERE supervisor_id = ? OR teacher_id = ?", [uid, uid]);
    await pool.query("DELETE FROM user_sessions WHERE user_id = ?", [uid]);
    await pool.query("DELETE FROM audit_logs WHERE user_id = ?", [uid]);
    await pool.query("DELETE FROM report_narratives WHERE edited_by = ?", [uid]);
    await pool.query("DELETE FROM users WHERE id = ?", [uid]);
  }
  const [res] = await pool.query<mysql.ResultSetHeader>(
    "INSERT INTO users (username, name, nip, password_hash, role, is_supervisor, is_principal, must_change_password) VALUES (?, ?, ?, ?, ?, ?, ?, 0)",
    [username, name, "196501011990032001", await hashPassword("rahasia123"), role, isSupervisorFlag, isPrincipal],
  );
  return {
    id: res.insertId,
    username,
    name,
    nip: "196501011990032001",
    role,
    is_supervisor: isSupervisorFlag === 1,
    is_principal: isPrincipal === 1,
    must_change_password: false,
    active: true,
  };
}

const sup1 = await makeUser("sup_cetak", "Supervisor Cetak", "guru", 0, 1);
const kepsek = await makeUser("kepsek_cetak", "Kepala Sekolah Cetak", "guru", 1, 1);
const guru1 = await makeUser("guru_cetak1", "Guru Cetak Satu", "guru");
const guru2 = await makeUser("guru_cetak2", "Guru Cetak Dua", "guru");
await pool.query("INSERT INTO supervisor_assignments (supervisor_id, teacher_id) VALUES (?, ?)", [sup1.id, guru1.id]);

function sessionInput(teacherId: number) {
  return {
    templateId: seedTemplateId,
    teacherId,
    classId,
    subject_theme: "Descriptive Text — Bahasa Inggris",
    phase_semester: "Semester 1",
    observed_at: "2026-11-06",
    observed_time: "08:00",
  };
}

async function fillToComplete(sessionId: number, sup: SessionUser, guru: SessionUser) {
  const snap = await loadSnapshot(pool, sessionId);
  await savePra(pool, sup, sessionId, Object.fromEntries(snap.praQuestions.map((q) => [q.id, "Diskusi pra."])));
  await setSessionStatus(pool, sup, sessionId, "observasi");
  const ids = snap.elements.flatMap((el) => el.indicators.map((i) => i.id));
  await saveScores(
    pool,
    sup,
    sessionId,
    ids.map((id, i) => ({ indicatorId: id, value: (i % 4) + 1, evidence: "Terlihat di kelas." })),
  );
  await setSessionStatus(pool, sup, sessionId, "pasca");
  await savePascaGuru(pool, guru, sessionId, Object.fromEntries(snap.pascaQuestions.map((q) => [q.id, "Refleksi guru."])));
  await savePascaSupervisor(pool, sup, sessionId, Object.fromEntries(snap.pascaQuestions.map((q) => [q.id, "Catatan supervisor."])));
  await setSessionStatus(pool, sup, sessionId, "tindak_lanjut");
  await saveRtl(pool, sup, sessionId, Object.fromEntries(snap.rtlItems.map((r) => [r.id, "Rencana aksi."])));
  await setSessionStatus(pool, sup, sessionId, "selesai");
}

// Satu sesi selesai (untuk cetak/log) + satu sesi berjalan (untuk sweep route).
const doneSessionId = await createSession(pool, sup1, sessionInput(guru1.id));
await fillToComplete(doneSessionId, sup1, guru1);
const openSessionId = await createSession(pool, sup1, sessionInput(guru1.id));

const app = createApp();
const server = app.listen(0);
const port = server.server!.port;
const base = `http://127.0.0.1:${port}`;

afterAll(async () => {
  server.stop();
  await closePool();
  await rm(TEST_DATA_DIR, { recursive: true, force: true });
  await rm(RESTORE_TMP, { recursive: true, force: true });
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

async function get(path: string, cookie?: string): Promise<{ status: number; location: string | null; text: string }> {
  const res = await fetch(`${base}${path}`, {
    headers: cookie ? { Cookie: cookie } : {},
    redirect: "manual",
  });
  return { status: res.status, location: res.headers.get("location"), text: await res.text() };
}

async function auditRows(action: string, entityId: number) {
  const [rows] = await pool.query<(RowDataPacket & { action: string; detail: string })[]>(
    "SELECT action, detail FROM audit_logs WHERE action = ? AND entity_id = ? ORDER BY id",
    [action, entityId],
  );
  return rows;
}

describe("audit log skor + status (Fase 4, plan bagian 12)", () => {
  test("perubahan skor tercatat old → new; simpan tanpa perubahan tidak menambah baris", async () => {
    const sid = await createSession(pool, sup1, sessionInput(guru1.id));
    const snap = await loadSnapshot(pool, sid);
    const first = snap.elements[0]!.indicators[0]!;
    await setSessionStatus(pool, sup1, sid, "observasi");
    await saveScores(pool, sup1, sid, [{ indicatorId: first.id, value: 3, evidence: "Awal." }]);
    let rows = await auditRows("score.create", sid);
    expect(rows.length).toBe(1);
    expect(JSON.parse(rows[0]!.detail)).toMatchObject({ indicator_id: first.id, value: 3 });

    await saveScores(pool, sup1, sid, [{ indicatorId: first.id, value: 4, evidence: "Membaik." }]);
    rows = await auditRows("score.update", sid);
    expect(rows.length).toBe(1);
    expect(JSON.parse(rows[0]!.detail)).toMatchObject({ indicator_id: first.id, old_value: 3, new_value: 4 });

    await saveScores(pool, sup1, sid, [{ indicatorId: first.id, value: 4, evidence: "Membaik." }]);
    rows = await auditRows("score.update", sid);
    expect(rows.length).toBe(1);

    // Status juga tercatat.
    await setSessionStatus(pool, sup1, sid, "pasca");
    const statusRows = await auditRows("session.status", sid);
    expect(statusRows.length).toBeGreaterThanOrEqual(2);
    const last = JSON.parse(statusRows[statusRows.length - 1]!.detail);
    expect(last).toMatchObject({ from: "observasi", to: "pasca" });
  });
});

describe("halaman cetak (Fase 4, plan bagian 8)", () => {
  test("sesi selesai: 200 + kop, identitas 8 kolom, tabel, narasi, tanda tangan", async () => {
    const cookie = await loginAs("sup_cetak", "rahasia123");
    const r = await get(`/supervisi/${doneSessionId}/cetak`, cookie);
    expect(r.status).toBe(200);
    for (const needle of [
      "SMPN 1 Punggur",
      "Instrumen Supervisi Akademik Pembelajaran",
      "Nama Sekolah",
      "Nama Supervisor",
      "Nama Guru",
      "Kelas / Kelompok",
      "Hari / Tanggal",
      "Tema / Sub Tema",
      "Fase / Semester",
      "Waktu Observasi",
      "Pra-Observasi",
      "Observasi",
      "Pasca-Observasi",
      "Rencana Tindak Lanjut",
      "Narasi Hasil Supervisi",
      "Teramati dengan Baik",
      "Kepala Sekolah",
      "NIP.",
      "Cetak / Simpan PDF",
    ]) {
      expect(r.text).toContain(needle);
    }
    // Toolbar + form edit narasi ada di layar, disembunyikan saat print.
    expect(r.text).toContain("no-print");
    expect(r.text).toContain("Edit narasi");
  });

  test("tanpa login → 302; guru lain → 403; guru pemilik → 200", async () => {
    const anon = await get(`/supervisi/${doneSessionId}/cetak`);
    expect(anon.status).toBe(302);
    expect(anon.location).toBe("/login");

    const otherGuru = await loginAs("guru_cetak2", "rahasia123");
    const denied = await get(`/supervisi/${doneSessionId}/cetak`, otherGuru);
    expect(denied.status).toBe(403);

    const owner = await loginAs("guru_cetak1", "rahasia123");
    const ok = await get(`/supervisi/${doneSessionId}/cetak`, owner);
    expect(ok.status).toBe(200);
  });

  test("edit narasi dari halaman cetak kembali ke cetak", async () => {
    const cookie = await loginAs("sup_cetak", "rahasia123");
    const res = await fetch(`${base}/supervisi/${doneSessionId}/narasi`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cookie },
      body: new URLSearchParams({ narasi: "Narasi cetak khusus dari halaman cetak.", redirect: "cetak" }),
      redirect: "manual",
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain(`/supervisi/${doneSessionId}/cetak`);
    const page = await get(`/supervisi/${doneSessionId}/cetak`, cookie);
    expect(page.text).toContain("Narasi cetak khusus dari halaman cetak.");
  });
});

describe("halaman audit log admin", () => {
  test("admin 200 + memuat entri skor; guru 403; filter aksi bekerja", async () => {
    const adminCookie = await loginAs("admin", "admin123");
    const page = await get("/admin/log", adminCookie);
    expect(page.status).toBe(200);
    expect(page.text).toContain("Audit Log");
    expect(page.text).toContain("score.create");

    const filtered = await get("/admin/log?aksi=score.update", adminCookie);
    expect(filtered.status).toBe(200);
    expect(filtered.text).toContain("score.update");

    const guruCookie = await loginAs("guru_cetak1", "rahasia123");
    const denied = await get("/admin/log", guruCookie);
    expect(denied.status).toBe(403);
  });
});

describe("validasi berkas restore", () => {
  test("dump bukan gzip / isi bukan database aplikasi ditolak", async () => {
    await mkdir(RESTORE_TMP, { recursive: true });
    const notGzip = path.join(RESTORE_TMP, "bukan.sql.gz");
    await writeFile(notGzip, "SELECT 1;");
    expect((await validateDumpFile(notGzip)).ok).toBe(false);

    const wrongContent = path.join(RESTORE_TMP, "salah.sql.gz");
    const gz = Bun.spawn(["gzip", "-c"], { stdin: new Response("hello world").body, stdout: "pipe" });
    await writeFile(wrongContent, new Uint8Array(await new Response(gz.stdout).arrayBuffer()));
    await gz.exited;
    const check = await validateDumpFile(wrongContent);
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.error).toContain("bukan database gezyspv-pro");

    const missing = path.join(RESTORE_TMP, "hilang.sql.gz");
    expect((await validateDumpFile(missing)).ok).toBe(false);
  });

  test("arsip bukti dengan entri di luar bukti/ ditolak", async () => {
    await mkdir(RESTORE_TMP, { recursive: true });
    const evilDir = path.join(RESTORE_TMP, "evil");
    await mkdir(evilDir, { recursive: true });
    await writeFile(path.join(evilDir, "x.txt"), "jahat");
    const evilTar = path.join(RESTORE_TMP, "evil.tar.gz");
    const tar = Bun.spawn(["tar", "-czf", evilTar, "-C", RESTORE_TMP, "evil"], { stdout: "pipe", stderr: "pipe" });
    await tar.exited;
    expect(tar.exitCode).toBe(0);
    const check = await validateEvidenceArchive(evilTar);
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.error).toContain("di luar folder bukti/");
  });
});

describe("backup → restore ke salinan percobaan (kriteria selesai MVP §12)", () => {
  test("restore mengembalikan sesi + templat, mengganti bukti, membersihkan sesi login", async () => {
    const cfg = configFromEnv();
    const dumpPath = path.join(RESTORE_TMP, "db-restore-test.sql.gz");
    const buktiArchive = path.join(RESTORE_TMP, "bukti-restore-test.tar.gz");
    await mkdir(RESTORE_TMP, { recursive: true });
    await mkdir(path.join(TEST_DATA_DIR, "bukti"), { recursive: true });
    await writeFile(path.join(TEST_DATA_DIR, "bukti", "foto-asli.jpg"), "foto-asli");

    // 1) Buat backup dari database tes ini (seperti deploy/backup.sh).
    const dump = Bun.spawn(
      ["mysqldump", "-h", cfg.host, "-P", String(cfg.port), "-u", cfg.user, "--single-transaction", cfg.database],
      { stdout: "pipe", stderr: "pipe", env: { ...process.env, MYSQL_PWD: cfg.password } },
    );
    const dumpText = await new Response(dump.stdout).text();
    await dump.exited;
    expect(dump.exitCode).toBe(0);
    expect(dumpText).toContain("CREATE TABLE");
    const gz = Bun.spawn(["gzip", "-c"], { stdin: new Response(dumpText).body, stdout: "pipe" });
    await writeFile(dumpPath, new Uint8Array(await new Response(gz.stdout).arrayBuffer()));
    await gz.exited;
    const tar = Bun.spawn(["tar", "-czf", buktiArchive, "-C", TEST_DATA_DIR, "bukti"], {
      stdout: "pipe", stderr: "pipe",
    });
    await tar.exited;
    expect(tar.exitCode).toBe(0);
    expect((await validateDumpFile(dumpPath)).ok).toBe(true);
    expect((await validateEvidenceArchive(buktiArchive)).ok).toBe(true);

    const [beforeSessions] = await pool.query<(RowDataPacket & { c: number })[]>("SELECT COUNT(*) AS c FROM sessions");
    const [beforeTemplates] = await pool.query<(RowDataPacket & { c: number })[]>("SELECT COUNT(*) AS c FROM templates");
    expect(beforeSessions[0]!.c).toBeGreaterThan(0);

    // 2) Rusak data: hapus semua sesi, ubah nama sekolah, buat satu sesi login palsu.
    await pool.query("DELETE FROM sessions");
    await pool.query("UPDATE settings SET school_name = 'SEKOLAH RUSAK' WHERE id = 1");
    await pool.query(
      "INSERT INTO user_sessions (user_id, token_hash, expires_at) VALUES (?, 'token-palsu-restore', DATE_ADD(NOW(), INTERVAL 1 DAY))",
      [sup1.id],
    );
    await rm(path.join(TEST_DATA_DIR, "bukti"), { recursive: true, force: true });
    const [midSessions] = await pool.query<(RowDataPacket & { c: number })[]>("SELECT COUNT(*) AS c FROM sessions");
    expect(midSessions[0]!.c).toBe(0);

    // 3) Restore.
    const result = await restoreBackup(getPool(), {
      config: cfg,
      dataDir: TEST_DATA_DIR,
      dumpPath,
      evidencePath: buktiArchive,
    }, 1);
    expect(result.sessions).toBe(beforeSessions[0]!.c);
    expect(result.templates).toBe(beforeTemplates[0]!.c);

    const [afterSessions] = await pool.query<(RowDataPacket & { c: number })[]>("SELECT COUNT(*) AS c FROM sessions");
    expect(afterSessions[0]!.c).toBe(beforeSessions[0]!.c);
    const [school] = await pool.query<(RowDataPacket & { school_name: string })[]>("SELECT school_name FROM settings WHERE id = 1");
    expect(school[0]!.school_name).toBe("SMPN 1 Punggur");
    const [liveSessions] = await pool.query<(RowDataPacket & { c: number })[]>("SELECT COUNT(*) AS c FROM user_sessions");
    expect(liveSessions[0]!.c).toBe(0);
    const buktiRestored = await Bun.file(path.join(TEST_DATA_DIR, "bukti", "foto-asli.jpg")).text();
    expect(buktiRestored).toBe("foto-asli");
    // Restore tercatat di audit log database hasil restore.
    const [logs] = await pool.query<(RowDataPacket & { c: number })[]>(
      "SELECT COUNT(*) AS c FROM audit_logs WHERE action = 'backup.restore'",
    );
    expect(logs[0]!.c).toBeGreaterThanOrEqual(1);
  });
});

describe("perlindungan route (kriteria selesai MVP §12 — tanpa login ganda yang bocor)", () => {
  const protectedRoutes = [
    "/",
    "/supervisi",
    "/supervisi/baru",
    `/supervisi/${openSessionId}`,
    `/supervisi/${openSessionId}/pra`,
    `/supervisi/${openSessionId}/observasi`,
    `/supervisi/${openSessionId}/pasca`,
    `/supervisi/${openSessionId}/tindak-lanjut`,
    `/supervisi/${openSessionId}/cetak`,
    `/guru/${guru1.id}`,
    "/rekap/periode/1",
    `/rekap/guru/${guru1.id}`,
    `/rekap/kelas/${classId}`,
    "/rekap",
    "/kop",
    "/admin/pengaturan",
    "/admin/guru",
    "/admin/kelas",
    "/admin/periode",
    "/admin/penugasan",
    "/admin/templat",
    "/admin/templat/baru",
    "/admin/backup",
    "/admin/log",
    "/templat",
    "/bukti/1",
    "/ganti-sandi",
  ];
  for (const route of protectedRoutes) {
    test(`GET ${route} tanpa login → 302 ke /login`, async () => {
      const r = await get(route);
      expect(r.status).toBe(302);
      expect(r.location).toBe("/login");
    });
  }

  test("GET /api/kesehatan tetap publik (200)", async () => {
    const r = await get("/api/kesehatan");
    expect(r.status).toBe(200);
    expect(r.text).toContain('"fase":4');
  });

  test("guru mendapat 403 di /admin/backup dan /admin/log", async () => {
    const guruCookie = await loginAs("guru_cetak1", "rahasia123");
    expect((await get("/admin/backup", guruCookie)).status).toBe(403);
    expect((await get("/admin/log", guruCookie)).status).toBe(403);
  });
});

describe("route restore: konfirmasi + validasi nama (HTTP)", () => {
  test("tanpa ketik RESTORE → ditolak, data tidak berubah", async () => {
    const adminCookie = await loginAs("admin", "admin123");
    const [before] = await pool.query<(RowDataPacket & { c: number })[]>("SELECT COUNT(*) AS c FROM sessions");
    const res = await fetch(`${base}/admin/backup/restore`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: adminCookie },
      body: new URLSearchParams({ dump_name: "db-apa-saja.sql.gz", konfirmasi: "YA", sadar: "1" }),
      redirect: "manual",
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location") ?? "").toContain("/admin/backup?err=");
    const [after] = await pool.query<(RowDataPacket & { c: number })[]>("SELECT COUNT(*) AS c FROM sessions");
    expect(after[0]!.c).toBe(before[0]!.c);
  });

  test("nama dump dengan path traversal ditolak", async () => {
    const adminCookie = await loginAs("admin", "admin123");
    const res = await fetch(`${base}/admin/backup/restore`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: adminCookie },
      body: new URLSearchParams({ dump_name: "../../etc/passwd.sql.gz", konfirmasi: "RESTORE", sadar: "1" }),
      redirect: "manual",
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location") ?? "").toContain("/admin/backup?err=");
  });
});
