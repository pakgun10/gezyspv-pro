import { afterAll, describe, expect, test } from "bun:test";
import { ensureTestDb, closePool } from "./helpers";
import { createApp } from "../src/index";
import { hashPassword } from "../src/auth";
import { seedAll } from "../src/lib/seed";
import {
  addElement,
  addIndicator,
  addPredicate,
  addPrinciple,
  addQuestion,
  addRtlItem,
  addScaleLevel,
  copyTemplate,
  createTemplate,
  deleteElement,
  deleteTemplate,
  loadTemplateDetail,
  replacePredicates,
  setTemplateStatus,
  updateIndicator,
  updatePredicate,
  updateTemplateMeta,
  validatePredicates,
} from "../src/lib/templates";
import { snapshotTemplateForSession } from "../src/lib/snapshot";
import type { RowDataPacket } from "mysql2/promise";

// Database khusus tes templat — terpisah dari berkas tes lain.
process.env.DB_NAME = "gezyspv_test_templates";
const pool = await ensureTestDb("gezyspv_test_templates");
await seedAll(pool, hashPassword, "admin123");

async function makeUser(
  username: string,
  name: string,
  role: "admin" | "guru" = "guru",
  isPrincipal = 0,
  isSupervisorFlag = 0,
): Promise<number> {
  // Bersihkan sisa run sebelumnya: sesi dan penugasan mereferensi user (FK).
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
    await pool.query("DELETE FROM users WHERE id = ?", [uid]);
  }
  const [res] = await pool.query(
    "INSERT INTO users (username, name, password_hash, role, is_supervisor, is_principal, must_change_password) VALUES (?, ?, ?, ?, ?, ?, 0)",
    [username, name, await hashPassword("rahasia123"), role, isSupervisorFlag, isPrincipal],
  );
  return (res as { insertId: number }).insertId;
}

const adminId = await makeUser("admin2", "Admin Tes", "admin");
const supId = await makeUser("sup1", "Supervisor Tes", "guru", 0, 1);
const guruId = await makeUser("guru1", "Guru Tes", "guru");
void adminId;
void supId;

const [seedRows] = await pool.query<(RowDataPacket & { id: number })[]>(
  "SELECT id FROM templates WHERE is_seed = 1",
);
const seedId = seedRows[0]!.id;

async function makeTemplate(scale: 4 | 10 | 100 = 4): Promise<number> {
  return createTemplate(pool, {
    title: `Templat Tes ${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    basis: "Tes",
    version_label: "2099",
    score_scale: scale,
  });
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

async function postForm(
  path: string,
  cookie: string,
  fields: Record<string, string>,
): Promise<Response> {
  return fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cookie },
    body: new URLSearchParams(fields),
    redirect: "manual",
  });
}

describe("Templat: service CRUD + validasi", () => {
  test("templat baru berstatus draf; judul kosong dan skala salah ditolak", async () => {
    const id = await makeTemplate();
    const detail = await loadTemplateDetail(pool, id);
    expect(detail.template.status).toBe("draf");
    expect(detail.template.score_scale).toBe(4);
    await expect(createTemplate(pool, { title: "  ", score_scale: 4 })).rejects.toThrow(
      "Judul templat wajib diisi",
    );
    await expect(
      createTemplate(pool, { title: "X", score_scale: 5 as never }),
    ).rejects.toThrow("Skala penilaian harus 2, 4, 10, atau 100");
  });

  test("CRUD anak: elemen, indikator, prinsip, pertanyaan, RTL, label skala", async () => {
    const id = await makeTemplate();
    const elId = await addElement(pool, id, "A", "Elemen A");
    await expect(addElement(pool, id, "A", "Duplikat")).rejects.toThrow("Kode elemen sudah dipakai");
    const indId = await addIndicator(pool, elId, "Indikator satu");
    await addIndicator(pool, elId, "Indikator dua");
    await addPrinciple(pool, id, "Prinsip satu");
    await addQuestion(pool, id, "pra", "Pertanyaan pra satu");
    await addQuestion(pool, id, "pasca", "Pertanyaan pasca satu");
    await addRtlItem(pool, id, "RTL satu");
    const lvId = await addScaleLevel(pool, id, 1, "Belum");
    await expect(addScaleLevel(pool, id, 1, "Duplikat")).rejects.toThrow("Nilai skala 1 sudah ada");
    await expect(addScaleLevel(pool, id, 5, "Di luar")).rejects.toThrow("tidak valid untuk skala 4");
    await expect(addScaleLevel(pool, id, 0, "Nol")).rejects.toThrow("tidak valid untuk skala 4");

    let d = await loadTemplateDetail(pool, id);
    expect(d.elements.length).toBe(1);
    expect(d.elements[0]!.indicators.length).toBe(2);
    expect(d.principles.length).toBe(1);
    expect(d.praQuestions.length).toBe(1);
    expect(d.pascaQuestions.length).toBe(1);
    expect(d.rtlItems.length).toBe(1);
    expect(d.scaleLevels.length).toBe(1);

    // Hapus elemen ikut menghapus indikatornya (FK cascade).
    await deleteElement(pool, elId);
    d = await loadTemplateDetail(pool, id);
    expect(d.elements.length).toBe(0);
    expect(d.elements.reduce((n, e) => n + e.indicators.length, 0)).toBe(0);
    // Indikator yang sudah terhapus tidak bisa diubah.
    await expect(updateIndicator(pool, indId, "x")).rejects.toThrow("tidak ditemukan");
    void lvId;
  });

  test("skala 100 membolehkan nilai 0; ubah skala ditolak bila label di luar rentang", async () => {
    const id = await makeTemplate(10);
    await addScaleLevel(pool, id, 10, "Sepuluh");
    await expect(updateTemplateMeta(pool, id, { score_scale: 4 })).rejects.toThrow(
      "di luar rentang",
    );
    const id100 = await makeTemplate(100);
    await addScaleLevel(pool, id100, 0, "Nol");
    await addScaleLevel(pool, id100, 100, "Seratus");
    await expect(addScaleLevel(pool, id100, 101, "Lebih")).rejects.toThrow("tidak valid");
  });

  test("aturan status: hanya transisi eksplisit yang diizinkan", async () => {
    const id = await makeTemplate();
    await setTemplateStatus(pool, id, "aktif");
    let d = await loadTemplateDetail(pool, id);
    expect(d.template.status).toBe("aktif");
    await expect(setTemplateStatus(pool, id, "draf")).rejects.toThrow("tidak bisa diubah");
    await setTemplateStatus(pool, id, "arsip");
    d = await loadTemplateDetail(pool, id);
    expect(d.template.status).toBe("arsip");
    await expect(setTemplateStatus(pool, id, "aktif")).rejects.toThrow("tidak bisa diubah");
    await setTemplateStatus(pool, id, "draf");
    d = await loadTemplateDetail(pool, id);
    expect(d.template.status).toBe("draf");
  });

  test("templat arsip tidak bisa diedit", async () => {
    const id = await makeTemplate();
    await addPrinciple(pool, id, "Akan diarsipkan");
    await setTemplateStatus(pool, id, "arsip");
    await expect(updateTemplateMeta(pool, id, { title: "Baru" })).rejects.toThrow(
      "Templat arsip tidak bisa diubah",
    );
    await expect(addPrinciple(pool, id, "Tidak boleh")).rejects.toThrow(
      "Templat arsip tidak bisa diubah",
    );
  });

  test("validasi predikat: tumpang tindih dan rentang salah ditolak", () => {
    expect(validatePredicates([{ min: 90, max: 100, label: "A" }, { min: 95, max: 99, label: "B" }])).toMatch(
      /tumpang tindih/,
    );
    expect(validatePredicates([{ min: 80, max: 70, label: "A" }])).toMatch(/tidak valid/);
    expect(validatePredicates([{ min: -1, max: 50, label: "A" }])).toMatch(/tidak valid/);
    expect(validatePredicates([{ min: 0, max: 59, label: "A" }, { min: 60, max: 100, label: "B" }])).toBeNull();
    // Batas bersentuhan (59 dan 60) bukan tumpang tindih; batas sama (59 dan 59) tumpang tindih.
    expect(validatePredicates([{ min: 0, max: 59, label: "A" }, { min: 59, max: 100, label: "B" }])).toMatch(
      /tumpang tindih/,
    );
  });

  test("predikat: tambah/ubah tumpang tindih ditolak, data lama utuh", async () => {
    const id = await makeTemplate();
    const p1 = await addPredicate(pool, id, { min: 90, max: 100, label: "Sangat Baik" });
    await expect(addPredicate(pool, id, { min: 95, max: 100, label: "Tabrakan" })).rejects.toThrow(
      /tumpang tindih/,
    );
    await addPredicate(pool, id, { min: 0, max: 89, label: "Lainnya" });
    await expect(updatePredicate(pool, p1, { min: 50, max: 100, label: "Tabrakan" })).rejects.toThrow(
      /tumpang tindih/,
    );
    const d = await loadTemplateDetail(pool, id);
    expect(d.predicates.length).toBe(2);
    expect(d.predicates.find((p) => p.id === p1)?.min).toBe(90);
    await expect(
      replacePredicates(pool, id, [
        { min: 0, max: 60, label: "A" },
        { min: 50, max: 100, label: "B" },
      ]),
    ).rejects.toThrow(/tumpang tindih/);
    const d2 = await loadTemplateDetail(pool, id);
    expect(d2.predicates.length).toBe(2);
  });
});

describe("Templat: salin dan hapus", () => {
  test("salin templat seed lengkap menjadi draf baru", async () => {
    const newId = await copyTemplate(pool, seedId);
    const d = await loadTemplateDetail(pool, newId);
    expect(d.template.status).toBe("draf");
    expect(d.template.is_seed).toBe(0);
    expect(d.template.title).toBe("Supervisi Akademik PPB/GM 2026/2027 (Salinan)");
    expect(d.template.score_scale).toBe(4);
    expect(d.principles.length).toBe(3);
    expect(d.elements.length).toBe(4);
    expect(d.elements.reduce((n, e) => n + e.indicators.length, 0)).toBe(11);
    expect(d.scaleLevels.length).toBe(4);
    expect(d.praQuestions.length).toBe(5);
    expect(d.pascaQuestions.length).toBe(5);
    expect(d.rtlItems.length).toBe(3);
    expect(d.predicates.length).toBe(5);
    // Salinan punya id anak sendiri, bukan id seed.
    const seed = await loadTemplateDetail(pool, seedId);
    expect(d.elements[0]!.id).not.toBe(seed.elements[0]!.id);
    expect(d.elements[0]!.indicators[0]!.id).not.toBe(seed.elements[0]!.indicators[0]!.id);
    // Mengubah salinan tidak mengubah seed.
    await updateIndicator(pool, d.elements[0]!.indicators[0]!.id, "Diubah di salinan");
    const seedAfter = await loadTemplateDetail(pool, seedId);
    expect(seedAfter.elements[0]!.indicators[0]!.text).not.toContain("Diubah di salinan");
  });

  test("templat seed tidak boleh dihapus; templat belum dipakai boleh dihapus", async () => {
    await expect(deleteTemplate(pool, seedId)).rejects.toThrow("tidak boleh dihapus");
    const id = await makeTemplate();
    await deleteTemplate(pool, id);
    await expect(loadTemplateDetail(pool, id)).rejects.toThrow("tidak ditemukan");
  });

  test("templat yang sudah dipakai sesi tidak boleh dihapus", async () => {
    const templateId = await makeTemplate();
    const [periods] = await pool.query<(RowDataPacket & { id: number })[]>(
      "SELECT id FROM periods WHERE is_active = 1",
    );
    const periodId = periods[0]!.id;
    const [cls] = await pool.query(
      "INSERT INTO classes (period_id, name) VALUES (?, ?)",
      [periodId, `7.1-${Math.random().toString(36).slice(2, 6)}`],
    );
    const classId = (cls as { insertId: number }).insertId;
    await pool.query(
      `INSERT INTO sessions (template_id, supervisor_id, teacher_id, class_id, period_id, observed_at)
       VALUES (?, ?, ?, ?, ?, '2026-11-05')`,
      [templateId, supId, guruId, classId, periodId],
    );
    await expect(deleteTemplate(pool, templateId)).rejects.toThrow("tidak boleh dihapus");
    const d = await loadTemplateDetail(pool, templateId);
    expect(d.usedBySessions).toBe(1);
  });
});

describe("Snapshot: tidak berubah setelah templat diedit", () => {
  test("snapshot menyalin isi templat dan kebal terhadap edit templat", async () => {
    const templateId = await copyTemplate(pool, seedId);
    const [periods] = await pool.query<(RowDataPacket & { id: number })[]>(
      "SELECT id FROM periods WHERE is_active = 1",
    );
    const periodId = periods[0]!.id;
    const [cls] = await pool.query(
      "INSERT INTO classes (period_id, name) VALUES (?, ?)",
      [periodId, `8.2-${Math.random().toString(36).slice(2, 6)}`],
    );
    const classId = (cls as { insertId: number }).insertId;
    const [ses] = await pool.query(
      `INSERT INTO sessions (template_id, supervisor_id, teacher_id, class_id, period_id, observed_at)
       VALUES (?, ?, ?, ?, ?, '2026-11-06')`,
      [templateId, supId, guruId, classId, periodId],
    );
    const sessionId = (ses as { insertId: number }).insertId;

    const counts = await snapshotTemplateForSession(pool, sessionId);
    expect(counts).toEqual({
      principles: 3,
      indicators: 11,
      scaleLevels: 4,
      questions: 10,
      predicates: 5,
      rtlItems: 3,
    });

    // Snapshot ulang (tanpa edit templat) tetap idempotent — tidak menggandakan.
    const counts2 = await snapshotTemplateForSession(pool, sessionId);
    expect(counts2).toEqual(counts);
    const [indCount] = await pool.query<(RowDataPacket & { c: number })[]>(
      "SELECT COUNT(*) AS c FROM session_indicators WHERE session_id = ?",
      [sessionId],
    );
    expect(indCount[0]!.c).toBe(11);

    const [beforeInd] = await pool.query<(RowDataPacket & { text: string })[]>(
      "SELECT text FROM session_indicators WHERE session_id = ? ORDER BY id LIMIT 1",
      [sessionId],
    );
    const [beforePred] = await pool.query<(RowDataPacket & { label: string })[]>(
      "SELECT label FROM session_predicates WHERE session_id = ? ORDER BY sort LIMIT 1",
      [sessionId],
    );

    // Edit templat besar-besaran SETELAH snapshot dibuat.
    const detail = await loadTemplateDetail(pool, templateId);
    await updateIndicator(pool, detail.elements[0]!.indicators[0]!.id, "TEKS BARU SETELAH SNAPSHOT");
    await addPrinciple(pool, templateId, "Prinsip tambahan setelah snapshot");
    const predId = detail.predicates[0]!.id;
    await updatePredicate(pool, predId, { min: 90, max: 100, label: "LUAR BIASA" });
    await updateTemplateMeta(pool, templateId, { title: "Judul Diubah Setelah Snapshot" });

    // Snapshot tidak berubah.
    const [afterInd] = await pool.query<(RowDataPacket & { text: string })[]>(
      "SELECT text FROM session_indicators WHERE session_id = ? ORDER BY id LIMIT 1",
      [sessionId],
    );
    expect(afterInd[0]!.text).toBe(beforeInd[0]!.text);
    expect(afterInd[0]!.text).not.toContain("TEKS BARU");
    const [afterPrin] = await pool.query<(RowDataPacket & { c: number })[]>(
      "SELECT COUNT(*) AS c FROM session_principles WHERE session_id = ?",
      [sessionId],
    );
    expect(afterPrin[0]!.c).toBe(3);
    const [afterPred] = await pool.query<(RowDataPacket & { label: string })[]>(
      "SELECT label FROM session_predicates WHERE session_id = ? ORDER BY sort LIMIT 1",
      [sessionId],
    );
    expect(afterPred[0]!.label).toBe(beforePred[0]!.label);
  });
});

describe("Templat: HTTP + RBAC", () => {
  test("admin bisa membuat templat lewat form; daftar memuat templat seed", async () => {
    const adminCookie = await loginAs("admin2", "rahasia123");
    const list = await fetch(`${base}/admin/templat`, { headers: { Cookie: adminCookie } });
    expect(list.status).toBe(200);
    const listText = await list.text();
    expect(listText).toContain("Supervisi Akademik PPB/GM 2026/2027");
    expect(listText).toContain("Buat templat baru");
    // Templat seed aktif → tombol Arsipkan tampil di daftar.
    expect(listText).toContain("Arsipkan");
    expect(listText).toContain("Salin untuk tahun ajaran baru");

    const created = await postForm("/admin/templat", adminCookie, {
      title: "Templat HTTP Tes",
      basis: "Tes HTTP",
      version_label: "2099",
      score_scale: "10",
    });
    expect(created.status).toBe(302);
    const loc = created.headers.get("location") ?? "";
    expect(loc).toMatch(/\/admin\/templat\/\d+/);
    const page = await fetch(`${base}${loc}`, { headers: { Cookie: adminCookie } });
    expect(page.status).toBe(200);
    const pageText = await page.text();
    expect(pageText).toContain("Templat HTTP Tes");
    expect(pageText).toContain("Skala 10");
  });

  test("guru 403 di semua route templat; supervisor 403 di kelola templat", async () => {
    const guruCookie = await loginAs("guru1", "rahasia123");
    for (const path of ["/admin/templat", `/templat/${seedId}/predikat`, "/templat"]) {
      const res = await fetch(`${base}${path}`, { headers: { Cookie: guruCookie }, redirect: "manual" });
      expect(res.status).toBe(403);
    }
    const supCookie = await loginAs("sup1", "rahasia123");
    const denied = await fetch(`${base}/admin/templat`, { headers: { Cookie: supCookie }, redirect: "manual" });
    expect(denied.status).toBe(403);
    const deniedMeta = await postForm(`/admin/templat/${seedId}`, supCookie, { title: "Coba Ubah" });
    expect(deniedMeta.status).toBe(403);
  });

  test("supervisor boleh membuka halaman predikat dan mengubahnya", async () => {
    const supCookie = await loginAs("sup1", "rahasia123");
    const page = await fetch(`${base}/templat/${seedId}/predikat`, { headers: { Cookie: supCookie } });
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("Sangat Baik");

    const added = await postForm(`/templat/${seedId}/predikat/tambah`, supCookie, {
      min: "0",
      max: "0",
      label: "Nol Saja",
    });
    // Menambah 0–0 bertabrakan dengan 0–59 ("Sangat Kurang") → ditolak.
    expect(added.status).toBe(302);
    expect(added.headers.get("location") ?? "").toContain("err=");

    // Ubah label predikat pertama (90–100) menjadi label lain — valid.
    const detail = await loadTemplateDetail(pool, seedId);
    const predId = detail.predicates.find((p) => p.min === 90)!.id;
    const updated = await postForm(`/templat/${seedId}/predikat/${predId}`, supCookie, {
      min: "90",
      max: "100",
      label: "Istimewa",
    });
    expect(updated.status).toBe(302);
    expect(updated.headers.get("location") ?? "").toContain("ok=");
    const after = await loadTemplateDetail(pool, seedId);
    expect(after.predicates.find((p) => p.id === predId)?.label).toBe("Istimewa");
    // Kembalikan agar seed tetap seperti semula untuk tes lain.
    await updatePredicate(pool, predId, { min: 90, max: 100, label: "Sangat Baik" });
  });

  test("admin: status, salin, dan hapus lewat HTTP", async () => {
    const adminCookie = await loginAs("admin2", "rahasia123");
    const created = await postForm("/admin/templat", adminCookie, {
      title: "Templat Status Tes",
      basis: "",
      version_label: "",
      score_scale: "4",
    });
    const id = Number((created.headers.get("location") ?? "").match(/\/admin\/templat\/(\d+)/)?.[1]);
    expect(id).toBeGreaterThan(0);

    // Transisi tidak valid aktif→draf ditolak (masih draf → aktif dulu).
    const activated = await postForm(`/admin/templat/${id}/status`, adminCookie, { status: "aktif" });
    expect(activated.status).toBe(302);
    expect(activated.headers.get("location") ?? "").toContain("ok=");
    const badTransition = await postForm(`/admin/templat/${id}/status`, adminCookie, { status: "draf" });
    expect(badTransition.status).toBe(302);
    expect(badTransition.headers.get("location") ?? "").toContain("err=");

    // Salin lewat HTTP.
    const copied = await postForm(`/admin/templat/${id}/salin`, adminCookie, {});
    expect(copied.status).toBe(302);
    const copyLoc = copied.headers.get("location") ?? "";
    expect(copyLoc).toMatch(/\/admin\/templat\/\d+/);
    const copyId = Number(copyLoc.match(/\/admin\/templat\/(\d+)/)?.[1]);
    const copyDetail = await loadTemplateDetail(pool, copyId);
    expect(copyDetail.template.status).toBe("draf");
    expect(copyDetail.template.title).toContain("(Salinan)");

    // Hapus salinan (belum dipakai) berhasil.
    const deleted = await postForm(`/admin/templat/${copyId}/hapus`, adminCookie, {});
    expect(deleted.status).toBe(302);
    expect(deleted.headers.get("location") ?? "").toContain("ok=");
    await expect(loadTemplateDetail(pool, copyId)).rejects.toThrow("tidak ditemukan");

    // Hapus templat yang sudah dipakai sesi → ditolak.
    const used = await postForm(`/admin/templat/${seedId}/hapus`, adminCookie, {});
    expect(used.status).toBe(302);
    expect(used.headers.get("location") ?? "").toContain("err=");
  });

  test("admin: edit templat arsip ditolak lewat HTTP", async () => {
    const adminCookie = await loginAs("admin2", "rahasia123");
    const created = await postForm("/admin/templat", adminCookie, {
      title: "Templat Arsip Tes",
      basis: "",
      version_label: "",
      score_scale: "4",
    });
    const id = Number((created.headers.get("location") ?? "").match(/\/admin\/templat\/(\d+)/)?.[1]);
    await postForm(`/admin/templat/${id}/status`, adminCookie, { status: "arsip" });
    const edited = await postForm(`/admin/templat/${id}`, adminCookie, {
      title: "Coba Ubah Arsip",
      basis: "",
      version_label: "",
      score_scale: "4",
    });
    expect(edited.status).toBe(302);
    expect(edited.headers.get("location") ?? "").toContain("err=");
    const d = await loadTemplateDetail(pool, id);
    expect(d.template.title).toBe("Templat Arsip Tes");
  });
});
