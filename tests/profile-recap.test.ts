import { afterAll, describe, expect, test } from "bun:test";
import mysql from "mysql2/promise";
import type { RowDataPacket } from "mysql2/promise";
import { ensureTestDb, closePool } from "./helpers";
import { createApp } from "../src/index";
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
  canViewClassRecap,
  canViewTeacher,
  classRecap,
  indicatorDistribution,
  periodRecap,
  teacherPeriodScore,
  teacherProfile,
  trendSvg,
  viewScopeTeacherIds,
} from "../src/lib/recap";
import type { SessionUser } from "../src/auth";

process.env.DB_NAME = "gezyspv_test_profile";

const pool = await ensureTestDb("gezyspv_test_profile");
await seedAll(pool, hashPassword, "admin123");

const [periodRows] = await pool.query<(RowDataPacket & { id: number })[]>(
  "SELECT id FROM periods WHERE is_active = 1 ORDER BY id LIMIT 1",
);
const periodId = periodRows[0]!.id;

async function makeClass(name: string): Promise<number> {
  const [rows] = await pool.query<(RowDataPacket & { id: number })[]>(
    "SELECT id FROM classes WHERE period_id = ? AND name = ?",
    [periodId, name],
  );
  if (rows.length > 0) return rows[0]!.id;
  const [res] = await pool.query<mysql.ResultSetHeader>(
    "INSERT INTO classes (period_id, name, level_label) VALUES (?, ?, 'Kelas 9')",
    [periodId, name],
  );
  return res.insertId;
}

const class9A = await makeClass("9A");
const class9B = await makeClass("9B");

const [seedTplRows] = await pool.query<(RowDataPacket & { id: number })[]>(
  "SELECT id FROM templates WHERE is_seed = 1",
);
const seedTemplateId = seedTplRows[0]!.id;

async function makeUser(
  username: string,
  name: string,
  role: "admin" | "supervisor" | "guru",
  isPrincipal = 0,
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
    "INSERT INTO users (username, name, password_hash, role, is_principal, must_change_password) VALUES (?, ?, ?, ?, ?, 0)",
    [username, name, await hashPassword("rahasia123"), role, isPrincipal],
  );
  return {
    id: res.insertId,
    username,
    name,
    nip: null,
    role,
    is_principal: isPrincipal === 1,
    must_change_password: false,
    active: true,
  };
}

const admin1 = await makeUser("admin_prof", "Admin Profil", "admin");
const sup1 = await makeUser("sup_prof", "Supervisor Profil", "supervisor");
const sup2 = await makeUser("sup_prof2", "Supervisor Tanpa Tugas", "supervisor");
const kepsek = await makeUser("kepsek_prof", "Kepala Sekolah", "supervisor", 1);
const guru1 = await makeUser("guru_prof1", "Guru Satu Profil", "guru");
const guru2 = await makeUser("guru_prof2", "Guru Dua Profil", "guru");
const guru3 = await makeUser("guru_prof3", "Guru Tiga Profil", "guru");
const guru4 = await makeUser("guru_prof4", "Guru Empat Profil", "guru");

for (const g of [guru1, guru3, guru4]) {
  await pool.query("INSERT INTO supervisor_assignments (supervisor_id, teacher_id) VALUES (?, ?)", [
    sup1.id,
    g.id,
  ]);
}

function sessionInput(teacherId: number, classId: number, observedAt: string) {
  return {
    templateId: seedTemplateId,
    teacherId,
    classId,
    subject_theme: "Descriptive Text — Bahasa Inggris",
    phase_semester: "Semester 1",
    observed_at: observedAt,
    observed_time: "08:00",
  };
}

/** Buat sesi dan isi penuh sampai selesai; values = skor per indikator (11). */
async function completeSession(
  sup: SessionUser,
  guru: SessionUser,
  values: number[],
  observedAt: string,
  classId: number,
): Promise<number> {
  const id = await createSession(pool, sup, sessionInput(guru.id, classId, observedAt));
  const snap = await loadSnapshot(pool, id);
  await savePra(pool, sup, id, Object.fromEntries(snap.praQuestions.map((q) => [q.id, "Diskusi pra."])));
  await setSessionStatus(pool, sup, id, "observasi");
  const inds = snap.elements.flatMap((el) => el.indicators);
  await saveScores(
    pool,
    sup,
    id,
    inds.map((ind, i) => ({ indicatorId: ind.id, value: values[i]!, evidence: "Terlihat di kelas." })),
  );
  await setSessionStatus(pool, sup, id, "pasca");
  await savePascaGuru(pool, guru, id, Object.fromEntries(snap.pascaQuestions.map((q) => [q.id, "Refleksi guru."])));
  await savePascaSupervisor(pool, sup, id, Object.fromEntries(snap.pascaQuestions.map((q) => [q.id, "Catatan supervisor."])));
  await setSessionStatus(pool, sup, id, "tindak_lanjut");
  await saveRtl(pool, sup, id, Object.fromEntries(snap.rtlItems.map((r) => [r.id, "Rencana aksi."])));
  await setSessionStatus(pool, sup, id, "selesai");
  return id;
}

// guru1: A semua 3 (75,0 Cukup, 2026-11-03, 9A), B semua 4 (100,0 Sangat Baik, 2026-11-10, 9A),
//       C masih berjalan (status pra, 2026-11-12, 9A).
// guru3: D semua 2 (50,0 Sangat Kurang, 2026-11-05, 9B).
// guru2: tanpa sesi. guru4: hanya sesi berjalan.
const sessionA = await completeSession(sup1, guru1, Array(11).fill(3), "2026-11-03", class9A);
const sessionB = await completeSession(sup1, guru1, Array(11).fill(4), "2026-11-10", class9A);
const sessionC = await createSession(pool, sup1, sessionInput(guru1.id, class9A, "2026-11-12"));
const sessionD = await completeSession(sup1, guru3, Array(11).fill(2), "2026-11-05", class9B);
const sessionE = await createSession(pool, sup1, sessionInput(guru4.id, class9B, "2026-11-11"));
void sessionC;
void sessionE;

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

async function getPage(
  path: string,
  cookie: string,
): Promise<{ status: number; text: string }> {
  const res = await fetch(`${base}${path}`, { headers: { Cookie: cookie }, redirect: "manual" });
  return { status: res.status, text: await res.text() };
}

describe("grafik tren SVG (murni)", () => {
  test("dua titik: garis + dua lingkaran + label tema di title", () => {
    const svg = trendSvg([
      { date: "2026-11-03", score100: 75, label: "Descriptive Text — 2026-11-03 — nilai 75.0 (Cukup)" },
      { date: "2026-11-10", score100: 100, label: "Descriptive Text — 2026-11-10 — nilai 100.0 (Sangat Baik)" },
    ]);
    expect(svg).toContain("<svg");
    expect(svg).toContain("<polyline");
    expect((svg.match(/<circle/g) ?? []).length).toBe(2);
    expect(svg).toContain("nilai 100.0 (Sangat Baik)");
    expect(svg).toContain("2026-11-03");
  });

  test("satu titik: lingkaran tanpa garis", () => {
    const svg = trendSvg([{ date: "2026-11-03", score100: 75, label: "Satu sesi" }]);
    expect((svg.match(/<circle/g) ?? []).length).toBe(1);
    expect(svg).not.toContain("<polyline");
  });

  test("tanpa titik: tidak ada lingkaran", () => {
    const svg = trendSvg([]);
    expect(svg).not.toContain("<circle");
  });
});

describe("profil guru (service)", () => {
  test("tren dan rata-rata hanya memakai sesi selesai; sesi berjalan terpisah tanpa skor", async () => {
    const prof = await teacherProfile(pool, guru1.id, periodId);
    expect(prof.completed.map((s) => s.id).sort()).toEqual([sessionA, sessionB].sort());
    expect(prof.inProgress.map((s) => s.id)).toEqual([sessionC]);
    expect(prof.inProgress[0]!.final100).toBeNull();
    expect(prof.completed[0]!.final100).toBeCloseTo(75, 5);
    expect(prof.completed[1]!.final100).toBeCloseTo(100, 5);
    expect(prof.completed[0]!.predicate).toBe("Cukup");
    expect(prof.completed[1]!.predicate).toBe("Sangat Baik");
  });

  test("skor guru per periode: rata-rata 87,5 dari 2 sesi, beserta rincian + predikat", async () => {
    const score = await teacherPeriodScore(pool, guru1.id, periodId);
    expect(score.count).toBe(2);
    expect(score.average).toBeCloseTo(87.5, 5);
    expect(score.sessions.map((s) => s.predicate).sort()).toEqual(["Cukup", "Sangat Baik"]);
  });

  test("distribusi per indikator menghitung label dengan benar", async () => {
    const snapA = await loadSnapshot(pool, sessionA);
    const firstText = snapA.elements[0]!.indicators[0]!.text;
    const [labRows] = await pool.query<(RowDataPacket & { v: number; label: string })[]>(
      "SELECT v, label FROM session_scale_levels WHERE session_id = ? ORDER BY v",
      [sessionA],
    );
    const label3 = labRows.find((r) => r.v === 3)!.label;
    const label4 = labRows.find((r) => r.v === 4)!.label;
    const dist = await indicatorDistribution(pool, guru1.id, periodId);
    const rows = dist.filter((d) => d.indicator_text === firstText);
    expect(rows.find((d) => d.value === 3)).toMatchObject({ label: label3, count: 1 });
    expect(rows.find((d) => d.value === 4)).toMatchObject({ label: label4, count: 1 });
    expect(rows.length).toBe(2);
  });

  test("guru tanpa sesi: rata-rata null, distribusi kosong", async () => {
    const score = await teacherPeriodScore(pool, guru2.id, periodId);
    expect(score.average).toBeNull();
    expect(score.count).toBe(0);
    expect(await indicatorDistribution(pool, guru2.id, periodId)).toEqual([]);
  });
});

describe("rekap sekolah per periode (service)", () => {
  test("rata-rata per elemen 75,0; distribusi predikat; rata-rata akhir 75,0", async () => {
    const recap = await periodRecap(pool, periodId, null);
    expect(recap.completedCount).toBe(3);
    expect(recap.averageFinal).toBeCloseTo(75, 5);
    expect(recap.elementAverages.length).toBe(4);
    for (const e of recap.elementAverages) expect(e.avg100).toBeCloseTo(75, 5);
    const pred = Object.fromEntries(recap.predicateDistribution.map((d) => [d.label, d.count]));
    expect(pred).toEqual({ Cukup: 1, "Sangat Baik": 1, "Sangat Kurang": 1 });
  });

  test("daftar belum disupervisi: guru2 saja (guru4 punya sesi berjalan, jadi tidak masuk)", async () => {
    const recap = await periodRecap(pool, periodId, null);
    expect(recap.unsupervised?.map((g) => g.username)).toEqual(["guru_prof2"]);
  });

  test("lingkup supervisor: guru di luar penugasan tidak muncul di daftar belum disupervisi", async () => {
    const scope = await viewScopeTeacherIds(pool, sup1);
    expect(scope?.sort()).toEqual([guru1.id, guru3.id, guru4.id].sort());
    const recap = await periodRecap(pool, periodId, scope);
    expect(recap.unsupervised).toEqual([]);
    expect(recap.averageFinal).toBeCloseTo(75, 5);
  });
});

describe("rekap kelas (service)", () => {
  test("kelas 9A: rata-rata 87,5; per guru + per sesi terinci", async () => {
    const recap = await classRecap(pool, class9A, null);
    expect(recap.completedCount).toBe(2);
    expect(recap.averageFinal).toBeCloseTo(87.5, 5);
    expect(recap.perTeacher.length).toBe(1);
    expect(recap.perTeacher[0]!.teacher_name).toBe("Guru Satu Profil");
    expect(recap.perTeacher[0]!.average).toBeCloseTo(87.5, 5);
    expect(recap.perTeacher[0]!.sessions.length).toBe(2);
  });

  test("kelas 9B: rata-rata 50,0 dari satu sesi selesai (sesi berjalan tidak ikut)", async () => {
    const recap = await classRecap(pool, class9B, null);
    expect(recap.completedCount).toBe(1);
    expect(recap.averageFinal).toBeCloseTo(50, 5);
  });
});

describe("hak akses profil/rekap (service)", () => {
  test("supervisor non-Kepsek 403 untuk guru yang tidak ditugaskan; Kepsek dan admin boleh", async () => {
    expect(await canViewTeacher(pool, sup1, guru2.id)).toBe(false);
    expect(await canViewTeacher(pool, sup1, guru1.id)).toBe(true);
    expect(await canViewTeacher(pool, kepsek, guru2.id)).toBe(true);
    expect(await canViewTeacher(pool, admin1, guru2.id)).toBe(true);
  });

  test("guru hanya boleh melihat dirinya sendiri", async () => {
    expect(await canViewTeacher(pool, guru1, guru1.id)).toBe(true);
    expect(await canViewTeacher(pool, guru1, guru2.id)).toBe(false);
  });

  test("rekap kelas: supervisor tanpa penugasan ditolak; guru hanya kelasnya sendiri", async () => {
    expect(await canViewClassRecap(pool, sup2, class9A)).toBe(false);
    expect(await canViewClassRecap(pool, sup1, class9A)).toBe(true);
    expect(await canViewClassRecap(pool, guru1, class9A)).toBe(true);
    expect(await canViewClassRecap(pool, guru1, class9B)).toBe(false);
    expect(await canViewClassRecap(pool, kepsek, class9B)).toBe(true);
  });
});

describe("profil & rekap (HTTP)", () => {
  test("profil guru menampilkan tren + rata-rata periode beserta rincian", async () => {
    const cookie = await loginAs("sup_prof", "rahasia123");
    const r = await getPage(`/guru/${guru1.id}`, cookie);
    expect(r.status).toBe(200);
    expect(r.text).toContain("Tren skor");
    expect(r.text).toContain("87.5");
    expect(r.text).toContain("Cukup");
    expect(r.text).toContain("Sangat Baik");
    expect(r.text).toContain("<svg");
  });

  test("profil guru lain oleh supervisor non-Kepsek → 403; oleh guru lain → 403", async () => {
    const cookieSup = await loginAs("sup_prof", "rahasia123");
    expect((await getPage(`/guru/${guru2.id}`, cookieSup)).status).toBe(403);
    const cookieGuru = await loginAs("guru_prof1", "rahasia123");
    expect((await getPage(`/guru/${guru2.id}`, cookieGuru)).status).toBe(403);
    expect((await getPage(`/guru/${guru1.id}`, cookieGuru)).status).toBe(200);
  });

  test("rekap periode menampilkan angka + daftar belum disupervisi", async () => {
    const cookie = await loginAs("admin_prof", "rahasia123");
    const r = await getPage(`/rekap/periode/${periodId}`, cookie);
    expect(r.status).toBe(200);
    expect(r.text).toContain("Rekap Sekolah");
    expect(r.text).toContain("75.0");
    expect(r.text).toContain("Guru Dua Profil");
  });

  test("rekap guru per periode menampilkan rata-rata beserta rincian sesi", async () => {
    const cookie = await loginAs("sup_prof", "rahasia123");
    const r = await getPage(`/rekap/guru/${guru1.id}`, cookie);
    expect(r.status).toBe(200);
    expect(r.text).toContain("87.5");
  });

  test("rekap kelas: supervisor boleh, guru kelas lain → 403", async () => {
    const cookieSup = await loginAs("sup_prof", "rahasia123");
    const ok = await getPage(`/rekap/kelas/${class9A}`, cookieSup);
    expect(ok.status).toBe(200);
    expect(ok.text).toContain("87.5");
    const cookieGuru = await loginAs("guru_prof1", "rahasia123");
    expect((await getPage(`/rekap/kelas/${class9B}`, cookieGuru)).status).toBe(403);
  });
});
