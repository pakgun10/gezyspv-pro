import type mysql from "mysql2/promise";
import type { RowDataPacket } from "mysql2/promise";
import type { SessionUser } from "../auth";
import { canSupervise, isSupervisor, supervisedTeacherIds } from "../rbac";
import { predicateFor, type PredicateRange } from "./scores";
import { esc } from "../views";

/**
 * Profil guru, rekap sekolah/kelas, dan grafik tren — Fase 3
 * (plan bagian 6 dan 7).
 *
 * Aturan yang ditegakkan di sini (server):
 * - HANYA sesi berstatus 'selesai' yang masuk tren, distribusi, dan
 *   rata-rata. Sesi yang masih berjalan ditampilkan terpisah sebagai
 *   "dalam proses" tanpa skor.
 * - Rata-rata per periode SELALU ditampilkan bersama rincian per sesi
 *   + predikat masing-masing (jangan tampilkan rata-rata tanpa rincian).
 * - Rata-rata per elemen rekap sekolah memakai bobot sama per sesi
 *   (rata-rata dari rata-rata elemen tiap sesi, dalam skala 0–100),
 *   supaya satu sesi dengan banyak indikator tidak mendominasi.
 * - Hak lihat: admin semua; supervisor hanya guru yang ditugaskan
 *   (Kepsek semua); guru hanya dirinya sendiri. Rekap sekolah/kelas
 *   untuk supervisor non-Kepsek dan guru hanya mencakup lingkup yang
 *   boleh mereka lihat (diberi label lingkup di UI).
 */

export type TeacherRow = { id: number; username: string; name: string; nip: string | null };

export type SessionSummary = {
  id: number;
  observed_at: string;
  subject_theme: string | null;
  status: string;
  teacher_id: number;
  teacher_name: string;
  class_id: number;
  class_name: string;
  period_id: number;
  period_name: string;
  final100: number | null;
  predicate: string;
  filled: number;
  total: number;
};

export type PeriodRow = { id: number; name: string; is_active: number };

export type IndicatorDistribution = {
  element_code: string;
  element_title: string;
  indicator_text: string;
  label: string;
  value: number;
  count: number;
};

export type ElementAverage = {
  element_code: string;
  element_title: string;
  avg100: number;
  sessions: number;
};

export type PredicateCount = { label: string; count: number };

/** Apakah user boleh melihat profil/rekap guru teacherId? Admin semua; Kepsek semua; supervisor-flag hanya guru yang ditugaskan padanya (termasuk supervisor lain yang ditugaskan); guru hanya dirinya sendiri. */
export async function canViewTeacher(
  pool: mysql.Pool,
  user: SessionUser,
  teacherId: number,
): Promise<boolean> {
  if (user.role === "admin") return true;
  if (user.id === teacherId) return true; // profil sendiri — guru biasa maupun supervisor
  if (user.is_principal) return true;
  if (isSupervisor(user)) return canSupervise(pool, user, teacherId);
  return false;
}

export async function loadTeacher(pool: mysql.Pool, teacherId: number): Promise<TeacherRow | null> {
  const [rows] = await pool.query<(RowDataPacket & TeacherRow)[]>(
    "SELECT id, username, name, nip FROM users WHERE id = ? AND role = 'guru' AND active = 1",
    [teacherId],
  );
  return (rows[0] as TeacherRow | undefined) ?? null;
}

export async function listPeriods(pool: mysql.Pool): Promise<PeriodRow[]> {
  const [rows] = await pool.query<(RowDataPacket & PeriodRow)[]>(
    "SELECT id, name, is_active FROM periods ORDER BY id",
  );
  return rows as PeriodRow[];
}

export async function activePeriod(pool: mysql.Pool): Promise<PeriodRow | null> {
  const [rows] = await pool.query<(RowDataPacket & PeriodRow)[]>(
    "SELECT id, name, is_active FROM periods WHERE is_active = 1 ORDER BY id LIMIT 1",
  );
  return (rows[0] as PeriodRow | undefined) ?? null;
}

export async function loadPeriod(pool: mysql.Pool, periodId: number): Promise<PeriodRow | null> {
  const [rows] = await pool.query<(RowDataPacket & PeriodRow)[]>(
    "SELECT id, name, is_active FROM periods WHERE id = ?",
    [periodId],
  );
  return (rows[0] as PeriodRow | undefined) ?? null;
}

/** Lingkup sesi yang boleh dilihat user: null = semua; array id guru = terbatas. */
export async function viewScopeTeacherIds(
  pool: mysql.Pool,
  user: SessionUser,
): Promise<number[] | null> {
  if (user.role === "admin" || user.is_principal) return null;
  if (isSupervisor(user)) {
    return supervisedTeacherIds(pool, user);
  }
  return [user.id];
}

function scopeClause(ids: number[] | null): { sql: string; params: unknown[] } {
  if (ids === null) return { sql: "", params: [] };
  if (ids.length === 0) return { sql: " AND 1 = 0", params: [] };
  return { sql: ` AND s.teacher_id IN (${ids.map(() => "?").join(",")})`, params: ids };
}

type SessionAggRow = RowDataPacket & {
  id: number;
  observed_at: string;
  subject_theme: string | null;
  status: string;
  teacher_id: number;
  teacher_name: string;
  class_id: number;
  class_name: string;
  period_id: number;
  period_name: string;
  avg_value: number | null;
  filled: number;
  total: number;
  scale_max: number | null;
};

/**
 * Ringkasan sesi (dengan nilai akhir + predikat) untuk filter tertentu.
 * Predikat diambil dari session_predicates tiap sesi (snapshot).
 */
export async function sessionSummaries(
  pool: mysql.Pool,
  opts: { teacherId?: number; periodId?: number; classId?: number; status?: string } = {},
): Promise<SessionSummary[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.teacherId !== undefined) {
    where.push("s.teacher_id = ?");
    params.push(opts.teacherId);
  }
  if (opts.periodId !== undefined) {
    where.push("s.period_id = ?");
    params.push(opts.periodId);
  }
  if (opts.classId !== undefined) {
    where.push("s.class_id = ?");
    params.push(opts.classId);
  }
  if (opts.status !== undefined) {
    where.push("s.status = ?");
    params.push(opts.status);
  }
  const [rows] = await pool.query<SessionAggRow[]>(
    `SELECT s.id, s.observed_at, s.subject_theme, s.status,
            s.teacher_id, g.name AS teacher_name,
            s.class_id, c.name AS class_name,
            s.period_id, p.name AS period_name,
            AVG(os.value) AS avg_value, COUNT(os.value) AS filled, COUNT(si.id) AS total,
            (SELECT MAX(v) FROM session_scale_levels WHERE session_id = s.id) AS scale_max
     FROM sessions s
     JOIN users g ON g.id = s.teacher_id
     JOIN classes c ON c.id = s.class_id
     JOIN periods p ON p.id = s.period_id
     LEFT JOIN session_indicators si ON si.session_id = s.id
     LEFT JOIN observation_scores os ON os.session_id = s.id AND os.session_indicator_id = si.id
     ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
     GROUP BY s.id
     ORDER BY s.observed_at ASC, s.id ASC`,
    params,
  );
  const ids = rows.map((r) => r.id);
  const predBySession = new Map<number, PredicateRange[]>();
  if (ids.length > 0) {
    const [pr] = await pool.query<
      (RowDataPacket & { session_id: number; min: number; max: number; label: string })[]
    >(
      `SELECT session_id, min_score AS \`min\`, max_score AS \`max\`, label
       FROM session_predicates WHERE session_id IN (${ids.map(() => "?").join(",")}) ORDER BY sort, id`,
      ids,
    );
    for (const r of pr) {
      const list = predBySession.get(r.session_id) ?? [];
      list.push({ min: Number(r.min), max: Number(r.max), label: r.label });
      predBySession.set(r.session_id, list);
    }
  }
  return rows.map((r) => {
    const final100 =
      r.avg_value === null || r.scale_max === null || r.scale_max <= 0
        ? null
        : (Number(r.avg_value) / Number(r.scale_max)) * 100;
    return {
      id: r.id,
      observed_at: r.observed_at,
      subject_theme: r.subject_theme,
      status: r.status,
      teacher_id: r.teacher_id,
      teacher_name: r.teacher_name,
      class_id: r.class_id,
      class_name: r.class_name,
      period_id: r.period_id,
      period_name: r.period_name,
      final100,
      predicate: predicateFor(final100, predBySession.get(r.id) ?? []),
      filled: Number(r.filled),
      total: Number(r.total),
    };
  });
}

/**
 * Skor guru per periode: rata-rata nilai akhir SEMUA sesi selesai dalam
 * periode itu — selalu bersama rincian per sesi (jangan dipakai tanpa
 * rincian di UI).
 */
export async function teacherPeriodScore(
  pool: mysql.Pool,
  teacherId: number,
  periodId: number,
): Promise<{ average: number | null; count: number; sessions: SessionSummary[] }> {
  const sessions = (await sessionSummaries(pool, { teacherId, periodId })).filter(
    (s) => s.status === "selesai" && s.final100 !== null,
  );
  const average =
    sessions.length === 0
      ? null
      : sessions.reduce((a, s) => a + (s.final100 as number), 0) / sessions.length;
  return { average, count: sessions.length, sessions };
}

/**
 * Distribusi per indikator dalam satu periode: berapa kali tiap label
 * level muncul di semua sesi selesai guru itu. Dikelompokkan per
 * indikator (teks indikator + elemen), lalu per label.
 */
export async function indicatorDistribution(
  pool: mysql.Pool,
  teacherId: number,
  periodId: number,
): Promise<IndicatorDistribution[]> {
  const [rows] = await pool.query<
    (RowDataPacket & {
      element_code: string;
      element_title: string;
      indicator_text: string;
      label: string;
      value: number;
      count: number;
    })[]
  >(
    `SELECT si.element_code, si.element_title, si.text AS indicator_text,
            sl.label, os.value, COUNT(*) AS count
     FROM sessions s
     JOIN session_indicators si ON si.session_id = s.id
     JOIN observation_scores os ON os.session_id = s.id AND os.session_indicator_id = si.id
     JOIN session_scale_levels sl ON sl.session_id = s.id AND sl.v = os.value
     WHERE s.teacher_id = ? AND s.period_id = ? AND s.status = 'selesai' AND os.value IS NOT NULL
     GROUP BY si.element_code, si.element_title, si.sort, si.text, os.value, sl.label
     ORDER BY si.element_code, si.sort, os.value`,
    [teacherId, periodId],
  );
  return rows.map((r) => ({
    element_code: r.element_code,
    element_title: r.element_title,
    indicator_text: r.indicator_text,
    label: r.label,
    value: Number(r.value),
    count: Number(r.count),
  }));
}

/** Profil lengkap guru untuk satu periode (tren memakai semua periode). */
export async function teacherProfile(
  pool: mysql.Pool,
  teacherId: number,
  periodId: number,
): Promise<{
  teacher: TeacherRow;
  completed: SessionSummary[];
  inProgress: SessionSummary[];
  periodScore: { average: number | null; count: number; sessions: SessionSummary[] };
  distribution: IndicatorDistribution[];
}> {
  const teacher = await loadTeacher(pool, teacherId);
  if (!teacher) throw new Error("Guru tidak ditemukan.");
  const all = await sessionSummaries(pool, { teacherId });
  const completed = all.filter((s) => s.status === "selesai");
  const inProgress = all.filter((s) => s.status !== "selesai");
  const periodScore = await teacherPeriodScore(pool, teacherId, periodId);
  const distribution = await indicatorDistribution(pool, teacherId, periodId);
  return { teacher, completed, inProgress, periodScore, distribution };
}

/**
 * Rekap sekolah per periode (plan bagian 6): rata-rata nilai akhir per
 * elemen di semua sesi selesai, distribusi predikat, dan (hanya bila
 * periode aktif) daftar guru yang belum disupervisi.
 * `scopeIds` membatasi sesi ke guru-guru yang boleh dilihat user
 * (null = semua).
 */
export async function periodRecap(
  pool: mysql.Pool,
  periodId: number,
  scopeIds: number[] | null,
): Promise<{
  period: PeriodRow;
  elementAverages: ElementAverage[];
  predicateDistribution: PredicateCount[];
  averageFinal: number | null;
  completedCount: number;
  sessions: SessionSummary[];
  unsupervised: TeacherRow[] | null;
}> {
  const period = await loadPeriod(pool, periodId);
  if (!period) throw new Error("Periode tidak ditemukan.");
  const scope = scopeClause(scopeIds);
  const completed = (await sessionSummaries(pool, { periodId })).filter(
    (s) => s.status === "selesai" && (scopeIds === null || scopeIds.includes(s.teacher_id)),
  );
  const averageFinal =
    completed.length === 0
      ? null
      : completed.reduce((a, s) => a + (s.final100 as number), 0) / completed.length;

  // Rata-rata per elemen: bobot sama per sesi (rata-rata elemen tiap
  // sesi dinormalisasi ke 0–100, lalu dirata-rata antar sesi).
  const [elRows] = await pool.query<
    (RowDataPacket & { element_code: string; element_title: string; avg100: number; sessions: number })[]
  >(
    `SELECT element_code, element_title, AVG(elem100) AS avg100, COUNT(*) AS sessions
     FROM (
       SELECT s.id AS sid, si.element_code, si.element_title,
              AVG(os.value / (SELECT MAX(v) FROM session_scale_levels WHERE session_id = s.id) * 100) AS elem100
       FROM sessions s
       JOIN session_indicators si ON si.session_id = s.id
       JOIN observation_scores os ON os.session_id = s.id AND os.session_indicator_id = si.id
       WHERE s.period_id = ? AND s.status = 'selesai' AND os.value IS NOT NULL ${scope.sql}
       GROUP BY s.id, si.element_code, si.element_title
     ) t
     GROUP BY element_code, element_title
     ORDER BY element_code`,
    [periodId, ...scope.params],
  );
  const elementAverages: ElementAverage[] = elRows.map((r) => ({
    element_code: r.element_code,
    element_title: r.element_title,
    avg100: Number(r.avg100),
    sessions: Number(r.sessions),
  }));

  const predMap = new Map<string, number>();
  for (const s of completed) predMap.set(s.predicate, (predMap.get(s.predicate) ?? 0) + 1);
  const predicateDistribution: PredicateCount[] = [...predMap.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);

  // Daftar belum disupervisi hanya untuk periode AKTIF: guru aktif yang
  // belum punya satu sesi pun (status apa pun) pada periode itu.
  let unsupervised: TeacherRow[] | null = null;
  if (period.is_active === 1) {
    const [rows] = await pool.query<(RowDataPacket & TeacherRow)[]>(
      `SELECT u.id, u.username, u.name, u.nip FROM users u
       WHERE u.role = 'guru' AND u.active = 1
         AND u.id NOT IN (SELECT DISTINCT teacher_id FROM sessions WHERE period_id = ?)
         ${scopeIds === null ? "" : `AND u.id IN (${scopeIds.length > 0 ? scopeIds.map(() => "?").join(",") : "NULL"})`}
       ORDER BY u.name`,
      scopeIds === null ? [periodId] : [periodId, ...scopeIds],
    );
    unsupervised = rows as TeacherRow[];
  }
  return {
    period,
    elementAverages,
    predicateDistribution,
    averageFinal,
    completedCount: completed.length,
    sessions: completed,
    unsupervised,
  };
}

/** Apakah user boleh melihat rekap kelas ini? */
export async function canViewClassRecap(
  pool: mysql.Pool,
  user: SessionUser,
  classId: number,
): Promise<boolean> {
  if (user.role === "admin" || user.is_principal) return true;
  const [rows] = await pool.query<(RowDataPacket & { teacher_id: number })[]>(
    "SELECT DISTINCT teacher_id FROM sessions WHERE class_id = ?",
    [classId],
  );
  if (rows.length === 0) return false; // admin/Kepsek sudah lolos di atas; tanpa sesi, tidak ada yang bisa dilihat
  if (rows.some((r) => r.teacher_id === user.id)) return true;
  if (isSupervisor(user)) {
    const ids = await supervisedTeacherIds(pool, user);
    return rows.some((r) => ids.includes(r.teacher_id));
  }
  return false;
}

/**
 * Rekap kelas (plan bagian 6): rata-rata nilai akhir sesi-sesi selesai
 * di kelas itu dalam periodenya — selalu dengan rincian per sesi dan
 * per guru, bukan satu angka tanpa rincian.
 */
export async function classRecap(
  pool: mysql.Pool,
  classId: number,
  scopeIds: number[] | null,
): Promise<{
  className: string;
  period: PeriodRow;
  averageFinal: number | null;
  completedCount: number;
  perTeacher: { teacher_id: number; teacher_name: string; average: number; sessions: SessionSummary[] }[];
  sessions: SessionSummary[];
}> {
  const [crows] = await pool.query<
    (RowDataPacket & { name: string; period_id: number })[]
  >("SELECT name, period_id FROM classes WHERE id = ?", [classId]);
  if (crows.length === 0) throw new Error("Kelas tidak ditemukan.");
  const period = await loadPeriod(pool, crows[0]!.period_id);
  if (!period) throw new Error("Periode kelas tidak ditemukan.");
  const completed = (await sessionSummaries(pool, { classId })).filter(
    (s) => s.status === "selesai" && s.final100 !== null &&
      (scopeIds === null || scopeIds.includes(s.teacher_id)),
  );
  const averageFinal =
    completed.length === 0
      ? null
      : completed.reduce((a, s) => a + (s.final100 as number), 0) / completed.length;
  const byTeacher = new Map<number, { teacher_name: string; sessions: SessionSummary[] }>();
  for (const s of completed) {
    const g = byTeacher.get(s.teacher_id) ?? { teacher_name: s.teacher_name, sessions: [] };
    g.sessions.push(s);
    byTeacher.set(s.teacher_id, g);
  }
  const perTeacher = [...byTeacher.entries()]
    .map(([teacher_id, g]) => ({
      teacher_id,
      teacher_name: g.teacher_name,
      average: g.sessions.reduce((a, s) => a + (s.final100 as number), 0) / g.sessions.length,
      sessions: g.sessions,
    }))
    .sort((a, b) => a.teacher_name.localeCompare(b.teacher_name));
  return {
    className: crows[0]!.name,
    period,
    averageFinal,
    completedCount: completed.length,
    perTeacher,
    sessions: completed,
  };
}

// ---------- Grafik tren SVG (murni, tanpa pustaka eksternal) ----------

export type TrendPoint = { date: string; score100: number; label: string };

/**
 * Grafik tren SVG: sumbu-x tanggal observasi, sumbu-y skor 0–100,
 * satu titik per sesi selesai. Label tema + nilai ada di <title> tiap
 * titik (terlihat saat diarahkan). Satu titik → lingkaran tanpa garis.
 */
export function trendSvg(points: TrendPoint[]): string {
  const W = 720;
  const H = 280;
  const padL = 44;
  const padR = 16;
  const padT = 16;
  const padB = 36;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const y = (v: number) => padT + plotH * (1 - v / 100);
  const x = (i: number) =>
    points.length === 1 ? padL + plotW / 2 : padL + (plotW * i) / (points.length - 1);
  const grid = [0, 25, 50, 75, 100]
    .map(
      (v) =>
        `<line x1="${padL}" y1="${y(v)}" x2="${W - padR}" y2="${y(v)}" stroke="#e2e8f0" stroke-width="1"/>` +
        `<text x="${padL - 8}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="#64748b">${v}</text>`,
    )
    .join("");
  const line =
    points.length > 1
      ? `<polyline points="${points.map((p, i) => `${x(i)},${y(p.score100)}`).join(" ")}" fill="none" stroke="#0d9488" stroke-width="2.5"/>`
      : "";
  const dots = points
    .map(
      (p, i) =>
        `<circle cx="${x(i)}" cy="${y(p.score100)}" r="6" fill="#0d9488" stroke="#fff" stroke-width="2"><title>${esc(p.label)}</title></circle>` +
        `<text x="${x(i)}" y="${y(p.score100) - 12}" text-anchor="middle" font-size="11" font-weight="600" fill="#0f766e">${p.score100.toFixed(1)}</text>` +
        `<text x="${x(i)}" y="${H - 12}" text-anchor="middle" font-size="11" fill="#64748b">${esc(p.date)}</text>`,
    )
    .join("");
  return `<svg viewBox="0 0 ${W} ${H}" class="w-full h-auto" role="img" aria-label="Grafik tren skor supervisi">${grid}${line}${dots}</svg>`;
}
