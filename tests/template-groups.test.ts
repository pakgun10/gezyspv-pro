import { afterAll, describe, expect, test } from "bun:test";
import mysql from "mysql2/promise";
import type { RowDataPacket } from "mysql2/promise";
import { ensureTestDb, closePool } from "./helpers";
import { createApp } from "../src/index";
import { hashPassword } from "../src/auth";
import { seedAll } from "../src/lib/seed";
import { configFromEnv, runMigrations } from "../src/db";
import { KURMER_VERSION_FALLBACK, resolveKurmerVersionLabel, seedKurmer } from "../src/lib/seed-kurmer";
import { KURMER_TEMPLATES } from "../src/lib/seed-kurmer-data";
import {
  addTemplateToGroup,
  canViewSessionGroup,
  createGroup,
  createGroupSession,
  deleteGroup,
  getGroup,
  listGroups,
  loadSessionGroup,
  removeTemplateFromGroup,
  reorderGroupItems,
} from "../src/lib/groups";
import {
  checkCompletion,
  createSession,
  loadSnapshot,
  savePascaGuru,
  savePascaSupervisor,
  saveRtl,
  saveScores,
  setSessionStatus,
} from "../src/lib/sessions";
import { finalScore100, predicateFor } from "../src/lib/scores";
import { createTemplate, deleteTemplate, loadTemplateDetail, scaleRange, setTemplateStatus } from "../src/lib/templates";
import type { SessionUser } from "../src/auth";

// Database khusus tes kelompok templat — terpisah dari berkas tes lain.
process.env.DB_NAME = "gezyspv_test_groups";

const pool = await ensureTestDb("gezyspv_test_groups");
await seedAll(pool, hashPassword, "admin123");
const kurmer = await seedKurmer(pool);

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
    await pool.query("DELETE FROM session_groups WHERE supervisor_id = ? OR teacher_id = ?", [uid, uid]);
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

const admin = await makeUser("admin_grp", "Admin Kelompok", "admin");
const sup1 = await makeUser("sup_grp1", "Supervisor Satu", "guru", 0, 1);
const sup2 = await makeUser("sup_grp2", "Supervisor Dua", "guru", 0, 1);
const kepsek = await makeUser("kepsek_grp", "Kepala Sekolah", "guru", 1, 1);
const guru1 = await makeUser("guru_grp1", "Guru Satu", "guru");
const guru2 = await makeUser("guru_grp2", "Guru Dua", "guru");
void admin;

await pool.query("INSERT INTO supervisor_assignments (supervisor_id, teacher_id) VALUES (?, ?)", [
  sup1.id,
  guru1.id,
]);

function groupInput(teacherId: number, groupId: number) {
  return {
    groupId,
    teacherId,
    classId,
    subject_theme: "Kurikulum Merdeka — Kelas 9",
    phase_semester: "Semester 1",
    observed_at: "2026-11-06",
    observed_time: "08:00",
  };
}

const kurmerGroupId = kurmer.groupId;
const kurmerTemplateIds = kurmer.templates.map((t) => t.id);

/** Isi satu sesi KurMer sampai siap selesai (skor 0–2). */
async function fillGroupSessionToComplete(sessionId: number, sup: SessionUser, guru: SessionUser, value = 2) {
  const snap = await loadSnapshot(pool, sessionId);
  expect(snap.praQuestions.length).toBe(0);
  await setSessionStatus(pool, sup, sessionId, "observasi");
  const ids = snap.elements.flatMap((el) => el.indicators.map((i) => i.id));
  await saveScores(
    pool,
    sup,
    sessionId,
    ids.map((id) => ({ indicatorId: id, value, evidence: "Terlihat di kelas." })),
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

async function postForm(path: string, cookie: string, fields: Record<string, string>): Promise<Response> {
  return fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cookie },
    body: new URLSearchParams(fields),
    redirect: "manual",
  });
}

async function countRows(sql: string, params: unknown[] = []): Promise<number> {
  const [rows] = await pool.query<(RowDataPacket & { c: number })[]>(sql, params);
  return rows[0]?.c ?? 0;
}

describe("Skala 2", () => {
  test("skala 2 diterima; 4/10/100 tetap jalan; skala lain ditolak", async () => {
    const id2 = await createTemplate(pool, {
      title: `Skala 2 ${Date.now()}`,
      basis: "Tes",
      version_label: "2099",
      score_scale: 2,
    });
    const t2 = await loadTemplateDetail(pool, id2);
    expect(t2.template.score_scale).toBe(2);
    for (const scale of [4, 10, 100] as const) {
      const id = await createTemplate(pool, {
        title: `Skala ${scale} ${Date.now()}-${scale}`,
        basis: "Tes",
        version_label: "2099",
        score_scale: scale,
      });
      expect((await loadTemplateDetail(pool, id)).template.score_scale).toBe(scale);
    }
    await expect(
      createTemplate(pool, { title: `Skala 3 ${Date.now()}`, basis: "Tes", version_label: "2099", score_scale: 3 as never }),
    ).rejects.toThrow();
    // CHECK database juga menolak skala 3 lewat SQL mentah.
    await expect(
      pool.query(
        "INSERT INTO templates (title, basis, version_label, score_scale, status, is_seed) VALUES (?, 'Tes', '2099', 3, 'draf', 0)",
        [`Skala 3 SQL ${Date.now()}`],
      ),
    ).rejects.toThrow();
  });

  test("scaleRange skala 2 membolehkan 0; finalScore100 sama dengan rumus dokumen", () => {
    expect(scaleRange(2)).toEqual({ min: 0, max: 2 });
    expect(scaleRange(4)).toEqual({ min: 1, max: 4 });
    expect(scaleRange(100)).toEqual({ min: 0, max: 100 });
    const levels = [{ v: 0 }, { v: 1 }, { v: 2 }];
    const ind = (value: number | null) => ({ value, element_code: "A", element_title: "Administrasi" });
    // rata-rata 1 dari skala 2 → 50/100 (Skor/Skor Maksimal × 100%).
    expect(finalScore100([ind(0), ind(1), ind(2)], levels)).toBe(50);
    expect(finalScore100([ind(2), ind(2)], levels)).toBe(100);
    expect(finalScore100([ind(0), ind(0)], levels)).toBe(0);
    // Rata-rata hanya dari yang terisi; null hanya bila belum ada skor.
    expect(finalScore100([ind(2), ind(null)], levels)).toBe(100);
    expect(finalScore100([ind(null), ind(null)], levels)).toBeNull();
  });
});

describe("Migrasi 003", () => {
  test("idempotent: jalan kedua tidak menerapkan apa pun; tabel kelompok ada", async () => {
    const config = { ...configFromEnv(), database: "gezyspv_test_groups" };
    const applied = await runMigrations(config);
    expect(applied).toEqual([]);
    expect(await countRows("SELECT COUNT(*) AS c FROM template_groups")).toBeGreaterThanOrEqual(1);
    const [cols] = await pool.query<(RowDataPacket & { COLUMN_NAME: string })[]>(
      "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'sessions' AND COLUMN_NAME = 'session_group_id'",
      ["gezyspv_test_groups"],
    );
    expect(cols.length).toBe(1);
  });
});

describe("Seed Kurikulum Merdeka", () => {
  test("4 templat + 1 kelompok; hitungan indikator 12/12/24/38; predikat dokumen; label generik + version_label periode aktif", async () => {
    expect(kurmer.templates.map((t) => t.indicators)).toEqual([12, 12, 24, 38]);
    const g = await getGroup(pool, kurmerGroupId);
    expect(g!.title).toBe("Instrumen Supervisi Kurikulum Merdeka");
    expect(g!.items.map((it) => it.template_id)).toEqual(kurmerTemplateIds);
    for (const t of kurmer.templates) {
      const detail = await loadTemplateDetail(pool, t.id);
      expect(KURMER_TEMPLATES.some((k) => k.title === t.title)).toBe(true);
      expect(detail.template.score_scale).toBe(2);
      expect(detail.template.basis).toBe("Kurikulum Merdeka");
      // seedAll berjalan dulu dan membuat periode aktif "2026/2027 Ganjil",
      // jadi version_label mengikuti nama periode aktif itu (bukan hardcode).
      expect(detail.template.version_label).toBe("2026/2027 Ganjil");
      expect(detail.principles.length).toBe(0);
      expect(detail.praQuestions.length).toBe(0);
      expect(detail.pascaQuestions.length).toBe(1);
      expect(detail.pascaQuestions[0]!.text).toBe("Apa tanggapan dan refleksi Anda atas hasil supervisi ini?");
      expect(detail.rtlItems.map((r) => r.title)).toEqual(["Catatan", "Tindak Lanjut"]);
      expect(detail.predicates.map((p) => [p.min, p.max, p.label])).toEqual([
        [91, 100, "Sangat Baik"],
        [81, 90, "Baik"],
        [71, 80, "Cukup"],
        [0, 70, "Kurang"],
      ]);
      // Label skala GENERIK (disetujui Pak Gun 2026-11-06) untuk keempat templat.
      expect(detail.scaleLevels.map((l) => [l.v, l.label])).toEqual([
        [0, "Tidak Ada / Tidak Sesuai"],
        [1, "Kurang Lengkap / Sesuai Sebagian"],
        [2, "Lengkap / Sesuai"],
      ]);
    }
    // Teks dari berkas seed paralel (ejaan tanpa spasi dinormalisasi;
    // huruf sub-poin IV tidak dicantumkan, awalan sub-bagian yang dipakai).
    const [i1] = await pool.query<(RowDataPacket & { text: string })[]>(
      `SELECT ti.text FROM template_indicators ti
       JOIN template_elements te ON te.id = ti.element_id
       WHERE te.template_id = ? ORDER BY te.sort, ti.sort LIMIT 1`,
      [kurmerTemplateIds[0]],
    );
    expect(i1[0]!.text).toBe("Kalender Pendidikan");
    const [iii13] = await pool.query<(RowDataPacket & { text: string })[]>(
      `SELECT ti.text FROM template_indicators ti
       JOIN template_elements te ON te.id = ti.element_id
       WHERE te.template_id = ? ORDER BY te.sort, ti.sort LIMIT 12, 1`,
      [kurmerTemplateIds[2]],
    );
    expect(iii13[0]!.text).toContain("(a) Memfasilitasi kegiatan siswa");
    expect(iii13[0]!.text).toContain("data atau");
    expect(iii13[0]!.text).not.toContain("dataatau");
    // Sub-bagian IV B dibedakan (bukan satu awalan untuk semuanya).
    const [hots] = await pool.query<(RowDataPacket & { text: string })[]>(
      `SELECT ti.text FROM template_indicators ti
       JOIN template_elements te ON te.id = ti.element_id
       WHERE te.template_id = ? AND ti.text LIKE 'Aktivitas Pembelajaran HOTS%'`,
      [kurmerTemplateIds[3]],
    );
    expect(hots.length).toBe(4);
    // Artefak footer docx IV tidak ikut menjadi indikator.
    const [ivLast] = await pool.query<(RowDataPacket & { text: string })[]>(
      `SELECT ti.text FROM template_indicators ti
       JOIN template_elements te ON te.id = ti.element_id
       WHERE te.template_id = ? ORDER BY te.sort DESC, ti.sort DESC LIMIT 1`,
      [kurmerTemplateIds[3]],
    );
    expect(ivLast[0]!.text).not.toContain("Jumlah Skor");
  });

  test("seed kedua tidak menduplikasi (idempotent)", async () => {
    const again = await seedKurmer(pool);
    expect(again.groupId).toBe(kurmerGroupId);
    expect(again.groupCreated).toBe(false);
    expect(again.templates.every((t) => t.created === false)).toBe(true);
    expect(await countRows("SELECT COUNT(*) AS c FROM template_groups WHERE title = 'Instrumen Supervisi Kurikulum Merdeka'")).toBe(1);
    expect(await countRows("SELECT COUNT(*) AS c FROM templates WHERE is_seed = 1 AND score_scale = 2")).toBe(4);
    // Templat PPB/GM tidak berubah: tetap 1, 11 indikator.
    expect(await countRows("SELECT COUNT(*) AS c FROM templates WHERE title = 'Supervisi Akademik PPB/GM 2026/2027'")).toBe(1);
  });
});

describe("version_label KurMer (dari periode aktif)", () => {
  test("resolver: periode aktif -> namanya; tanpa periode aktif -> fallback", async () => {
    expect(await resolveKurmerVersionLabel(pool)).toBe("2026/2027 Ganjil");
    expect(KURMER_VERSION_FALLBACK).toBe("2026/2027");
    await pool.query("UPDATE periods SET is_active = 0");
    try {
      expect(await resolveKurmerVersionLabel(pool)).toBe("2026/2027");
    } finally {
      await pool.query("UPDATE periods SET is_active = 1 WHERE name = '2026/2027 Ganjil'");
    }
    expect(await resolveKurmerVersionLabel(pool)).toBe("2026/2027 Ganjil");
  });
});

describe("Kelola kelompok (admin service)", () => {
  test("buat kelompok, tambah/hapus templat, urutan, hapus kelompok", async () => {
    const gid = await createGroup(pool, `Kelompok Tes ${Date.now()}`, "uji");
    const a = await createTemplate(pool, { title: `A ${Date.now()}`, basis: "Tes", version_label: "2099", score_scale: 4 });
    const b = await createTemplate(pool, { title: `B ${Date.now()}`, basis: "Tes", version_label: "2099", score_scale: 4 });
    await setTemplateStatus(pool, a, "aktif");
    await setTemplateStatus(pool, b, "aktif");
    await addTemplateToGroup(pool, gid, a);
    await addTemplateToGroup(pool, gid, b);
    expect((await getGroup(pool, gid))!.items.map((it) => it.template_id)).toEqual([a, b]);
    await reorderGroupItems(pool, gid, [b, a]);
    expect((await getGroup(pool, gid))!.items.map((it) => it.template_id)).toEqual([b, a]);
    await removeTemplateFromGroup(pool, gid, b);
    expect((await getGroup(pool, gid))!.items.map((it) => it.template_id)).toEqual([a]);
    // Templat draf tidak bisa masuk kelompok.
    const draf = await createTemplate(pool, { title: `Draf ${Date.now()}`, basis: "Tes", version_label: "2099", score_scale: 4 });
    await expect(addTemplateToGroup(pool, gid, draf)).rejects.toThrow("draf");
    // Templat yang sudah di kelompok lain tidak bisa masuk kelompok kedua.
    const gid2 = await createGroup(pool, `Kelompok Tes 2 ${Date.now()}`, "");
    await expect(addTemplateToGroup(pool, gid2, a)).rejects.toThrow("sudah ada di kelompok");
    await deleteGroup(pool, gid2);
    expect(await getGroup(pool, gid2)).toBeNull();
    await deleteGroup(pool, gid);
    expect(await getGroup(pool, gid)).toBeNull();
  });

  test("templat di dalam kelompok tidak bisa dihapus", async () => {
    // Templat seed KurMer: pesan menyebut kelompok (bukan seed).
    await expect(deleteTemplate(pool, kurmerTemplateIds[0]!)).rejects.toThrow("kelompok");
    // Templat biasa di kelompok: sama; setelah dikeluarkan, bisa dihapus.
    const gid = await createGroup(pool, `Kelompok Hapus ${Date.now()}`, "");
    const t = await createTemplate(pool, { title: `Hapus ${Date.now()}`, basis: "Tes", version_label: "2099", score_scale: 4 });
    await setTemplateStatus(pool, t, "aktif");
    await addTemplateToGroup(pool, gid, t);
    await expect(deleteTemplate(pool, t)).rejects.toThrow("kelompok");
    await removeTemplateFromGroup(pool, gid, t);
    await deleteTemplate(pool, t);
    expect(await loadTemplateDetail(pool, t).catch(() => null)).toBeNull();
    await deleteGroup(pool, gid);
  });
});

describe("Supervisi berkelompok", () => {
  test("membuat 1 grup + 4 sesi dengan snapshot benar", async () => {
    const before = await countRows("SELECT COUNT(*) AS c FROM session_groups");
    const gid = await createGroupSession(pool, sup1, groupInput(guru1.id, kurmerGroupId));
    expect(await countRows("SELECT COUNT(*) AS c FROM session_groups")).toBe(before + 1);
    const sg = await loadSessionGroup(pool, gid);
    expect(sg!.group_id).toBe(kurmerGroupId);
    expect(sg!.supervisor_id).toBe(sup1.id);
    expect(sg!.teacher_id).toBe(guru1.id);
    const [sessions] = await pool.query<(RowDataPacket & { id: number; template_id: number; session_group_id: number; status: string })[]>(
      "SELECT id, template_id, session_group_id, status FROM sessions WHERE session_group_id = ? ORDER BY template_id",
      [gid],
    );
    expect(sessions.length).toBe(4);
    expect(sessions.map((s) => s.template_id).sort((x, y) => x - y)).toEqual([...kurmerTemplateIds].sort((x, y) => x - y));
    expect(sessions.every((s) => s.status === "pra")).toBe(true);
    for (const s of sessions) {
      const snap = await loadSnapshot(pool, s.id);
      const total = snap.elements.reduce((n, el) => n + el.indicators.length, 0);
      expect([12, 12, 24, 38]).toContain(total);
      expect(snap.praQuestions.length).toBe(0);
      expect(snap.principles.length).toBe(0);
    }
  });

  test("penugasan ditegakkan; supervisi diri ditolak; Kepsek bebas", async () => {
    await expect(createGroupSession(pool, sup1, groupInput(guru2.id, kurmerGroupId))).rejects.toThrow("tidak ditugaskan");
    await expect(createGroupSession(pool, sup1, groupInput(sup1.id, kurmerGroupId))).rejects.toThrow("diri sendiri");
    await expect(createGroupSession(pool, guru1, groupInput(guru2.id, kurmerGroupId))).rejects.toThrow("Hanya supervisor");
    const gid = await createGroupSession(pool, kepsek, groupInput(guru2.id, kurmerGroupId));
    expect((await loadSessionGroup(pool, gid))!.teacher_id).toBe(guru2.id);
  });

  test("templat non-aktif di kelompok menggagalkan pembuatan grup (menyebut nama)", async () => {
    const gid = await createGroup(pool, `Kelompok Rusak ${Date.now()}`, "");
    const a = await createTemplate(pool, { title: `Aktif Rusak ${Date.now()}`, basis: "Tes", version_label: "2099", score_scale: 4 });
    await setTemplateStatus(pool, a, "aktif");
    await addTemplateToGroup(pool, gid, a);
    await setTemplateStatus(pool, a, "arsip");
    const before = await countRows("SELECT COUNT(*) AS c FROM session_groups");
    await expect(createGroupSession(pool, sup1, groupInput(guru1.id, gid))).rejects.toThrow(`Aktif Rusak`);
    expect(await countRows("SELECT COUNT(*) AS c FROM session_groups")).toBe(before);
    expect(await countRows("SELECT COUNT(*) AS c FROM sessions WHERE session_group_id IN (SELECT id FROM session_groups WHERE group_id = ?)", [gid])).toBe(0);
  });

  test("sesi 0 pra bisa maju ke observasi; selesai hanya bila lengkap; Nilai Akhir + predikat benar", async () => {
    const gid = await createGroupSession(pool, sup1, groupInput(guru1.id, kurmerGroupId));
    const [sessions] = await pool.query<(RowDataPacket & { id: number; template_id: number })[]>(
      "SELECT id, template_id FROM sessions WHERE session_group_id = ? ORDER BY id",
      [gid],
    );
    const [first, second] = sessions as { id: number; template_id: number }[];
    // Belum lengkap → tidak bisa selesai.
    await expect(setSessionStatus(pool, sup1, first!.id, "selesai")).rejects.toThrow();
    expect((await checkCompletion(pool, first!.id)).complete).toBe(false);
    // 0 pra: langsung maju ke observasi.
    await setSessionStatus(pool, sup1, first!.id, "observasi");
    // Isi semua dengan 2 → Nilai Akhir 100, predikat Sangat Baik.
    await fillGroupSessionToComplete(first!.id, sup1, guru1, 2);
    expect((await checkCompletion(pool, first!.id)).complete).toBe(true);
    await setSessionStatus(pool, sup1, first!.id, "selesai");
    const snap = await loadSnapshot(pool, first!.id);
    const flat = snap.elements.flatMap((el) => el.indicators);
    const final = finalScore100(flat, snap.scaleLevels);
    expect(final).toBe(100);
    expect(predicateFor(final, snap.predicates)).toBe("Sangat Baik");
    // Isi semua dengan 1 → Nilai Akhir 50, predikat Kurang (0–70).
    await fillGroupSessionToComplete(second!.id, sup1, guru1, 1);
    await setSessionStatus(pool, sup1, second!.id, "selesai");
    const snap2 = await loadSnapshot(pool, second!.id);
    const flat2 = snap2.elements.flatMap((el) => el.indicators);
    const final2 = finalScore100(flat2, snap2.scaleLevels);
    expect(final2).toBe(50);
    expect(predicateFor(final2, snap2.predicates)).toBe("Kurang");
  });

  test("hak lihat kelompok: supervisor lain 403, pembuat/guru/admin/Kepsek boleh", async () => {
    const gid = await createGroupSession(pool, sup1, groupInput(guru1.id, kurmerGroupId));
    const sg = (await loadSessionGroup(pool, gid))!;
    expect(canViewSessionGroup(sup1, sg)).toBe(true);
    expect(canViewSessionGroup(guru1, sg)).toBe(true);
    expect(canViewSessionGroup(admin, sg)).toBe(true);
    expect(canViewSessionGroup(kepsek, sg)).toBe(true);
    expect(canViewSessionGroup(sup2, sg)).toBe(false);
    expect(canViewSessionGroup(guru2, sg)).toBe(false);
  });

  test("kelompok yang sudah dipakai tidak bisa dihapus", async () => {
    const gid = await createGroupSession(pool, sup1, groupInput(guru1.id, kurmerGroupId));
    const sg = (await loadSessionGroup(pool, gid))!;
    await expect(deleteGroup(pool, sg.group_id)).rejects.toThrow("sudah dipakai");
  });
});

describe("Supervisi berkelompok via HTTP", () => {
  test("admin: daftar + buat kelompok; supervisor: buat grup + ringkasan; supervisor lain 403", async () => {
    const adminCookie = await loginAs("admin_grp", "rahasia123");
    const listRes = await fetch(`${base}/admin/kelompok`, { headers: { Cookie: adminCookie } });
    expect(listRes.status).toBe(200);
    expect(await listRes.text()).toContain("Instrumen Supervisi Kurikulum Merdeka");

    const supCookie = await loginAs("sup_grp1", "rahasia123");
    const formRes = await fetch(`${base}/supervisi/kelompok/baru`, { headers: { Cookie: supCookie } });
    expect(formRes.status).toBe(200);
    expect(await formRes.text()).toContain("Instrumen Supervisi Kurikulum Merdeka");

    const createRes = await postForm("/supervisi/kelompok/baru", supCookie, {
      group_id: String(kurmerGroupId),
      teacher_id: String(guru1.id),
      class_id: String(classId),
      subject_theme: "Kurikulum Merdeka — HTTP",
      phase_semester: "Semester 1",
      observed_at: "2026-11-06",
      observed_time: "08:00",
    });
    expect(createRes.status).toBe(302);
    const loc = createRes.headers.get("location") ?? "";
    expect(loc).toMatch(/^\/supervisi\/kelompok\/\d+/);
    const summaryRes = await fetch(`${base}${loc.split("?")[0]!}`, { headers: { Cookie: supCookie } });
    expect(summaryRes.status).toBe(200);
    const summaryHtml = await summaryRes.text();
    expect(summaryHtml).toContain("Instrumen Supervisi Kurikulum Merdeka");
    expect(summaryHtml).toContain("Nilai Akhir");

    const sup2Cookie = await loginAs("sup_grp2", "rahasia123");
    const forbidden = await fetch(`${base}${loc.split("?")[0]!}`, { headers: { Cookie: sup2Cookie } });
    expect(forbidden.status).toBe(403);

    // Guru yang disupervisi boleh melihat ringkasannya.
    const guruCookie = await loginAs("guru_grp1", "rahasia123");
    const guruRes = await fetch(`${base}${loc.split("?")[0]!}`, { headers: { Cookie: guruCookie } });
    expect(guruRes.status).toBe(200);
  });

  test("sesi tunggal lama tetap jalan (regresi): templat PPB/GM skala 4", async () => {
    const [tpl] = await pool.query<(RowDataPacket & { id: number })[]>(
      "SELECT id FROM templates WHERE title = 'Supervisi Akademik PPB/GM 2026/2027'",
    );
    const id = await createSession(pool, sup1, {
      templateId: tpl[0]!.id,
      teacherId: guru1.id,
      classId,
      subject_theme: "Regresi",
      phase_semester: "Semester 1",
      observed_at: "2026-11-06",
      observed_time: "08:00",
    });
    const snap = await loadSnapshot(pool, id);
    expect(snap.elements.reduce((n, el) => n + el.indicators.length, 0)).toBe(11);
    expect(snap.praQuestions.length).toBe(5);
    expect(snap.scaleLevels.map((l) => l.v)).toEqual([1, 2, 3, 4]);
  });
});
