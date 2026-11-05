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
  generateNarrative,
  getNarrativeForDisplay,
  getStoredNarrative,
  regenerateNarrative,
  saveNarrative,
  type NarrativeInput,
} from "../src/lib/narrative";
import type { SessionUser } from "../src/auth";

process.env.DB_NAME = "gezyspv_test_narrative";

const pool = await ensureTestDb("gezyspv_test_narrative");
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

const sup1 = await makeUser("sup_nar", "Supervisor Narasi", "guru", 0, 1);
const sup2 = await makeUser("sup_nar2", "Supervisor Lain", "guru", 0, 1);
const guru1 = await makeUser("guru_nar1", "Guru Narasi", "guru");

await pool.query("INSERT INTO supervisor_assignments (supervisor_id, teacher_id) VALUES (?, ?)", [
  sup1.id,
  guru1.id,
]);

function sessionInput(teacherId: number, observedAt: string) {
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
): Promise<number> {
  const id = await createSession(pool, sup, sessionInput(guru.id, observedAt));
  const snap = await loadSnapshot(pool, id);
  await savePra(pool, sup, id, Object.fromEntries(snap.praQuestions.map((q) => [q.id, "Diskusi pra."])));
  await setSessionStatus(pool, sup, id, "observasi");
  const inds = snap.elements.flatMap((el) => el.indicators);
  await saveScores(
    pool,
    sup,
    id,
    inds.map((ind, i) => ({ indicatorId: ind.id, value: values[i]!, evidence: "Siswa berani mencoba soal sulit." })),
  );
  await setSessionStatus(pool, sup, id, "pasca");
  await savePascaGuru(pool, guru, id, Object.fromEntries(snap.pascaQuestions.map((q) => [q.id, "Saya akan memberi umpan balik lebih spesifik."])));
  await savePascaSupervisor(pool, sup, id, Object.fromEntries(snap.pascaQuestions.map((q) => [q.id, "Catatan supervisor."])));
  await setSessionStatus(pool, sup, id, "tindak_lanjut");
  await saveRtl(pool, sup, id, Object.fromEntries(snap.rtlItems.map((r) => [r.id, "Lanjutkan praktik baik ini."])));
  await setSessionStatus(pool, sup, id, "selesai");
  return id;
}

const sessionId = await completeSession(sup1, guru1, Array(11).fill(3), "2026-11-06");
const draftSessionId = await createSession(pool, sup1, sessionInput(guru1.id, "2026-11-07"));

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

async function postForm(
  path: string,
  cookie: string,
  body: URLSearchParams,
): Promise<{ status: number; location: string | null }> {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cookie },
    body,
    redirect: "manual",
  });
  await res.text();
  return { status: res.status, location: res.headers.get("location") };
}

const scaleLevels = [
  { v: 1, label: "Belum Teramati" },
  { v: 2, label: "Mulai Teramati" },
  { v: 3, label: "Teramati dengan Baik" },
  { v: 4, label: "Sangat Teramati & Menginspirasi" },
];
const predicates = [
  { min: 90, max: 100, label: "Sangat Baik" },
  { min: 80, max: 89, label: "Baik" },
  { min: 70, max: 79, label: "Cukup" },
  { min: 60, max: 69, label: "Kurang" },
  { min: 0, max: 59, label: "Sangat Kurang" },
];

function narrativeInput(overrides: Partial<NarrativeInput> = {}): NarrativeInput {
  // A: 4,4,3 | B: 3,3,2 | C: 4,3,3 | D: 2,2 → rata-rata 3,00 → 75,0 (Cukup).
  const values = [4, 4, 3, 3, 3, 2, 4, 3, 3, 2, 2];
  const codes = ["A", "A", "A", "B", "B", "B", "C", "C", "C", "D", "D"];
  const titles = [
    "Iklim Belajar Ramah Pertumbuhan",
    "Iklim Belajar Ramah Pertumbuhan",
    "Iklim Belajar Ramah Pertumbuhan",
    "Bahasa & Umpan Balik Guru",
    "Bahasa & Umpan Balik Guru",
    "Bahasa & Umpan Balik Guru",
    "Fasilitasi Tantangan & Resiliensi Siswa",
    "Fasilitasi Tantangan & Resiliensi Siswa",
    "Fasilitasi Tantangan & Resiliensi Siswa",
    "Refleksi Proses & Kesadaran Belajar Siswa",
    "Refleksi Proses & Kesadaran Belajar Siswa",
  ];
  return {
    teacherName: "Guru Narasi",
    subjectTheme: "Descriptive Text",
    observedAt: "2026-11-06",
    indicators: values.map((v, i) => ({ element_code: codes[i]!, element_title: titles[i]!, value: v })),
    scaleLevels,
    predicates,
    evidenceNotes: ["Siswa berani mencoba soal sulit."],
    guruReflections: ["Saya akan memberi umpan balik lebih spesifik."],
    rtlNotes: ["Lanjutkan praktik baik ini.", "Latih umpan balik proses.", "Dampingi lewat MGMP."],
    ...overrides,
  };
}

describe("generator narasi (murni)", () => {
  test("sesi lengkap: memakai elemen terkuat/terlemah, predikat, label tersering, RTL — tanpa karangan", () => {
    const text = generateNarrative(narrativeInput());
    expect(text).toContain("75.0");
    expect(text).toContain("Cukup");
    expect(text).toContain("Iklim Belajar Ramah Pertumbuhan");
    expect(text).toContain("Refleksi Proses & Kesadaran Belajar Siswa");
    expect(text).toContain("Teramati dengan Baik");
    expect(text).toContain("Lanjutkan praktik baik ini.");
    expect(text).toContain("Saya akan memberi umpan balik lebih spesifik.");
  });

  test("sesi belum lengkap: jujur menyatakan belum selesai, bukan narasi karangan", () => {
    const input = narrativeInput();
    input.indicators[10]!.value = null;
    const text = generateNarrative(input);
    expect(text).toContain("belum selesai");
    expect(text).toContain("10 dari 11");
    expect(text).not.toContain("Nilai akhir");
    expect(text).not.toContain("predikat");
  });

  test("semua elemen sama: tidak memaksakan terkuat/terlemah yang berbeda", () => {
    const input = narrativeInput();
    input.indicators = input.indicators.map((i) => ({ ...i, value: 3 }));
    const text = generateNarrative(input);
    expect(text).toContain("Semua elemen memperoleh rata-rata yang sama");
  });
});

describe("editor narasi (service)", () => {
  test("tampilan awal: narasi otomatis, belum diedit", async () => {
    const shown = await getNarrativeForDisplay(pool, sessionId);
    expect(shown.edited).toBe(false);
    expect(shown.text).toContain("75.0");
    expect(shown.text).toContain("Cukup");
  });

  test("edit supervisor tersimpan dan tidak tertimpa tampilan berikutnya", async () => {
    await saveNarrative(pool, sup1, sessionId, "Narasi editan supervisor — hasil diskusi pasca.");
    const stored = await getStoredNarrative(pool, sessionId);
    expect(stored?.narrative).toBe("Narasi editan supervisor — hasil diskusi pasca.");
    const shown = await getNarrativeForDisplay(pool, sessionId);
    expect(shown.edited).toBe(true);
    expect(shown.text).toBe("Narasi editan supervisor — hasil diskusi pasca.");
  });

  test("tombol buat ulang menimpa narasi editan dengan hasil generator", async () => {
    const text = await regenerateNarrative(pool, sup1, sessionId);
    expect(text).toContain("75.0");
    expect(text).not.toContain("Narasi editan supervisor");
    const stored = await getStoredNarrative(pool, sessionId);
    expect(stored?.narrative).toBe(text);
  });

  test("guru tidak bisa mengedit narasi", async () => {
    await expect(saveNarrative(pool, guru1, sessionId, "Coba edit.")).rejects.toThrow(
      "Hanya supervisor pembuat sesi",
    );
    await expect(regenerateNarrative(pool, guru1, sessionId)).rejects.toThrow(
      "Hanya supervisor pembuat sesi",
    );
  });

  test("supervisor lain (bukan pembuat sesi) tidak bisa mengedit narasi", async () => {
    await expect(saveNarrative(pool, sup2, sessionId, "Coba edit.")).rejects.toThrow(
      "Hanya supervisor pembuat sesi",
    );
  });

  test("narasi belum bisa diedit sebelum tahap tindak lanjut", async () => {
    await expect(saveNarrative(pool, sup1, draftSessionId, "Terlalu dini.")).rejects.toThrow(
      "baru bisa diedit pada tahap tindak lanjut",
    );
  });

  test("edit sesudah sesi selesai dicatat di audit log", async () => {
    await saveNarrative(pool, sup1, sessionId, "Narasi final sesudah selesai.");
    const [rows] = await pool.query<(RowDataPacket & { c: number })[]>(
      "SELECT COUNT(*) AS c FROM audit_logs WHERE entity_id = ? AND action = 'narrative.edit_after_complete'",
      [sessionId],
    );
    expect(rows[0]!.c).toBeGreaterThan(0);
  });

  test("narasi kosong ditolak", async () => {
    await expect(saveNarrative(pool, sup1, sessionId, "   ")).rejects.toThrow("tidak boleh kosong");
  });
});

describe("editor narasi (HTTP)", () => {
  test("guru POST narasi → ditolak (redirect err)", async () => {
    const cookie = await loginAs("guru_nar1", "rahasia123");
    const r = await postForm(
      `/supervisi/${sessionId}/narasi`,
      cookie,
      new URLSearchParams({ narasi: "Coba edit lewat HTTP." }),
    );
    expect(r.status).toBe(302);
    expect(r.location ?? "").toContain("err=");
  });

  test("supervisor pembuat POST narasi → tersimpan", async () => {
    const cookie = await loginAs("sup_nar", "rahasia123");
    const r = await postForm(
      `/supervisi/${sessionId}/narasi`,
      cookie,
      new URLSearchParams({ narasi: "Narasi via HTTP." }),
    );
    expect(r.status).toBe(302);
    expect(r.location ?? "").toContain("ok=");
    const stored = await getStoredNarrative(pool, sessionId);
    expect(stored?.narrative).toBe("Narasi via HTTP.");
  });

  test("supervisor pembuat POST buat-ulang → menimpa dengan hasil generator", async () => {
    const cookie = await loginAs("sup_nar", "rahasia123");
    const r = await postForm(`/supervisi/${sessionId}/narasi/buat-ulang`, cookie, new URLSearchParams());
    expect(r.status).toBe(302);
    expect(r.location ?? "").toContain("ok=");
    const stored = await getStoredNarrative(pool, sessionId);
    expect(stored?.narrative).toContain("75.0");
  });
});
