import type mysql from "mysql2/promise";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";

/**
 * Service templat instrumen — Fase 1 (plan bagian 1 keputusan 6–9,
 * bagian 5 skema templates + template_*, bagian 6 skala + predikat).
 *
 * Semua aturan ditegakkan di sini (server), bukan hanya di UI:
 * - templat `arsip` tidak bisa diubah (menyalinnya tetap bisa);
 * - status hanya berubah lewat aksi eksplisit (aktifkan/arsipkan/
 *   kembalikan ke draf), bukan lewat edit biasa;
 * - templat seed tidak boleh dihapus;
 * - templat yang sudah pernah dipakai sesi tidak boleh dihapus;
 * - rentang predikat tidak boleh tumpang tindih;
 * - nilai skala harus dalam rentang score_scale templat.
 *
 * `Db` = pool atau koneksi (keduanya punya `.query()`); operasi
 * multi-tabel memakai transaksi via `pool.getConnection()`.
 */

export type Db = mysql.Pool | mysql.PoolConnection;

export type TemplateStatus = "draf" | "aktif" | "arsip";
export type ScoreScale = 4 | 10 | 100;

export type TemplateRow = {
  id: number;
  owner_id: number | null;
  title: string;
  basis: string | null;
  version_label: string | null;
  score_scale: ScoreScale;
  status: TemplateStatus;
  is_seed: number;
  created_at: string;
};

export type PredicateInput = { min: number; max: number; label: string };
export type PredicateRow = PredicateInput & { id: number; sort: number };

export type ElementDetail = {
  id: number;
  code: string;
  title: string;
  sort: number;
  indicators: { id: number; text: string; sort: number }[];
};

export type TemplateDetail = {
  template: TemplateRow;
  principles: { id: number; text: string; sort: number }[];
  elements: ElementDetail[];
  scaleLevels: { id: number; v: number; label: string }[];
  praQuestions: { id: number; text: string; sort: number }[];
  pascaQuestions: { id: number; text: string; sort: number }[];
  rtlItems: { id: number; title: string; sort: number }[];
  predicates: PredicateRow[];
  usedBySessions: number;
};

const STATUSES: TemplateStatus[] = ["draf", "aktif", "arsip"];
const SCALES: ScoreScale[] = [4, 10, 100];

/** Transisi status yang diizinkan (aksi eksplisit saja). */
const ALLOWED_TRANSITIONS: Record<TemplateStatus, TemplateStatus[]> = {
  draf: ["aktif", "arsip"],
  aktif: ["arsip"],
  arsip: ["draf"],
};

/** Rentang nilai skala yang valid: skala 100 boleh 0..100, lainnya 1..skala. */
export function scaleRange(scale: ScoreScale): { min: number; max: number } {
  return scale === 100 ? { min: 0, max: 100 } : { min: 1, max: scale };
}

export function isValidScaleValue(scale: ScoreScale, v: number): boolean {
  if (!Number.isInteger(v)) return false;
  const r = scaleRange(scale);
  return v >= r.min && v <= r.max;
}

/**
 * Validasi daftar predikat: label wajib, 0 <= min <= max <= 100,
 * dan tidak boleh ada dua rentang yang tumpang tindih (inklusif).
 * Mengembalikan pesan error, atau null bila valid.
 */
export function validatePredicates(preds: PredicateInput[]): string | null {
  for (const p of preds) {
    if (!p.label.trim()) return "Label predikat wajib diisi.";
    if (!Number.isFinite(p.min) || !Number.isFinite(p.max)) {
      return "Rentang predikat harus berupa angka.";
    }
    if (p.min < 0 || p.max > 100 || p.min > p.max) {
      return `Rentang predikat tidak valid: ${p.min}–${p.max} (harus 0–100 dan min ≤ maks).`;
    }
  }
  const sorted = [...preds].sort((a, b) => a.min - b.min);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i]!.min <= sorted[i - 1]!.max) {
      return `Rentang predikat tumpang tindih: ${sorted[i - 1]!.min}–${sorted[i - 1]!.max} dengan ${sorted[i]!.min}–${sorted[i]!.max}.`;
    }
  }
  return null;
}

async function getTemplateRow(db: Db, id: number): Promise<TemplateRow> {
  const [rows] = await db.query<(RowDataPacket & TemplateRow)[]>(
    "SELECT * FROM templates WHERE id = ?",
    [id],
  );
  const row = rows[0];
  if (!row) throw new Error("Templat tidak ditemukan.");
  return row;
}

function assertEditable(t: TemplateRow): void {
  if (t.status === "arsip") {
    throw new Error(
      "Templat arsip tidak bisa diubah. Salin dulu templat ini bila perlu versi yang bisa diedit.",
    );
  }
}

async function nextSort(
  db: Db,
  table: string,
  where: string,
  params: unknown[],
): Promise<number> {
  const [rows] = await db.query<(RowDataPacket & { m: number | null })[]>(
    `SELECT COALESCE(MAX(sort), 0) AS m FROM ${table} WHERE ${where}`,
    params,
  );
  return (rows[0]?.m ?? 0) + 1;
}

/** Daftar templat + hitungan anak dan pemakaian sesi. */
export async function listTemplates(pool: mysql.Pool): Promise<
  (TemplateRow & { elements: number; indicators: number; usedBySessions: number })[]
> {
  const [rows] = await pool.query<
    (RowDataPacket & TemplateRow & { elements: number; indicators: number; usedBySessions: number })[]
  >(
    `SELECT t.*,
            (SELECT COUNT(*) FROM template_elements e WHERE e.template_id = t.id) AS elements,
            (SELECT COUNT(*) FROM template_indicators i
             WHERE i.element_id IN (SELECT id FROM template_elements WHERE template_id = t.id)) AS indicators,
            (SELECT COUNT(*) FROM sessions s WHERE s.template_id = t.id) AS usedBySessions
     FROM templates t ORDER BY t.is_seed DESC, t.status, t.title`,
  );
  return rows;
}

/** Muat satu templat beserta seluruh anaknya (untuk halaman edit, salin, snapshot). */
export async function loadTemplateDetail(
  db: Db,
  templateId: number,
): Promise<TemplateDetail> {
  const template = await getTemplateRow(db, templateId);
  const [principles] = await db.query<
    (RowDataPacket & { id: number; text: string; sort: number })[]
  >("SELECT id, text, sort FROM template_principles WHERE template_id = ? ORDER BY sort, id", [templateId]);
  const [elements] = await db.query<
    (RowDataPacket & { id: number; code: string; title: string; sort: number })[]
  >("SELECT id, code, title, sort FROM template_elements WHERE template_id = ? ORDER BY sort, id", [templateId]);
  const [indicators] = await db.query<
    (RowDataPacket & { id: number; element_id: number; text: string; sort: number })[]
  >(
    `SELECT i.id, i.element_id, i.text, i.sort FROM template_indicators i
     JOIN template_elements e ON e.id = i.element_id
     WHERE e.template_id = ? ORDER BY e.sort, e.id, i.sort, i.id`,
    [templateId],
  );
  const [levels] = await db.query<
    (RowDataPacket & { id: number; v: number; label: string })[]
  >("SELECT id, v, label FROM template_scale_levels WHERE template_id = ? ORDER BY v", [templateId]);
  const [questions] = await db.query<
    (RowDataPacket & { id: number; stage: string; text: string; sort: number })[]
  >(
    "SELECT id, stage, text, sort FROM template_questions WHERE template_id = ? ORDER BY stage, sort, id",
    [templateId],
  );
  const [rtl] = await db.query<
    (RowDataPacket & { id: number; title: string; sort: number })[]
  >("SELECT id, title, sort FROM template_rtl_items WHERE template_id = ? ORDER BY sort, id", [templateId]);
  const [predicates] = await db.query<
    (RowDataPacket & PredicateRow)[]
  >(
    "SELECT id, min_score AS min, max_score AS max, label, sort FROM template_predicates WHERE template_id = ? ORDER BY sort, id",
    [templateId],
  );
  const [used] = await db.query<(RowDataPacket & { c: number })[]>(
    "SELECT COUNT(*) AS c FROM sessions WHERE template_id = ?",
    [templateId],
  );
  return {
    template,
    principles,
    elements: elements.map((e) => ({
      ...e,
      indicators: indicators
        .filter((i) => i.element_id === e.id)
        .map((i) => ({ id: i.id, text: i.text, sort: i.sort })),
    })),
    scaleLevels: levels,
    praQuestions: questions
      .filter((q) => q.stage === "pra")
      .map((q) => ({ id: q.id, text: q.text, sort: q.sort })),
    pascaQuestions: questions
      .filter((q) => q.stage === "pasca")
      .map((q) => ({ id: q.id, text: q.text, sort: q.sort })),
    rtlItems: rtl,
    predicates: predicates.map((p) => ({ ...p, min: Number(p.min), max: Number(p.max) })),
    usedBySessions: used[0]?.c ?? 0,
  };
}

// ---------- Templat (meta + status) ----------

export async function createTemplate(
  pool: mysql.Pool,
  input: {
    title: string;
    basis?: string | null;
    version_label?: string | null;
    score_scale: ScoreScale;
    ownerId?: number | null;
  },
): Promise<number> {
  const title = input.title.trim();
  if (!title) throw new Error("Judul templat wajib diisi.");
  if (!SCALES.includes(input.score_scale)) {
    throw new Error("Skala penilaian harus 4, 10, atau 100.");
  }
  // Templat baru selalu berstatus draf; pengaktifan lewat aksi eksplisit.
  const [res] = await pool.query<ResultSetHeader>(
    `INSERT INTO templates (owner_id, title, basis, version_label, score_scale, status, is_seed)
     VALUES (?, ?, ?, ?, ?, 'draf', 0)`,
    [
      input.ownerId ?? null,
      title,
      input.basis?.trim() || null,
      input.version_label?.trim() || null,
      input.score_scale,
    ],
  );
  return res.insertId;
}

export async function updateTemplateMeta(
  pool: mysql.Pool,
  id: number,
  fields: {
    title?: string;
    basis?: string | null;
    version_label?: string | null;
    score_scale?: ScoreScale;
  },
): Promise<void> {
  const t = await getTemplateRow(pool, id);
  assertEditable(t);
  const title = fields.title !== undefined ? fields.title.trim() : t.title;
  if (!title) throw new Error("Judul templat wajib diisi.");
  const scale = fields.score_scale ?? t.score_scale;
  if (!SCALES.includes(scale)) throw new Error("Skala penilaian harus 4, 10, atau 100.");
  if (scale !== t.score_scale) {
    // Nilai skala yang sudah ada harus tetap valid pada skala baru.
    const [levels] = await pool.query<(RowDataPacket & { v: number })[]>(
      "SELECT v FROM template_scale_levels WHERE template_id = ?",
      [id],
    );
    const bad = levels.filter((l) => !isValidScaleValue(scale, l.v));
    if (bad.length > 0) {
      const r = scaleRange(scale);
      throw new Error(
        `Skala tidak bisa diubah ke ${scale}: ada label skala dengan nilai ${bad.map((b) => b.v).join(", ")} di luar rentang ${r.min}–${r.max}. Ubah dulu label skalanya.`,
      );
    }
  }
  await pool.query(
    "UPDATE templates SET title = ?, basis = ?, version_label = ?, score_scale = ? WHERE id = ?",
    [
      title,
      fields.basis !== undefined ? fields.basis?.trim() || null : t.basis,
      fields.version_label !== undefined ? fields.version_label?.trim() || null : t.version_label,
      scale,
      id,
    ],
  );
}

/** Ubah status hanya lewat aksi eksplisit; transisi di luar daftar ditolak. */
export async function setTemplateStatus(
  pool: mysql.Pool,
  id: number,
  target: TemplateStatus,
): Promise<void> {
  if (!STATUSES.includes(target)) throw new Error("Status tidak dikenal.");
  const t = await getTemplateRow(pool, id);
  if (t.status === target) return;
  if (!ALLOWED_TRANSITIONS[t.status].includes(target)) {
    throw new Error(
      `Status templat tidak bisa diubah dari "${t.status}" ke "${target}".`,
    );
  }
  await pool.query("UPDATE templates SET status = ? WHERE id = ?", [target, id]);
}

// ---------- Salin & hapus ----------

/** Salin lengkap templat (semua anak) menjadi templat baru berstatus draf. */
export async function copyTemplate(
  pool: mysql.Pool,
  id: number,
  ownerId?: number | null,
): Promise<number> {
  const detail = await loadTemplateDetail(pool, id);
  const t = detail.template;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [res] = await conn.query<ResultSetHeader>(
      `INSERT INTO templates (owner_id, title, basis, version_label, score_scale, status, is_seed)
       VALUES (?, ?, ?, ?, ?, 'draf', 0)`,
      [ownerId ?? null, `${t.title} (Salinan)`, t.basis, t.version_label, t.score_scale],
    );
    const newId = res.insertId;
    for (const p of detail.principles) {
      await conn.query(
        "INSERT INTO template_principles (template_id, text, sort) VALUES (?, ?, ?)",
        [newId, p.text, p.sort],
      );
    }
    for (const el of detail.elements) {
      const [elRes] = await conn.query<ResultSetHeader>(
        "INSERT INTO template_elements (template_id, code, title, sort) VALUES (?, ?, ?, ?)",
        [newId, el.code, el.title, el.sort],
      );
      for (const ind of el.indicators) {
        await conn.query(
          "INSERT INTO template_indicators (element_id, text, sort) VALUES (?, ?, ?)",
          [elRes.insertId, ind.text, ind.sort],
        );
      }
    }
    for (const lv of detail.scaleLevels) {
      await conn.query(
        "INSERT INTO template_scale_levels (template_id, v, label) VALUES (?, ?, ?)",
        [newId, lv.v, lv.label],
      );
    }
    for (const q of [...detail.praQuestions.map((x) => ({ ...x, stage: "pra" })), ...detail.pascaQuestions.map((x) => ({ ...x, stage: "pasca" }))]) {
      await conn.query(
        "INSERT INTO template_questions (template_id, stage, text, sort) VALUES (?, ?, ?, ?)",
        [newId, q.stage, q.text, q.sort],
      );
    }
    for (const r of detail.rtlItems) {
      await conn.query(
        "INSERT INTO template_rtl_items (template_id, title, sort) VALUES (?, ?, ?)",
        [newId, r.title, r.sort],
      );
    }
    for (const p of detail.predicates) {
      await conn.query(
        "INSERT INTO template_predicates (template_id, min_score, max_score, label, sort) VALUES (?, ?, ?, ?, ?)",
        [newId, p.min, p.max, p.label, p.sort],
      );
    }
    await conn.commit();
    return newId;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Hapus templat. Ditolak bila: templat seed, atau sudah pernah dipakai
 * sesi mana pun. Anak ikut terhapus lewat FK cascade.
 */
export async function deleteTemplate(pool: mysql.Pool, id: number): Promise<void> {
  const t = await getTemplateRow(pool, id);
  if (t.is_seed === 1) {
    throw new Error("Templat bawaan (seed) tidak boleh dihapus. Salin dulu bila perlu versi lain.");
  }
  const [used] = await pool.query<(RowDataPacket & { c: number })[]>(
    "SELECT COUNT(*) AS c FROM sessions WHERE template_id = ?",
    [id],
  );
  if ((used[0]?.c ?? 0) > 0) {
    throw new Error(
      `Templat sudah pernah dipakai ${used[0]!.c} sesi supervisi dan tidak boleh dihapus — yang bisa dilakukan hanya mengarsipkan. Riwayat sesi harus tetap utuh.`,
    );
  }
  await pool.query("DELETE FROM templates WHERE id = ?", [id]);
}

// ---------- Anak templat ----------

async function templateIdForChild(
  pool: mysql.Pool,
  table: string,
  childId: number,
  templateColumn = "template_id",
): Promise<number> {
  // template_indicators tidak punya template_id langsung — lewat elemen.
  const sql =
    table === "template_indicators"
      ? `SELECT e.template_id AS tid FROM template_indicators i
         JOIN template_elements e ON e.id = i.element_id WHERE i.id = ?`
      : `SELECT ${templateColumn} AS tid FROM ${table} WHERE id = ?`;
  const [rows] = await pool.query<(RowDataPacket & { tid: number })[]>(sql, [childId]);
  if (!rows[0]) throw new Error("Butir tidak ditemukan.");
  return rows[0].tid;
}

async function editableTemplateOfChild(
  pool: mysql.Pool,
  table: string,
  childId: number,
): Promise<TemplateRow> {
  const tid = await templateIdForChild(pool, table, childId);
  const t = await getTemplateRow(pool, tid);
  assertEditable(t);
  return t;
}

export async function addPrinciple(pool: mysql.Pool, templateId: number, text: string): Promise<number> {
  const t = await getTemplateRow(pool, templateId);
  assertEditable(t);
  if (!text.trim()) throw new Error("Teks prinsip wajib diisi.");
  const sort = await nextSort(pool, "template_principles", "template_id = ?", [templateId]);
  const [res] = await pool.query<ResultSetHeader>(
    "INSERT INTO template_principles (template_id, text, sort) VALUES (?, ?, ?)",
    [templateId, text.trim(), sort],
  );
  return res.insertId;
}

export async function updatePrinciple(pool: mysql.Pool, id: number, text: string): Promise<void> {
  await editableTemplateOfChild(pool, "template_principles", id);
  if (!text.trim()) throw new Error("Teks prinsip wajib diisi.");
  await pool.query("UPDATE template_principles SET text = ? WHERE id = ?", [text.trim(), id]);
}

export async function deletePrinciple(pool: mysql.Pool, id: number): Promise<void> {
  await editableTemplateOfChild(pool, "template_principles", id);
  await pool.query("DELETE FROM template_principles WHERE id = ?", [id]);
}

export async function addElement(
  pool: mysql.Pool,
  templateId: number,
  code: string,
  title: string,
): Promise<number> {
  const t = await getTemplateRow(pool, templateId);
  assertEditable(t);
  if (!code.trim() || !title.trim()) throw new Error("Kode dan judul elemen wajib diisi.");
  const [dup] = await pool.query<(RowDataPacket & { id: number })[]>(
    "SELECT id FROM template_elements WHERE template_id = ? AND code = ?",
    [templateId, code.trim()],
  );
  if (dup.length > 0) throw new Error(`Kode elemen sudah dipakai di templat ini: ${code.trim()}`);
  const sort = await nextSort(pool, "template_elements", "template_id = ?", [templateId]);
  const [res] = await pool.query<ResultSetHeader>(
    "INSERT INTO template_elements (template_id, code, title, sort) VALUES (?, ?, ?, ?)",
    [templateId, code.trim(), title.trim(), sort],
  );
  return res.insertId;
}

export async function updateElement(
  pool: mysql.Pool,
  id: number,
  code: string,
  title: string,
): Promise<void> {
  const t = await editableTemplateOfChild(pool, "template_elements", id);
  if (!code.trim() || !title.trim()) throw new Error("Kode dan judul elemen wajib diisi.");
  const [dup] = await pool.query<(RowDataPacket & { id: number })[]>(
    "SELECT id FROM template_elements WHERE template_id = ? AND code = ? AND id <> ?",
    [t.id, code.trim(), id],
  );
  if (dup.length > 0) throw new Error(`Kode elemen sudah dipakai di templat ini: ${code.trim()}`);
  await pool.query("UPDATE template_elements SET code = ?, title = ? WHERE id = ?", [
    code.trim(),
    title.trim(),
    id,
  ]);
}

export async function deleteElement(pool: mysql.Pool, id: number): Promise<void> {
  await editableTemplateOfChild(pool, "template_elements", id);
  // Indikator ikut terhapus lewat FK cascade.
  await pool.query("DELETE FROM template_elements WHERE id = ?", [id]);
}

export async function addIndicator(pool: mysql.Pool, elementId: number, text: string): Promise<number> {
  const [el] = await pool.query<(RowDataPacket & { template_id: number })[]>(
    "SELECT template_id FROM template_elements WHERE id = ?",
    [elementId],
  );
  if (!el[0]) throw new Error("Elemen tidak ditemukan.");
  const t = await getTemplateRow(pool, el[0].template_id);
  assertEditable(t);
  if (!text.trim()) throw new Error("Teks indikator wajib diisi.");
  const sort = await nextSort(pool, "template_indicators", "element_id = ?", [elementId]);
  const [res] = await pool.query<ResultSetHeader>(
    "INSERT INTO template_indicators (element_id, text, sort) VALUES (?, ?, ?)",
    [elementId, text.trim(), sort],
  );
  return res.insertId;
}

export async function updateIndicator(pool: mysql.Pool, id: number, text: string): Promise<void> {
  await editableTemplateOfChild(pool, "template_indicators", id);
  if (!text.trim()) throw new Error("Teks indikator wajib diisi.");
  await pool.query("UPDATE template_indicators SET text = ? WHERE id = ?", [text.trim(), id]);
}

export async function deleteIndicator(pool: mysql.Pool, id: number): Promise<void> {
  await editableTemplateOfChild(pool, "template_indicators", id);
  await pool.query("DELETE FROM template_indicators WHERE id = ?", [id]);
}

export async function addQuestion(
  pool: mysql.Pool,
  templateId: number,
  stage: "pra" | "pasca",
  text: string,
): Promise<number> {
  const t = await getTemplateRow(pool, templateId);
  assertEditable(t);
  if (stage !== "pra" && stage !== "pasca") throw new Error("Tahap pertanyaan harus pra atau pasca.");
  if (!text.trim()) throw new Error("Teks pertanyaan wajib diisi.");
  const sort = await nextSort(pool, "template_questions", "template_id = ? AND stage = ?", [templateId, stage]);
  const [res] = await pool.query<ResultSetHeader>(
    "INSERT INTO template_questions (template_id, stage, text, sort) VALUES (?, ?, ?, ?)",
    [templateId, stage, text.trim(), sort],
  );
  return res.insertId;
}

export async function updateQuestion(pool: mysql.Pool, id: number, text: string): Promise<void> {
  await editableTemplateOfChild(pool, "template_questions", id);
  if (!text.trim()) throw new Error("Teks pertanyaan wajib diisi.");
  await pool.query("UPDATE template_questions SET text = ? WHERE id = ?", [text.trim(), id]);
}

export async function deleteQuestion(pool: mysql.Pool, id: number): Promise<void> {
  await editableTemplateOfChild(pool, "template_questions", id);
  await pool.query("DELETE FROM template_questions WHERE id = ?", [id]);
}

export async function addRtlItem(pool: mysql.Pool, templateId: number, title: string): Promise<number> {
  const t = await getTemplateRow(pool, templateId);
  assertEditable(t);
  if (!title.trim()) throw new Error("Judul butir tindak lanjut wajib diisi.");
  const sort = await nextSort(pool, "template_rtl_items", "template_id = ?", [templateId]);
  const [res] = await pool.query<ResultSetHeader>(
    "INSERT INTO template_rtl_items (template_id, title, sort) VALUES (?, ?, ?)",
    [templateId, title.trim(), sort],
  );
  return res.insertId;
}

export async function updateRtlItem(pool: mysql.Pool, id: number, title: string): Promise<void> {
  await editableTemplateOfChild(pool, "template_rtl_items", id);
  if (!title.trim()) throw new Error("Judul butir tindak lanjut wajib diisi.");
  await pool.query("UPDATE template_rtl_items SET title = ? WHERE id = ?", [title.trim(), id]);
}

export async function deleteRtlItem(pool: mysql.Pool, id: number): Promise<void> {
  await editableTemplateOfChild(pool, "template_rtl_items", id);
  await pool.query("DELETE FROM template_rtl_items WHERE id = ?", [id]);
}

// ---------- Label skala ----------

export async function addScaleLevel(
  pool: mysql.Pool,
  templateId: number,
  v: number,
  label: string,
): Promise<number> {
  const t = await getTemplateRow(pool, templateId);
  assertEditable(t);
  if (!isValidScaleValue(t.score_scale, v)) {
    const r = scaleRange(t.score_scale);
    throw new Error(`Nilai skala tidak valid untuk skala ${t.score_scale}: harus ${r.min}–${r.max}.`);
  }
  if (!label.trim()) throw new Error("Label skala wajib diisi.");
  try {
    const [res] = await pool.query<ResultSetHeader>(
      "INSERT INTO template_scale_levels (template_id, v, label) VALUES (?, ?, ?)",
      [templateId, v, label.trim()],
    );
    return res.insertId;
  } catch (err) {
    const e = err as { code?: string };
    if (e.code === "ER_DUP_ENTRY") throw new Error(`Nilai skala ${v} sudah ada di templat ini.`);
    throw err;
  }
}

export async function updateScaleLevel(
  pool: mysql.Pool,
  id: number,
  v: number,
  label: string,
): Promise<void> {
  const t = await editableTemplateOfChild(pool, "template_scale_levels", id);
  if (!isValidScaleValue(t.score_scale, v)) {
    const r = scaleRange(t.score_scale);
    throw new Error(`Nilai skala tidak valid untuk skala ${t.score_scale}: harus ${r.min}–${r.max}.`);
  }
  if (!label.trim()) throw new Error("Label skala wajib diisi.");
  try {
    await pool.query("UPDATE template_scale_levels SET v = ?, label = ? WHERE id = ?", [
      v,
      label.trim(),
      id,
    ]);
  } catch (err) {
    const e = err as { code?: string };
    if (e.code === "ER_DUP_ENTRY") throw new Error(`Nilai skala ${v} sudah ada di templat ini.`);
    throw err;
  }
}

export async function deleteScaleLevel(pool: mysql.Pool, id: number): Promise<void> {
  await editableTemplateOfChild(pool, "template_scale_levels", id);
  await pool.query("DELETE FROM template_scale_levels WHERE id = ?", [id]);
}

// ---------- Predikat ----------

/**
 * Ganti seluruh rentang predikat templat (dipakai halaman predikat).
 * Validasi tumpang tindih berlaku untuk daftar baru secara utuh.
 * Boleh juga dipanggil dengan daftar kosong (predikat dihapus semua).
 */
export async function replacePredicates(
  pool: mysql.Pool,
  templateId: number,
  preds: PredicateInput[],
): Promise<void> {
  const t = await getTemplateRow(pool, templateId);
  assertEditable(t);
  const err = validatePredicates(preds);
  if (err) throw new Error(err);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query("DELETE FROM template_predicates WHERE template_id = ?", [templateId]);
    for (let i = 0; i < preds.length; i++) {
      const p = preds[i]!;
      await conn.query(
        "INSERT INTO template_predicates (template_id, min_score, max_score, label, sort) VALUES (?, ?, ?, ?, ?)",
        [templateId, p.min, p.max, p.label.trim(), i + 1],
      );
    }
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

export async function addPredicate(
  pool: mysql.Pool,
  templateId: number,
  pred: PredicateInput,
): Promise<number> {
  const detail = await loadTemplateDetail(pool, templateId);
  assertEditable(detail.template);
  const all = [...detail.predicates.map((p) => ({ min: p.min, max: p.max, label: p.label })), pred];
  const err = validatePredicates(all);
  if (err) throw new Error(err);
  const sort = detail.predicates.length + 1;
  const [res] = await pool.query<ResultSetHeader>(
    "INSERT INTO template_predicates (template_id, min_score, max_score, label, sort) VALUES (?, ?, ?, ?, ?)",
    [templateId, pred.min, pred.max, pred.label.trim(), sort],
  );
  return res.insertId;
}

export async function updatePredicate(
  pool: mysql.Pool,
  id: number,
  pred: PredicateInput,
): Promise<void> {
  const t = await editableTemplateOfChild(pool, "template_predicates", id);
  const detail = await loadTemplateDetail(pool, t.id);
  const all = detail.predicates.map((p) =>
    p.id === id ? pred : { min: p.min, max: p.max, label: p.label },
  );
  const err = validatePredicates(all);
  if (err) throw new Error(err);
  await pool.query(
    "UPDATE template_predicates SET min_score = ?, max_score = ?, label = ? WHERE id = ?",
    [pred.min, pred.max, pred.label.trim(), id],
  );
}

export async function deletePredicate(pool: mysql.Pool, id: number): Promise<void> {
  await editableTemplateOfChild(pool, "template_predicates", id);
  await pool.query("DELETE FROM template_predicates WHERE id = ?", [id]);
}
