import { afterAll, describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import mysql from "mysql2/promise";
import type { RowDataPacket } from "mysql2/promise";
import { ensureTestDb, closePool } from "./helpers";
import { createApp } from "../src/index";
import { hashPassword } from "../src/auth";
import { seedAll } from "../src/lib/seed";
import { getPool } from "../src/db";
import {
  checkCompletion,
  createSession,
  loadSession,
  loadSnapshot,
  savePascaGuru,
  savePascaSupervisor,
  savePra,
  saveRtl,
  saveScores,
  sessionProgress,
  setSessionStatus,
} from "../src/lib/sessions";
import { elementScores, finalScore100, predicateFor } from "../src/lib/scores";
import {
  countPhotos,
  deleteEvidence,
  getEvidence,
  listEvidence,
  storePhoto,
  validatePhoto,
  validateVideoUrl,
} from "../src/lib/evidence";
import type { SessionUser } from "../src/auth";

// Database khusus tes Fase 2 (service + HTTP dalam satu berkas).
process.env.DB_NAME = "gezyspv_test_sessions";
process.env.DATA_DIR = "/tmp/gezyspv-test-bukti";

const pool = await ensureTestDb("gezyspv_test_sessions");
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
    // user_sessions + audit_logs ikut mereferensi users(id).
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

const sup1 = await makeUser("sup_sesi", "Supervisor Sesi", "supervisor");
const kepsek = await makeUser("kepsek_sesi", "Kepala Sekolah", "supervisor", 1);
const guru1 = await makeUser("guru_sesi1", "Guru Satu", "guru");
const guru2 = await makeUser("guru_sesi2", "Guru Dua", "guru");
const guruHttp = await makeUser("guru_sesi_http", "Guru HTTP", "guru");
const supHttp = await makeUser("sup_sesi_http", "Supervisor HTTP", "supervisor");

await pool.query("INSERT INTO supervisor_assignments (supervisor_id, teacher_id) VALUES (?, ?)", [
  sup1.id,
  guru1.id,
]);
await pool.query("INSERT INTO supervisor_assignments (supervisor_id, teacher_id) VALUES (?, ?)", [
  supHttp.id,
  guruHttp.id,
]);

function sessionInput(teacherId: number, templateId = seedTemplateId) {
  return {
    templateId,
    teacherId,
    classId,
    subject_theme: "Descriptive Text — Bahasa Inggris",
    phase_semester: "Semester 1",
    observed_at: "2026-11-06",
    observed_time: "08:00",
  };
}

async function indicatorIds(sessionId: number): Promise<number[]> {
  const snap = await loadSnapshot(pool, sessionId);
  return snap.elements.flatMap((el) => el.indicators.map((i) => i.id));
}

/** Isi seluruh alur sampai siap selesai: pra → skor semua → refleksi → RTL. */
async function fillToComplete(sessionId: number, sup: SessionUser, guru: SessionUser) {
  const snap = await loadSnapshot(pool, sessionId);
  await savePra(pool, sup, sessionId, Object.fromEntries(snap.praQuestions.map((q) => [q.id, "Diskusi pra."])));
  await setSessionStatus(pool, sup, sessionId, "observasi");
  const ids = await indicatorIds(sessionId);
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
}

const app = createApp();
const server = app.listen(0);
const port = server.server!.port;
const base = `http://127.0.0.1:${port}`;

afterAll(async () => {
  server.stop();
  await closePool();
  await rm("/tmp/gezyspv-test-bukti", { recursive: true, force: true });
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
): Promise<{ status: number; location: string | null; text: string }> {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cookie },
    body,
    redirect: "manual",
  });
  return { status: res.status, location: res.headers.get("location"), text: await res.text() };
}

describe("skor (lib/scores.ts, plan bagian 6)", () => {
  test("rata-rata elemen, skor keseluruhan, skala 100, dan predikat", () => {
    const inds = [
      { value: 4, element_code: "A", element_title: "Iklim Belajar" },
      { value: 3, element_code: "A", element_title: "Iklim Belajar" },
      { value: 2, element_code: "B", element_title: "Bahasa & Umpan Balik" },
      { value: null, element_code: "B", element_title: "Bahasa & Umpan Balik" },
    ];
    const el = elementScores(inds);
    expect(el.find((e) => e.element_code === "A")!.average).toBeCloseTo(3.5);
    expect(el.find((e) => e.element_code === "B")!.average).toBe(2);
    expect(el.find((e) => e.element_code === "B")!.filled).toBe(1);
    expect(finalScore100(inds, [{ v: 1 }, { v: 2 }, { v: 3 }, { v: 4 }])).toBeCloseTo(75);
    const preds = [
      { min: 90, max: 100, label: "Sangat Baik" },
      { min: 80, max: 89, label: "Baik" },
      { min: 70, max: 79, label: "Cukup" },
      { min: 60, max: 69, label: "Kurang" },
      { min: 0, max: 59, label: "Sangat Kurang" },
    ];
    expect(predicateFor(75, preds)).toBe("Cukup");
    expect(predicateFor(100.5, preds)).toBe("—");
    expect(predicateFor(null, preds)).toBe("—");
    expect(finalScore100([], [{ v: 4 }])).toBeNull();
  });
});

describe("sesi: pembuatan + snapshot", () => {
  test("supervisor membuat sesi untuk guru yang ditugaskan; snapshot tersalin", async () => {
    const id = await createSession(pool, sup1, sessionInput(guru1.id));
    const s = await loadSession(pool, id);
    expect(s!.status).toBe("pra");
    const snap = await loadSnapshot(pool, id);
    expect(snap.principles.length).toBe(3);
    expect(snap.elements.reduce((n, e) => n + e.indicators.length, 0)).toBe(11);
    expect(snap.scaleLevels.length).toBe(4);
    expect(snap.praQuestions.length).toBe(5);
    expect(snap.pascaQuestions.length).toBe(5);
    expect(snap.rtlItems.length).toBe(3);
    expect(snap.predicates.length).toBe(5);
    // Snapshot terlepas dari templat: ubah templat tidak mengubah sesi.
    const before = snap.elements[0]!.indicators[0]!.text;
    await pool.query("UPDATE template_indicators SET text = 'DIUBAH' WHERE id = (SELECT id FROM template_indicators ORDER BY id LIMIT 1)");
    const snap2 = await loadSnapshot(pool, id);
    expect(snap2.elements[0]!.indicators[0]!.text).toBe(before);
    await pool.query("UPDATE template_indicators SET text = ? WHERE id = (SELECT id FROM template_indicators ORDER BY id LIMIT 1)", [before]);
  });

  test("supervisor tidak bisa membuat sesi untuk guru yang tidak ditugaskan", async () => {
    await expect(createSession(pool, sup1, sessionInput(guru2.id))).rejects.toThrow(
      "tidak ditugaskan",
    );
  });

  test("Kepala Sekolah bebas membuat sesi untuk guru mana pun", async () => {
    const id = await createSession(pool, kepsek, sessionInput(guru2.id));
    expect((await loadSession(pool, id))!.supervisor_id).toBe(kepsek.id);
  });

  test("guru tidak bisa membuat sesi; templat draf ditolak", async () => {
    await expect(createSession(pool, guru1, sessionInput(guru1.id))).rejects.toThrow(
      "Hanya supervisor",
    );
    const [res] = await pool.query<mysql.ResultSetHeader>(
      "INSERT INTO templates (title, basis, version_label, score_scale, status, is_seed) VALUES ('Templat Draf Tes', 'tes', 'v1', 4, 'draf', 0)",
    );
    await expect(createSession(pool, sup1, sessionInput(guru1.id, res.insertId))).rejects.toThrow(
      "aktif",
    );
  });
});

describe("sesi: alur status", () => {
  test("tidak bisa loncat tahap; bisa mundur selangkah; selesai hanya bila lengkap", async () => {
    const id = await createSession(pool, sup1, sessionInput(guru1.id));
    await expect(setSessionStatus(pool, sup1, id, "pasca")).rejects.toThrow("satu tahap");
    await setSessionStatus(pool, sup1, id, "observasi");
    expect((await loadSession(pool, id))!.status).toBe("observasi");
    await setSessionStatus(pool, sup1, id, "pra");
    expect((await loadSession(pool, id))!.status).toBe("pra");
    // Maju sampai tindak_lanjut tanpa isi → selesai ditolak dengan rincian.
    await setSessionStatus(pool, sup1, id, "observasi");
    await setSessionStatus(pool, sup1, id, "pasca");
    await setSessionStatus(pool, sup1, id, "tindak_lanjut");
    await expect(setSessionStatus(pool, sup1, id, "selesai")).rejects.toThrow(
      "belum bisa diselesaikan",
    );
    const check = await checkCompletion(pool, id);
    expect(check.complete).toBe(false);
    expect(check.indicatorsFilled).toBe(0);
  });

  test("alur lengkap sampai selesai lalu terkunci", async () => {
    const id = await createSession(pool, sup1, sessionInput(guru1.id));
    await fillToComplete(id, sup1, guru1);
    const check = await checkCompletion(pool, id);
    expect(check.complete).toBe(true);
    await setSessionStatus(pool, sup1, id, "selesai");
    expect((await loadSession(pool, id))!.status).toBe("selesai");
    // Terkunci: edit skor dan pindah status ditolak.
    const ids = await indicatorIds(id);
    await expect(
      saveScores(pool, sup1, id, [{ indicatorId: ids[0]!, value: 4, evidence: "x" }]),
    ).rejects.toThrow();
    await expect(setSessionStatus(pool, sup1, id, "tindak_lanjut")).rejects.toThrow();
    const p = await sessionProgress(pool, id);
    expect(p.observasi).toEqual({ filled: 11, total: 11 });
    expect(p.pasca).toEqual({ filled: 5, total: 5 });
    expect(p.tindak_lanjut).toEqual({ filled: 3, total: 3 });
  });

  test("guru lain / supervisor lain tidak bisa mengubah status sesi", async () => {
    const id = await createSession(pool, sup1, sessionInput(guru1.id));
    await expect(setSessionStatus(pool, guru1, id, "observasi")).rejects.toThrow();
    await expect(setSessionStatus(pool, kepsek, id, "observasi")).rejects.toThrow();
  });
});

describe("sesi: skor + refleksi", () => {
  test("skor di luar skala ditolak; NULL mengosongkan; simpan sebagian boleh", async () => {
    const id = await createSession(pool, sup1, sessionInput(guru1.id));
    const ids = await indicatorIds(id);
    await expect(
      saveScores(pool, sup1, id, [{ indicatorId: ids[0]!, value: 5, evidence: "" }]),
    ).rejects.toThrow("tidak valid");
    await expect(
      saveScores(pool, sup1, id, [{ indicatorId: ids[0]!, value: 0, evidence: "" }]),
    ).rejects.toThrow("tidak valid");
    await saveScores(pool, sup1, id, [
      { indicatorId: ids[0]!, value: 3, evidence: "Bukti teks." },
      { indicatorId: ids[1]!, value: null, evidence: "" },
    ]);
    const snap = await loadSnapshot(pool, id);
    const first = snap.elements.flatMap((e) => e.indicators).find((i) => i.id === ids[0]);
    expect(first!.value).toBe(3);
    expect(first!.evidence).toBe("Bukti teks.");
  });

  test("guru hanya bisa isi refleksi saat status pasca; supervisor tidak bisa isi guru_note", async () => {
    const id = await createSession(pool, sup1, sessionInput(guru1.id));
    const snap = await loadSnapshot(pool, id);
    const qid = snap.pascaQuestions[0]!.id;
    // Masih pra → guru ditolak.
    await expect(savePascaGuru(pool, guru1, id, { [qid]: "Refleksi." })).rejects.toThrow(
      "pasca-observasi",
    );
    await setSessionStatus(pool, sup1, id, "observasi");
    await setSessionStatus(pool, sup1, id, "pasca");
    // Supervisor mencoba jalur guru → ditolak; jalur supervisor tidak menyentuh guru_note.
    await expect(savePascaGuru(pool, sup1, id, { [qid]: "Pura-pura guru." })).rejects.toThrow(
      "Hanya guru",
    );
    await savePascaSupervisor(pool, sup1, id, { [qid]: "Catatan supervisor." });
    let snap2 = await loadSnapshot(pool, id);
    expect(snap2.pascaQuestions[0]!.guru_note).toBe("");
    expect(snap2.pascaQuestions[0]!.supervisor_note).toBe("Catatan supervisor.");
    // Guru mengisi → tersimpan; supervisor_note tetap.
    await savePascaGuru(pool, guru1, id, { [qid]: "Refleksi saya." });
    snap2 = await loadSnapshot(pool, id);
    expect(snap2.pascaQuestions[0]!.guru_note).toBe("Refleksi saya.");
    expect(snap2.pascaQuestions[0]!.supervisor_note).toBe("Catatan supervisor.");
  });

  test("guru mendapat 403 untuk skor (service menolak)", async () => {
    const id = await createSession(pool, sup1, sessionInput(guru1.id));
    const ids = await indicatorIds(id);
    await expect(
      saveScores(pool, guru1, id, [{ indicatorId: ids[0]!, value: 4, evidence: "" }]),
    ).rejects.toThrow("Hanya supervisor");
    await expect(saveRtl(pool, guru1, id, {})).rejects.toThrow("Hanya supervisor");
  });
});

describe("bukti foto + video (lib/evidence.ts)", () => {
  test("validasi: >5 MB, mime salah, URL video http ditolak", () => {
    expect(validatePhoto({ size: 5 * 1024 * 1024 + 1, type: "image/jpeg" })).toMatch(/5 MB/);
    expect(validatePhoto({ size: 1000, type: "image/gif" })).toMatch(/JPG, PNG, atau WebP/);
    expect(validatePhoto({ size: 1000, type: "image/webp" })).toBeNull();
    expect(validateVideoUrl("http://youtube.com/x")).toMatch(/https/);
    expect(validateVideoUrl("https://youtu.be/x")).toBeNull();
    expect(validateVideoUrl("bukan-url")).toMatch(/tidak valid/);
  });

  test("maks 5 foto per sesi; hapus bukti menghapus berkas fisik", async () => {
    const id = await createSession(pool, sup1, sessionInput(guru1.id));
    const { readdir } = await import("node:fs/promises");
    const fakeJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    const stored: number[] = [];
    for (let i = 0; i < 5; i++) {
      stored.push(await storePhoto(pool, id, fakeJpeg, "image/jpeg", `Foto ${i + 1}`));
    }
    expect(await countPhotos(pool, id)).toBe(5);
    await expect(storePhoto(pool, id, fakeJpeg, "image/jpeg", "Foto ke-6")).rejects.toThrow(
      "Maksimal 5 foto",
    );
    const before = await readdir("/tmp/gezyspv-test-bukti/bukti");
    expect(before.length).toBe(5);
    const row = await getEvidence(pool, stored[0]!);
    expect(row!.kind).toBe("foto");
    expect(row!.path).toMatch(/^[0-9a-f-]+\.jpg$/);
    await deleteEvidence(pool, stored[0]!);
    expect(await countPhotos(pool, id)).toBe(4);
    const after = await readdir("/tmp/gezyspv-test-bukti/bukti");
    expect(after.length).toBe(4);
    expect(await listEvidence(pool, id)).toHaveLength(4);
  });
});

describe("HTTP: alur sesi ujung-ke-ujung", () => {
  test("buat sesi lewat form; guru yang tidak ditugaskan ditolak", async () => {
    const supCookie = await loginAs("sup_sesi_http", "rahasia123");
    const ok = await postForm(
      "/supervisi/baru",
      supCookie,
      new URLSearchParams({
        template_id: String(seedTemplateId),
        teacher_id: String(guruHttp.id),
        class_id: String(classId),
        subject_theme: "Bilangan Bulat",
        phase_semester: "Semester 1",
        observed_at: "2026-11-06",
        observed_time: "09:00",
      }),
    );
    expect(ok.status).toBe(302);
    expect(ok.location).toMatch(/^\/supervisi\/\d+\?ok=/);
    const bad = await postForm(
      "/supervisi/baru",
      supCookie,
      new URLSearchParams({
        template_id: String(seedTemplateId),
        teacher_id: String(guru1.id),
        class_id: String(classId),
        subject_theme: "X",
        phase_semester: "Semester 1",
        observed_at: "2026-11-06",
        observed_time: "09:00",
      }),
    );
    expect(bad.status).toBe(302);
    expect(bad.location).toMatch(/err=/);
  });

  test("alur penuh HTTP: pra → skor → refleksi guru → RTL → selesai", async () => {
    const supCookie = await loginAs("sup_sesi_http", "rahasia123");
    const guruCookie = await loginAs("guru_sesi_http", "rahasia123");
    const created = await postForm(
      "/supervisi/baru",
      supCookie,
      new URLSearchParams({
        template_id: String(seedTemplateId),
        teacher_id: String(guruHttp.id),
        class_id: String(classId),
        subject_theme: "Peluang",
        phase_semester: "Semester 2",
        observed_at: "2026-11-06",
        observed_time: "10:00",
      }),
    );
    const sessionId = Number(created.location!.match(/\/supervisi\/(\d+)/)![1]);
    const snap = await loadSnapshot(getPool(), sessionId);

    // Guru belum boleh isi refleksi (masih pra).
    const early = await postForm(
      `/supervisi/${sessionId}/pasca`,
      guruCookie,
      new URLSearchParams({ field: "guru", [`guru[${snap.pascaQuestions[0]!.id}]`]: "Terlalu cepat." }),
    );
    expect(early.location).toMatch(/err=/);

    // Pra → observasi.
    const praBody = new URLSearchParams({ next: "1" });
    for (const q of snap.praQuestions) praBody.set(`pra[${q.id}]`, "Jawaban pra.");
    const pra = await postForm(`/supervisi/${sessionId}/pra`, supCookie, praBody);
    expect(pra.location).toMatch(/\/observasi\?ok=/);

    // Skor semua indikator → pasca.
    const skorBody = new URLSearchParams({ next: "1" });
    for (const ind of snap.elements.flatMap((e) => e.indicators)) {
      skorBody.set(`skor[${ind.id}]`, "4");
      skorBody.set(`bukti[${ind.id}]`, "Teramati.");
    }
    const skor = await postForm(`/supervisi/${sessionId}/observasi`, supCookie, skorBody);
    expect(skor.location).toMatch(/\/pasca\?ok=/);

    // Guru isi refleksi; supervisor menambah catatan.
    const refleksi = await postForm(
      `/supervisi/${sessionId}/pasca`,
      guruCookie,
      new URLSearchParams({
        field: "guru",
        ...Object.fromEntries(snap.pascaQuestions.map((q) => [`guru[${q.id}]`, "Saya belajar…"])),
      }),
    );
    expect(refleksi.location).toMatch(/ok=/);
    const catatan = await postForm(
      `/supervisi/${sessionId}/pasca`,
      supCookie,
      new URLSearchParams({
        field: "supervisor",
        ...Object.fromEntries(snap.pascaQuestions.map((q) => [`sup[${q.id}]`, "Baik."])),
      }),
    );
    expect(catatan.location).toMatch(/ok=/);

    // Lanjut ke tindak lanjut, isi RTL, tandai selesai.
    const adv = await postForm(
      `/supervisi/${sessionId}/status`,
      supCookie,
      new URLSearchParams({ target: "tindak_lanjut" }),
    );
    expect(adv.location).toMatch(/ok=/);
    const rtlBody = new URLSearchParams({ next: "1" });
    for (const r of snap.rtlItems) rtlBody.set(`rtl[${r.id}]`, "Latihan lanjutan.");
    const rtl = await postForm(`/supervisi/${sessionId}/tindak-lanjut`, supCookie, rtlBody);
    expect(rtl.location).toMatch(new RegExp(`/supervisi/${sessionId}\\?ok=`));

    const summary = await fetch(`${base}/supervisi/${sessionId}`, { headers: { Cookie: supCookie } });
    expect(summary.status).toBe(200);
    const summaryText = await summary.text();
    expect(summaryText).toContain("Selesai");
    expect(summaryText).toContain("100.0");
    expect(summaryText).toContain("Sangat Baik");

    // Dasbor guru menandai sesi yang menunggu refleksi — sesi ini sudah selesai, jadi tidak ada.
    const dash = await fetch(`${base}/`, { headers: { Cookie: guruCookie } });
    expect(await dash.text()).not.toContain("Menunggu refleksi Anda");
  });

  test("foto: tolak >5 MB, mime salah, foto ke-6; /bukti butuh login + hak", async () => {
    const supCookie = await loginAs("sup_sesi_http", "rahasia123");
    const otherGuruCookie = await loginAs("guru_sesi1", "rahasia123");
    const created = await postForm(
      "/supervisi/baru",
      supCookie,
      new URLSearchParams({
        template_id: String(seedTemplateId),
        teacher_id: String(guruHttp.id),
        class_id: String(classId),
        subject_theme: "Foto",
        phase_semester: "Semester 1",
        observed_at: "2026-11-06",
        observed_time: "11:00",
      }),
    );
    const sessionId = Number(created.location!.match(/\/supervisi\/(\d+)/)![1]);

    const upload = async (blob: Blob, name: string) => {
      const fd = new FormData();
      fd.append("foto", blob, name);
      fd.append("caption", "Bukti");
      return fetch(`${base}/supervisi/${sessionId}/foto`, {
        method: "POST",
        headers: { Cookie: supCookie },
        body: fd,
        redirect: "manual",
      });
    };
    const small = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], "foto.jpg", { type: "image/jpeg" });
    const big = new File([new Uint8Array(6 * 1024 * 1024)], "besar.jpg", { type: "image/jpeg" });
    const wrong = new File([new Uint8Array([1, 2, 3])], "teks.txt", { type: "text/plain" });

    const tooBig = await upload(big, "besar.jpg");
    expect(tooBig.headers.get("location")).toMatch(/err=/);
    const wrongMime = await upload(wrong, "teks.txt");
    expect(wrongMime.headers.get("location")).toMatch(/err=/);

    let firstEvidenceId = 0;
    for (let i = 0; i < 5; i++) {
      const r = await upload(small, `foto${i}.jpg`);
      expect(r.headers.get("location")).toMatch(/ok=/);
    }
    const ev = await listEvidence(getPool(), sessionId);
    expect(ev.filter((e) => e.kind === "foto")).toHaveLength(5);
    firstEvidenceId = ev[0]!.id;
    const sixth = await upload(small, "foto6.jpg");
    expect(sixth.headers.get("location")).toMatch(/err=/);

    // /bukti tanpa login → dialihkan ke /login.
    const noAuth = await fetch(`${base}/bukti/${firstEvidenceId}`, { redirect: "manual" });
    expect(noAuth.status).toBe(302);
    expect(noAuth.headers.get("location")).toBe("/login");
    // Guru lain (bukan yang disupervisi) → 403.
    const forbidden = await fetch(`${base}/bukti/${firstEvidenceId}`, {
      headers: { Cookie: otherGuruCookie },
    });
    expect(forbidden.status).toBe(403);
    // Supervisor pembuat + guru yang disupervisi bisa melihat.
    const guruCookie = await loginAs("guru_sesi_http", "rahasia123");
    const okSup = await fetch(`${base}/bukti/${firstEvidenceId}`, { headers: { Cookie: supCookie } });
    expect(okSup.status).toBe(200);
    expect(okSup.headers.get("content-type")).toContain("image/jpeg");
    const okGuru = await fetch(`${base}/bukti/${firstEvidenceId}`, { headers: { Cookie: guruCookie } });
    expect(okGuru.status).toBe(200);
  });
});
