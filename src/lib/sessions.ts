import type mysql from "mysql2/promise";
import type { RowDataPacket } from "mysql2/promise";
import { canSupervise } from "../rbac";
import type { SessionUser } from "../auth";
import { snapshotTemplateForSession } from "./snapshot";

/**
 * Service sesi supervisi — Fase 2 (plan bagian 4, 5, 7).
 *
 * Semua aturan ditegakkan di sini (server), bukan hanya di UI:
 * - sesi hanya dibuat supervisor untuk guru yang ditugaskan padanya
 *   (kecuali Kepala Sekolah); templat harus 'aktif';
 * - saat sesi dibuat, snapshot templat disalin ke session_*;
 * - status hanya maju selangkah demi selangkah, boleh mundur selangkah
 *   selama belum 'selesai'; 'selesai' hanya bila lengkap;
 * - skor harus ada di session_scale_levels sesi itu;
 * - refleksi guru (guru_note) hanya ditulis guru saat status 'pasca';
 *   supervisor hanya menulis supervisor_note;
 * - sesi 'selesai' terkunci dari edit.
 */

export const STAGES = ["pra", "observasi", "pasca", "tindak_lanjut", "selesai"] as const;
export type SessionStatus = (typeof STAGES)[number];

export const STAGE_LABEL: Record<SessionStatus, string> = {
  pra: "Pra-Observasi",
  observasi: "Observasi",
  pasca: "Pasca-Observasi",
  tindak_lanjut: "Tindak Lanjut",
  selesai: "Selesai",
};

export type SessionRow = {
  id: number;
  template_id: number | null;
  supervisor_id: number;
  teacher_id: number;
  class_id: number;
  period_id: number;
  subject_theme: string | null;
  phase_semester: string | null;
  observed_at: string;
  observed_time: string | null;
  status: SessionStatus;
  created_at: string;
};

export type SessionDetail = SessionRow & {
  template_title: string;
  template_scale: number;
  supervisor_name: string;
  teacher_name: string;
  teacher_username: string;
  class_name: string;
  period_name: string;
};

export type SnapshotIndicator = {
  id: number;
  element_code: string;
  element_title: string;
  text: string;
  sort: number;
  value: number | null;
  evidence: string;
};

export type SessionSnapshot = {
  principles: { id: number; text: string; sort: number }[];
  elements: { code: string; title: string; indicators: SnapshotIndicator[] }[];
  scaleLevels: { id: number; v: number; label: string }[];
  praQuestions: { id: number; text: string; sort: number; note: string }[];
  pascaQuestions: {
    id: number;
    text: string;
    sort: number;
    guru_note: string;
    supervisor_note: string;
  }[];
  rtlItems: { id: number; title: string; sort: number; note: string }[];
  predicates: { id: number; min: number; max: number; label: string; sort: number }[];
};

export type CompletionCheck = {
  complete: boolean;
  indicatorsFilled: number;
  indicatorsTotal: number;
  reflectionsFilled: number;
  reflectionsTotal: number;
  rtlFilled: number;
  rtlTotal: number;
};

export type SessionProgress = {
  pra: { filled: number; total: number };
  observasi: { filled: number; total: number };
  pasca: { filled: number; total: number };
  tindak_lanjut: { filled: number; total: number };
};

function stageIndex(s: SessionStatus): number {
  return STAGES.indexOf(s);
}

export async function audit(
  pool: mysql.Pool,
  userId: number | null,
  action: string,
  entity: string,
  entityId: number,
  detail: Record<string, unknown>,
): Promise<void> {
  await pool.query(
    "INSERT INTO audit_logs (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)",
    [userId, action, entity, entityId, JSON.stringify(detail)],
  );
}

/** Apakah user boleh MELIHAT sesi ini? Admin semua; supervisor semua (baca); guru hanya sesi atas dirinya. */
export function canViewSession(user: SessionUser, s: SessionRow): boolean {
  if (user.role === "admin") return true;
  if (user.role === "supervisor") return true;
  return user.role === "guru" && s.teacher_id === user.id;
}

/** Apakah user boleh MENGUBAH isi sesi ini? Hanya supervisor pembuatnya, selama belum selesai. */
export function canEditSession(user: SessionUser, s: SessionRow): boolean {
  return user.role === "supervisor" && s.supervisor_id === user.id && s.status !== "selesai";
}

export async function loadSession(pool: mysql.Pool, id: number): Promise<SessionRow | null> {
  const [rows] = await pool.query<(RowDataPacket & SessionRow)[]>(
    "SELECT * FROM sessions WHERE id = ?",
    [id],
  );
  return (rows[0] as SessionRow | undefined) ?? null;
}

export async function loadSessionDetail(pool: mysql.Pool, id: number): Promise<SessionDetail | null> {
  const [rows] = await pool.query<(RowDataPacket & SessionDetail)[]>(
    `SELECT s.*,
            t.title AS template_title,
            (SELECT MAX(v) FROM session_scale_levels WHERE session_id = s.id) AS template_scale,
            sup.name AS supervisor_name,
            g.name AS teacher_name, g.username AS teacher_username,
            c.name AS class_name, p.name AS period_name
     FROM sessions s
     LEFT JOIN templates t ON t.id = s.template_id
     JOIN users sup ON sup.id = s.supervisor_id
     JOIN users g ON g.id = s.teacher_id
     JOIN classes c ON c.id = s.class_id
     JOIN periods p ON p.id = s.period_id
     WHERE s.id = ?`,
    [id],
  );
  return (rows[0] as SessionDetail | undefined) ?? null;
}

/** Daftar sesi yang boleh dilihat user (admin: semua; supervisor: semua; guru: miliknya). */
export async function listSessionsForUser(pool: mysql.Pool, user: SessionUser): Promise<SessionDetail[]> {
  const where = user.role === "guru" ? "WHERE s.teacher_id = ?" : "";
  const params = user.role === "guru" ? [user.id] : [];
  const [rows] = await pool.query<(RowDataPacket & SessionDetail)[]>(
    `SELECT s.*,
            t.title AS template_title,
            (SELECT MAX(v) FROM session_scale_levels WHERE session_id = s.id) AS template_scale,
            sup.name AS supervisor_name,
            g.name AS teacher_name, g.username AS teacher_username,
            c.name AS class_name, p.name AS period_name
     FROM sessions s
     LEFT JOIN templates t ON t.id = s.template_id
     JOIN users sup ON sup.id = s.supervisor_id
     JOIN users g ON g.id = s.teacher_id
     JOIN classes c ON c.id = s.class_id
     JOIN periods p ON p.id = s.period_id
     ${where}
     ORDER BY s.observed_at DESC, s.id DESC`,
    params,
  );
  return rows as SessionDetail[];
}

/** Muat snapshot sesi beserta isian (skor, catatan) yang sudah ada. */
export async function loadSnapshot(pool: mysql.Pool, sessionId: number): Promise<SessionSnapshot> {
  const [principles] = await pool.query<
    (RowDataPacket & { id: number; text: string; sort: number })[]
  >("SELECT * FROM session_principles WHERE session_id = ? ORDER BY sort, id", [sessionId]);
  const [indRows] = await pool.query<
    (RowDataPacket & {
      id: number;
      element_code: string;
      element_title: string;
      text: string;
      sort: number;
      value: number | null;
      evidence: string | null;
    })[]
  >(
    `SELECT si.*, os.value, os.evidence
     FROM session_indicators si
     LEFT JOIN observation_scores os
       ON os.session_id = si.session_id AND os.session_indicator_id = si.id
     WHERE si.session_id = ? ORDER BY si.sort, si.id`,
    [sessionId],
  );
  const [scaleLevels] = await pool.query<
    (RowDataPacket & { id: number; v: number; label: string })[]
  >("SELECT * FROM session_scale_levels WHERE session_id = ? ORDER BY v", [sessionId]);
  const [qRows] = await pool.query<
    (RowDataPacket & {
      id: number;
      stage: string;
      text: string;
      sort: number;
      note: string | null;
      guru_note: string | null;
      supervisor_note: string | null;
    })[]
  >(
    `SELECT sq.*,
            pr.note,
            pc.guru_note, pc.supervisor_note
     FROM session_questions sq
     LEFT JOIN pra_responses pr
       ON pr.session_id = sq.session_id AND pr.session_question_id = sq.id
     LEFT JOIN pasca_responses pc
       ON pc.session_id = sq.session_id AND pc.session_question_id = sq.id
     WHERE sq.session_id = ? ORDER BY sq.sort, sq.id`,
    [sessionId],
  );
  const [rtlRows] = await pool.query<
    (RowDataPacket & { id: number; title: string; sort: number; note: string | null })[]
  >(
    `SELECT sri.*, gp.note
     FROM session_rtl_items sri
     LEFT JOIN growth_plan gp
       ON gp.session_id = sri.session_id AND gp.session_rtl_item_id = sri.id
     WHERE sri.session_id = ? ORDER BY sri.sort, sri.id`,
    [sessionId],
  );
  const [predicates] = await pool.query<
    (RowDataPacket & { id: number; min: number; max: number; label: string; sort: number })[]
  >(
    "SELECT id, min_score AS `min`, max_score AS `max`, label, sort FROM session_predicates WHERE session_id = ? ORDER BY sort, id",
    [sessionId],
  );

  const elements: SessionSnapshot["elements"] = [];
  const byCode = new Map<string, (typeof elements)[number]>();
  for (const r of indRows) {
    let el = byCode.get(r.element_code);
    if (!el) {
      el = { code: r.element_code, title: r.element_title, indicators: [] };
      byCode.set(r.element_code, el);
      elements.push(el);
    }
    el.indicators.push({
      id: r.id,
      element_code: r.element_code,
      element_title: r.element_title,
      text: r.text,
      sort: r.sort,
      value: r.value,
      evidence: r.evidence ?? "",
    });
  }

  return {
    principles: principles as { id: number; text: string; sort: number }[],
    elements,
    scaleLevels: scaleLevels as { id: number; v: number; label: string }[],
    praQuestions: qRows
      .filter((q) => q.stage === "pra")
      .map((q) => ({ id: q.id, text: q.text, sort: q.sort, note: q.note ?? "" })),
    pascaQuestions: qRows
      .filter((q) => q.stage === "pasca")
      .map((q) => ({
        id: q.id,
        text: q.text,
        sort: q.sort,
        guru_note: q.guru_note ?? "",
        supervisor_note: q.supervisor_note ?? "",
      })),
    rtlItems: rtlRows.map((r) => ({ id: r.id, title: r.title, sort: r.sort, note: r.note ?? "" })),
    predicates: predicates.map((p) => ({ ...p, min: Number(p.min), max: Number(p.max) })),
  };
}

export type CreateSessionInput = {
  templateId: number;
  teacherId: number;
  classId: number;
  subject_theme: string;
  phase_semester: string;
  observed_at: string;
  observed_time: string;
};

/**
 * Buat sesi baru (status 'pra') + salin snapshot templat.
 * Menolak: bukan supervisor, guru tidak ditugaskan, templat bukan
 * 'aktif', kelas/guru tidak ditemukan, tanggal kosong.
 */
export async function createSession(
  pool: mysql.Pool,
  supervisor: SessionUser,
  input: CreateSessionInput,
): Promise<number> {
  if (supervisor.role !== "supervisor") {
    throw new Error("Hanya supervisor yang bisa membuat sesi supervisi.");
  }
  if (!input.observed_at) throw new Error("Tanggal observasi wajib diisi.");
  const [tplRows] = await pool.query<
    (RowDataPacket & { id: number; status: string })[]
  >("SELECT id, status FROM templates WHERE id = ?", [input.templateId]);
  const tpl = tplRows[0];
  if (!tpl) throw new Error("Templat tidak ditemukan.");
  if (tpl.status !== "aktif") {
    throw new Error("Sesi baru hanya bisa memakai templat berstatus aktif.");
  }
  const [teacherRows] = await pool.query<(RowDataPacket & { id: number; role: string })[]>(
    "SELECT id, role FROM users WHERE id = ? AND active = 1",
    [input.teacherId],
  );
  const teacher = teacherRows[0];
  if (!teacher || teacher.role !== "guru") throw new Error("Guru tidak ditemukan.");
  if (!(await canSupervise(pool, supervisor, input.teacherId))) {
    throw new Error("Guru ini tidak ditugaskan kepada Anda.");
  }
  const [classRows] = await pool.query<(RowDataPacket & { id: number; period_id: number })[]>(
    "SELECT id, period_id FROM classes WHERE id = ?",
    [input.classId],
  );
  const kelas = classRows[0];
  if (!kelas) throw new Error("Kelas tidak ditemukan.");

  const [res] = await pool.query<import("mysql2/promise").ResultSetHeader>(
    `INSERT INTO sessions
       (template_id, supervisor_id, teacher_id, class_id, period_id,
        subject_theme, phase_semester, observed_at, observed_time, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pra')`,
    [
      input.templateId,
      supervisor.id,
      input.teacherId,
      input.classId,
      kelas.period_id,
      input.subject_theme.trim(),
      input.phase_semester.trim(),
      input.observed_at,
      input.observed_time.trim(),
    ],
  );
  const sessionId = res.insertId;
  try {
    await snapshotTemplateForSession(pool, sessionId);
  } catch (err) {
    // Snapshot gagal → jangan tinggalkan sesi tanpa isi.
    await pool.query("DELETE FROM sessions WHERE id = ?", [sessionId]);
    throw err;
  }
  await audit(pool, supervisor.id, "session.create", "sessions", sessionId, {
    template_id: input.templateId,
    teacher_id: input.teacherId,
    class_id: input.classId,
  });
  return sessionId;
}

/** Progres pengisian tiap tahap (terisi/total). */
export async function sessionProgress(pool: mysql.Pool, sessionId: number): Promise<SessionProgress> {
  const snap = await loadSnapshot(pool, sessionId);
  return {
    pra: {
      filled: snap.praQuestions.filter((q) => q.note.trim() !== "").length,
      total: snap.praQuestions.length,
    },
    observasi: {
      filled: snap.elements.reduce(
        (n, el) => n + el.indicators.filter((i) => i.value !== null).length,
        0,
      ),
      total: snap.elements.reduce((n, el) => n + el.indicators.length, 0),
    },
    pasca: {
      filled: snap.pascaQuestions.filter((q) => q.guru_note.trim() !== "").length,
      total: snap.pascaQuestions.length,
    },
    tindak_lanjut: {
      filled: snap.rtlItems.filter((r) => r.note.trim() !== "").length,
      total: snap.rtlItems.length,
    },
  };
}

/** Apakah sesi boleh ditandai selesai? Semua indikator berskor + refleksi guru + RTL terisi. */
export async function checkCompletion(pool: mysql.Pool, sessionId: number): Promise<CompletionCheck> {
  const p = await sessionProgress(pool, sessionId);
  const complete =
    p.observasi.filled === p.observasi.total &&
    p.observasi.total > 0 &&
    p.pasca.filled === p.pasca.total &&
    p.pasca.total > 0 &&
    p.tindak_lanjut.filled === p.tindak_lanjut.total &&
    p.tindak_lanjut.total > 0;
  return {
    complete,
    indicatorsFilled: p.observasi.filled,
    indicatorsTotal: p.observasi.total,
    reflectionsFilled: p.pasca.filled,
    reflectionsTotal: p.pasca.total,
    rtlFilled: p.tindak_lanjut.filled,
    rtlTotal: p.tindak_lanjut.total,
  };
}

/**
 * Pindah status. Hanya selangkah: maju 1 tahap, atau mundur 1 tahap
 * selama belum 'selesai'. Maju ke 'selesai' menuntut kelengkapan.
 * Hanya supervisor pembuat sesi. Mencatat audit log.
 */
export async function setSessionStatus(
  pool: mysql.Pool,
  user: SessionUser,
  sessionId: number,
  target: SessionStatus,
): Promise<void> {
  if (!STAGES.includes(target)) throw new Error("Status tidak dikenal.");
  const session = await loadSession(pool, sessionId);
  if (!session) throw new Error("Sesi tidak ditemukan.");
  if (!canEditSession(user, session)) {
    throw new Error("Hanya supervisor pembuat sesi yang bisa mengubah statusnya.");
  }
  const from = stageIndex(session.status);
  const to = stageIndex(target);
  if (to === from) return;
  if (Math.abs(to - from) !== 1) {
    throw new Error("Status hanya bisa berpindah satu tahap (maju atau mundur).");
  }
  if (target === "selesai") {
    const check = await checkCompletion(pool, sessionId);
    if (!check.complete) {
      throw new Error(
        `Sesi belum bisa diselesaikan: ${check.indicatorsFilled}/${check.indicatorsTotal} indikator berskor, ` +
          `${check.reflectionsFilled}/${check.reflectionsTotal} refleksi guru, ` +
          `${check.rtlFilled}/${check.rtlTotal} tindak lanjut terisi.`,
      );
    }
  }
  await pool.query("UPDATE sessions SET status = ? WHERE id = ?", [target, sessionId]);
  await audit(pool, user.id, "session.status", "sessions", sessionId, {
    from: session.status,
    to: target,
  });
}

/** Simpan jawaban pra-observasi (sebagian boleh). Hanya supervisor pembuat, status belum selesai. */
export async function savePra(
  pool: mysql.Pool,
  user: SessionUser,
  sessionId: number,
  notes: Record<number, string>,
): Promise<void> {
  const session = await loadSession(pool, sessionId);
  if (!session) throw new Error("Sesi tidak ditemukan.");
  if (!canEditSession(user, session)) {
    throw new Error("Hanya supervisor pembuat sesi yang bisa mengisi pra-observasi.");
  }
  const snap = await loadSnapshot(pool, sessionId);
  const valid = new Set(snap.praQuestions.map((q) => q.id));
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    for (const [qid, note] of Object.entries(notes)) {
      const id = Number(qid);
      if (!valid.has(id)) continue;
      await conn.query(
        `INSERT INTO pra_responses (session_id, session_question_id, note)
         VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE note = VALUES(note)`,
        [sessionId, id, note],
      );
    }
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export type ScoreEntry = { indicatorId: number; value: number | null; evidence: string };

/**
 * Simpan skor + bukti teks observasi (sebagian boleh; value null = kosongkan).
 * Nilai harus ada di session_scale_levels sesi itu. Hanya supervisor
 * pembuat, selama sesi belum selesai.
 */
export async function saveScores(
  pool: mysql.Pool,
  user: SessionUser,
  sessionId: number,
  entries: ScoreEntry[],
): Promise<void> {
  const session = await loadSession(pool, sessionId);
  if (!session) throw new Error("Sesi tidak ditemukan.");
  if (!canEditSession(user, session)) {
    throw new Error("Hanya supervisor pembuat sesi yang bisa mengisi skor observasi.");
  }
  const snap = await loadSnapshot(pool, sessionId);
  const validIndicators = new Set(
    snap.elements.flatMap((el) => el.indicators.map((i) => i.id)),
  );
  const validValues = new Set(snap.scaleLevels.map((l) => l.v));
  for (const e of entries) {
    if (!validIndicators.has(e.indicatorId)) {
      throw new Error("Indikator tidak dikenal pada sesi ini.");
    }
    if (e.value !== null && !validValues.has(e.value)) {
      throw new Error(
        `Skor ${e.value} tidak valid untuk sesi ini (skala: ${[...validValues].sort((a, b) => a - b).join(", ")}).`,
      );
    }
  }
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    for (const e of entries) {
      await conn.query(
        `INSERT INTO observation_scores (session_id, session_indicator_id, value, evidence)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE value = VALUES(value), evidence = VALUES(evidence)`,
        [sessionId, e.indicatorId, e.value, e.evidence.slice(0, 2000)],
      );
    }
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/** Simpan refleksi guru (guru_note). Hanya guru pemilik sesi, saat status 'pasca'. */
export async function savePascaGuru(
  pool: mysql.Pool,
  user: SessionUser,
  sessionId: number,
  notes: Record<number, string>,
): Promise<void> {
  const session = await loadSession(pool, sessionId);
  if (!session) throw new Error("Sesi tidak ditemukan.");
  if (user.role !== "guru" || session.teacher_id !== user.id) {
    throw new Error("Hanya guru yang disupervisi pada sesi ini yang bisa mengisi refleksi.");
  }
  if (session.status !== "pasca") {
    throw new Error("Refleksi hanya bisa diisi saat sesi berada pada tahap pasca-observasi.");
  }
  const snap = await loadSnapshot(pool, sessionId);
  const valid = new Set(snap.pascaQuestions.map((q) => q.id));
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    for (const [qid, note] of Object.entries(notes)) {
      const id = Number(qid);
      if (!valid.has(id)) continue;
      await conn.query(
        `INSERT INTO pasca_responses (session_id, session_question_id, guru_note, supervisor_note)
         VALUES (?, ?, ?, '')
         ON DUPLICATE KEY UPDATE guru_note = VALUES(guru_note)`,
        [sessionId, id, note],
      );
    }
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/** Simpan catatan supervisor pada pasca-observasi. Hanya supervisor pembuat, selama belum selesai. */
export async function savePascaSupervisor(
  pool: mysql.Pool,
  user: SessionUser,
  sessionId: number,
  notes: Record<number, string>,
): Promise<void> {
  const session = await loadSession(pool, sessionId);
  if (!session) throw new Error("Sesi tidak ditemukan.");
  if (!canEditSession(user, session)) {
    throw new Error("Hanya supervisor pembuat sesi yang bisa menambah catatan pasca-observasi.");
  }
  const snap = await loadSnapshot(pool, sessionId);
  const valid = new Set(snap.pascaQuestions.map((q) => q.id));
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    for (const [qid, note] of Object.entries(notes)) {
      const id = Number(qid);
      if (!valid.has(id)) continue;
      await conn.query(
        `INSERT INTO pasca_responses (session_id, session_question_id, guru_note, supervisor_note)
         VALUES (?, ?, '', ?)
         ON DUPLICATE KEY UPDATE supervisor_note = VALUES(supervisor_note)`,
        [sessionId, id, note],
      );
    }
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/** Simpan catatan rencana tindak lanjut (sebagian boleh). Hanya supervisor pembuat, belum selesai. */
export async function saveRtl(
  pool: mysql.Pool,
  user: SessionUser,
  sessionId: number,
  notes: Record<number, string>,
): Promise<void> {
  const session = await loadSession(pool, sessionId);
  if (!session) throw new Error("Sesi tidak ditemukan.");
  if (!canEditSession(user, session)) {
    throw new Error("Hanya supervisor pembuat sesi yang bisa mengisi tindak lanjut.");
  }
  const snap = await loadSnapshot(pool, sessionId);
  const valid = new Set(snap.rtlItems.map((r) => r.id));
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    for (const [rid, note] of Object.entries(notes)) {
      const id = Number(rid);
      if (!valid.has(id)) continue;
      await conn.query(
        `INSERT INTO growth_plan (session_id, session_rtl_item_id, note)
         VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE note = VALUES(note)`,
        [sessionId, id, note],
      );
    }
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}
