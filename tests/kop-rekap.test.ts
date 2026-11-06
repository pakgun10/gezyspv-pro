import { afterAll, describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import mysql from "mysql2/promise";
import type { RowDataPacket } from "mysql2/promise";
import { ensureTestDb, closePool } from "./helpers";
import { createApp } from "../src/index";
import { appliedMigrations } from "../src/db";
import { hashPassword } from "../src/auth";
import { seedAll } from "../src/lib/seed";
import { createSession, savePascaGuru, savePascaSupervisor, savePra, saveRtl, saveScores, setSessionStatus, loadSnapshot } from "../src/lib/sessions";
import { kopDir, kopFilePath } from "../src/lib/kop";
import type { SessionUser } from "../src/auth";

// Database + folder data khusus tes kop/rekap.
process.env.DB_NAME = "gezyspv_test_kop";
const TEST_DATA_DIR = "/tmp/gezyspv-test-kop";
process.env.DATA_DIR = TEST_DATA_DIR;

const pool = await ensureTestDb("gezyspv_test_kop");
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
  const [classRes] = await pool.query<mysql.ResultSetHeader>(
    "INSERT INTO classes (period_id, name, level_label) VALUES (?, '9A', 'Kelas 9')",
    [periodId],
  );
  classId = classRes.insertId;
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

const admin = await makeUser("admin_kop", "Admin Kop", "admin");
void admin;
const sup = await makeUser("sup_kop", "Supervisor Kop", "guru", 0, 1);
const guru = await makeUser("guru_kop", "Guru Kop", "guru");
await pool.query("INSERT INTO supervisor_assignments (supervisor_id, teacher_id) VALUES (?, ?)", [sup.id, guru.id]);

const doneSessionId = await createSession(pool, sup, {
  templateId: seedTemplateId,
  teacherId: guru.id,
  classId,
  subject_theme: "Descriptive Text — Bahasa Inggris",
  phase_semester: "Semester 1",
  observed_at: "2026-11-06",
  observed_time: "08:00",
});
// Lengkapi sesi agar halaman Cetak berisi seluruh bagian.
{
  const snap = await loadSnapshot(pool, doneSessionId);
  await savePra(pool, sup, doneSessionId, Object.fromEntries(snap.praQuestions.map((q) => [q.id, "Diskusi pra."])));
  await setSessionStatus(pool, sup, doneSessionId, "observasi");
  const ids = snap.elements.flatMap((el) => el.indicators.map((i) => i.id));
  await saveScores(pool, sup, doneSessionId, ids.map((id, i) => ({ indicatorId: id, value: (i % 4) + 1, evidence: "Terlihat di kelas." })));
  await setSessionStatus(pool, sup, doneSessionId, "pasca");
  await savePascaGuru(pool, guru, doneSessionId, Object.fromEntries(snap.pascaQuestions.map((q) => [q.id, "Refleksi guru."])));
  await savePascaSupervisor(pool, sup, doneSessionId, Object.fromEntries(snap.pascaQuestions.map((q) => [q.id, "Catatan supervisor."])));
  await setSessionStatus(pool, sup, doneSessionId, "tindak_lanjut");
  await saveRtl(pool, sup, doneSessionId, Object.fromEntries(snap.rtlItems.map((r) => [r.id, "Rencana aksi."])));
  await setSessionStatus(pool, sup, doneSessionId, "selesai");
}

const app = createApp();
const server = app.listen(0);
const port = server.server!.port;
const base = `http://127.0.0.1:${port}`;

afterAll(async () => {
  server.stop();
  await closePool();
  await rm(TEST_DATA_DIR, { recursive: true, force: true });
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

async function get(path: string, cookie?: string): Promise<{ status: number; location: string | null; text: string; contentType: string | null }> {
  const res = await fetch(`${base}${path}`, {
    headers: cookie ? { Cookie: cookie } : {},
    redirect: "manual",
  });
  return { status: res.status, location: res.headers.get("location"), text: await res.text(), contentType: res.headers.get("content-type") };
}

async function postForm(path: string, cookie: string, fields: Record<string, string>): Promise<Response> {
  return fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cookie },
    body: new URLSearchParams(fields),
    redirect: "manual",
  });
}

async function postMultipart(path: string, cookie: string | undefined, form: FormData): Promise<Response> {
  const headers: Record<string, string> = {};
  if (cookie) headers.Cookie = cookie;
  return fetch(`${base}${path}`, { method: "POST", headers, body: form, redirect: "manual" });
}

async function kopPathInDb(): Promise<string | null> {
  const [rows] = await pool.query<(RowDataPacket & { kop_path: string | null })[]>(
    "SELECT kop_path FROM settings WHERE id = 1",
  );
  return rows[0]?.kop_path ?? null;
}

/** PNG 1x1 transparan (valid, kecil). */
function pngFile(name = "kop.png"): File {
  const b64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  return new File([Buffer.from(b64, "base64")], name, { type: "image/png" });
}

describe("Kop laporan: migrasi + pengaturan", () => {
  test("migrasi 004 tercatat; kolom kop_path ada dan awalnya NULL", async () => {
    const applied = await appliedMigrations();
    expect(applied).toContain("004_kop_rekap.sql");
    const [cols] = await pool.query<(RowDataPacket & { COLUMN_NAME: string })[]>(
      "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'settings' AND COLUMN_NAME = 'kop_path'",
    );
    expect(cols.length).toBe(1);
    expect(await kopPathInDb()).toBeNull();
  });

  test("pengaturan memuat seksi Kop laporan", async () => {
    const adminCookie = await loginAs("admin_kop", "rahasia123");
    const page = await get("/admin/pengaturan", adminCookie);
    expect(page.status).toBe(200);
    expect(page.text).toContain("Kop laporan");
    expect(page.text).toContain("PNG/JPEG");
    expect(page.text).toContain("maks 2 MB");
  });
});

describe("Kop laporan: unggah, sajikan, hapus", () => {
  test("unggah PNG valid → 302 + kop_path terisi + berkas ada di disk", async () => {
    const adminCookie = await loginAs("admin_kop", "rahasia123");
    const form = new FormData();
    form.append("file", pngFile());
    const res = await postMultipart("/admin/pengaturan/kop", adminCookie, form);
    expect(res.status).toBe(302);
    expect(res.headers.get("location") ?? "").toContain("/admin/pengaturan?ok=");
    const stored = await kopPathInDb();
    expect(stored).toMatch(/^kop-\d+\.png$/);
    expect(await Bun.file(kopFilePath(stored!)).exists()).toBe(true);
    expect(kopDir().endsWith("kop")).toBe(true);
  });

  test("GET /kop: 200 + image/png bila ada; guru juga boleh", async () => {
    const adminCookie = await loginAs("admin_kop", "rahasia123");
    const r = await get("/kop", adminCookie);
    expect(r.status).toBe(200);
    expect(r.contentType ?? "").toContain("image/png");
    const guruCookie = await loginAs("guru_kop", "rahasia123");
    const r2 = await get("/kop", guruCookie);
    expect(r2.status).toBe(200);
  });

  test("cetak memakai gambar kop bila ada (tanpa kop teks)", async () => {
    const supCookie = await loginAs("sup_kop", "rahasia123");
    const page = await get(`/supervisi/${doneSessionId}/cetak`, supCookie);
    expect(page.status).toBe(200);
    expect(page.text).toContain('<img src="/kop"');
    expect(page.text).not.toContain('<div class="kop">');
  });

  test("file .txt ditolak; file >2 MB ditolak; kop lama tidak berubah", async () => {
    const adminCookie = await loginAs("admin_kop", "rahasia123");
    const before = await kopPathInDb();
    expect(before).not.toBeNull();
    const txt = new FormData();
    txt.append("file", new File(["bukan gambar"], "kop.txt", { type: "text/plain" }));
    const r1 = await postMultipart("/admin/pengaturan/kop", adminCookie, txt);
    expect(r1.status).toBe(302);
    expect(r1.headers.get("location") ?? "").toContain("/admin/pengaturan?err=");
    expect(r1.headers.get("location") ?? "").toContain("PNG");
    const big = new FormData();
    big.append("file", new File([Buffer.alloc(2 * 1024 * 1024 + 1)], "besar.png", { type: "image/png" }));
    const r2 = await postMultipart("/admin/pengaturan/kop", adminCookie, big);
    expect(r2.status).toBe(302);
    expect(r2.headers.get("location") ?? "").toContain("/admin/pengaturan?err=");
    expect(await kopPathInDb()).toBe(before);
  });

  test("guru 403 di POST unggah/hapus; tanpa login 302", async () => {
    const guruCookie = await loginAs("guru_kop", "rahasia123");
    const form = new FormData();
    form.append("file", pngFile());
    const r1 = await postMultipart("/admin/pengaturan/kop", guruCookie, form);
    expect(r1.status).toBe(403);
    const r2 = await postForm("/admin/pengaturan/kop/hapus", guruCookie, {});
    expect(r2.status).toBe(403);
    const r3 = await postMultipart("/admin/pengaturan/kop", undefined, form);
    expect(r3.status).toBe(302);
    expect(r3.headers.get("location") ?? "").toContain("/login");
  });

  test("hapus kop → NULL + berkas hilang; cetak kembali ke kop teks; /kop 404", async () => {
    const adminCookie = await loginAs("admin_kop", "rahasia123");
    const before = await kopPathInDb();
    expect(before).not.toBeNull();
    const res = await postForm("/admin/pengaturan/kop/hapus", adminCookie, {});
    expect(res.status).toBe(302);
    expect(res.headers.get("location") ?? "").toContain("/admin/pengaturan?ok=");
    expect(await kopPathInDb()).toBeNull();
    expect(await Bun.file(kopFilePath(before!)).exists()).toBe(false);
    const kop = await get("/kop", adminCookie);
    expect(kop.status).toBe(404);
    const supCookie = await loginAs("sup_kop", "rahasia123");
    const page = await get(`/supervisi/${doneSessionId}/cetak`, supCookie);
    expect(page.status).toBe(200);
    expect(page.text).toContain('<div class="kop">');
    expect(page.text).not.toContain('<img src="/kop"');
  });
});

describe("Menu Rekap + tombol cetak", () => {
  test("nav memuat href=/rekap; GET /rekap redirect ke periode aktif", async () => {
    const adminCookie = await loginAs("admin_kop", "rahasia123");
    const home = await get("/", adminCookie);
    expect(home.status).toBe(200);
    expect(home.text).toContain('href="/rekap"');
    const r = await get("/rekap", adminCookie);
    expect(r.status).toBe(302);
    expect(r.location).toBe(`/rekap/periode/${periodId}`);
  });

  test("ketiga halaman rekap memuat tombol Cetak + kop (teks, karena kop sudah dihapus)", async () => {
    const adminCookie = await loginAs("admin_kop", "rahasia123");
    for (const path of [`/rekap/periode/${periodId}`, `/rekap/guru/${guru.id}`, `/rekap/kelas/${classId}`]) {
      const page = await get(path, adminCookie);
      expect(page.status).toBe(200);
      expect(page.text).toContain("Cetak / Simpan PDF");
      expect(page.text).toContain("window.print()");
      expect(page.text).toContain('class="kop-cetak"');
      expect(page.text).toContain('<div class="kop">');
      expect(page.text).toContain("SMPN 1 Punggur");
    }
  });

  test("tanpa login: /kop dan /rekap → 302 ke login", async () => {
    const r1 = await get("/kop");
    expect(r1.status).toBe(302);
    expect(r1.location).toContain("/login");
    const r2 = await get("/rekap");
    expect(r2.status).toBe(302);
    expect(r2.location).toContain("/login");
  });
});
