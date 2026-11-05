import type mysql from "mysql2/promise";
import type { RowDataPacket } from "mysql2/promise";
import type { SessionUser } from "../auth";
import { audit, loadSession, loadSnapshot } from "./sessions";
import { elementScores, finalScore100, mostFrequentLabel, predicateFor } from "./scores";

/**
 * Generator + editor narasi — Fase 3 (plan bagian 6, 7, 8).
 *
 * - Narasi disusun otomatis dari data sesi: skor per elemen (terkuat +
 *   yang perlu penguatan), predikat, label skala yang paling sering
 *   muncul, serta catatan bukti, refleksi pasca, dan tindak lanjut.
 *   Kalimat memakai label apa adanya; tidak ada capaian yang dikarang.
 * - Bila sesi belum lengkap (belum semua indikator berskor), generator
 *   mengembalikan teks jujur bahwa sesi belum selesai — bukan narasi
 *   karangan.
 * - Narasi yang sudah diedit supervisor disimpan di report_narratives
 *   dan TIDAK ditimpa regenerasi otomatis; hanya tombol "Buat ulang
 *   narasi" yang menimpa secara eksplisit.
 * - Narasi masih bisa diedit sesudah sesi 'selesai' (plan bagian 7);
 *   perubahan itu dicatat di audit log.
 */

export type NarrativeInput = {
  teacherName: string;
  subjectTheme: string | null;
  observedAt: string;
  indicators: { element_code: string; element_title: string; value: number | null }[];
  scaleLevels: { v: number; label: string }[];
  predicates: { min: number; max: number; label: string }[];
  evidenceNotes: string[];
  guruReflections: string[];
  rtlNotes: string[];
};

export type StoredNarrative = {
  narrative: string;
  edited_by: number | null;
  updated_at: string;
};

const MAX_NARRATIVE_CHARS = 10000;

/** Potong kutipan agar narasi tetap ringkas; tambah "…" bila dipotong. */
function quote(text: string, max = 200): string {
  const t = text.trim().replace(/\s+/g, " ");
  if (t.length <= max) return t;
  return `${t.slice(0, max).trimEnd()}…`;
}

/**
 * Susun narasi dari data sesi (fungsi murni — mudah diuji).
 * Tidak pernah mengarang capaian: setiap kalimat bersumber pada angka
 * atau catatan yang memang ada di sesi itu.
 */
export function generateNarrative(input: NarrativeInput): string {
  const total = input.indicators.length;
  const filled = input.indicators.filter((i) => i.value !== null).length;
  const final = finalScore100(input.indicators, input.scaleLevels);
  const tema = input.subjectTheme?.trim() ? ` ${input.subjectTheme.trim()}` : "";

  if (total === 0 || filled < total || final === null) {
    return (
      `Sesi supervisi ${input.teacherName} pada ${input.observedAt} belum selesai ` +
      `(${filled} dari ${total} indikator sudah berskor), sehingga narasi hasil belum dapat disusun. ` +
      `Lengkapi skor seluruh indikator, refleksi guru, dan rencana tindak lanjut terlebih dahulu.`
    );
  }

  const predikat = predicateFor(final, input.predicates);
  const perElement = elementScores(input.indicators);
  const scored = perElement.filter((e) => e.average !== null);
  const sorted = [...scored].sort((a, b) => (b.average as number) - (a.average as number));
  const strongest = sorted[0];
  const weakest = sorted[sorted.length - 1];
  const scaleMax = Math.max(...input.scaleLevels.map((l) => l.v));
  const freqLabel = mostFrequentLabel(input.indicators, input.scaleLevels);

  const lines: string[] = [];
  lines.push(
    `Pada ${input.observedAt}, ${input.teacherName} melaksanakan pembelajaran${tema}. ` +
      `Nilai akhir supervisi ${final.toFixed(1)} dari 100 dengan predikat ${predikat}.`,
  );

  if (strongest && weakest) {
    const avg100 = (v: number) => ((v / scaleMax) * 100).toFixed(1);
    if (strongest.average === weakest.average) {
      lines.push(
        `Semua elemen memperoleh rata-rata yang sama, yaitu ${strongest.average!.toFixed(2)} dari ${scaleMax} ` +
          `(${avg100(strongest.average!)} dari 100).`,
      );
    } else {
      lines.push(
        `Elemen terkuat adalah ${strongest.element_title} (rata-rata ${strongest.average!.toFixed(2)} dari ${scaleMax}, ` +
          `atau ${avg100(strongest.average!)} dari 100), sedangkan elemen yang perlu ditumbuhkan adalah ` +
          `${weakest.element_title} (rata-rata ${weakest.average!.toFixed(2)} dari ${scaleMax}, ` +
          `atau ${avg100(weakest.average!)} dari 100).`,
      );
    }
  }
  if (freqLabel) {
    lines.push(`Label yang paling sering muncul pada observasi ini adalah “${freqLabel}”.`);
  }
  if (input.guruReflections.length > 0) {
    lines.push(
      `Dalam refleksi pasca-observasi, guru menyampaikan antara lain: “${quote(input.guruReflections[0]!)}”.`,
    );
  }
  if (input.evidenceNotes.length > 0) {
    lines.push(
      `Bukti yang dicatat selama observasi antara lain: “${quote(input.evidenceNotes[0]!)}”.`,
    );
  }
  const rtl = input.rtlNotes.filter((n) => n.trim() !== "");
  if (rtl.length > 0) {
    lines.push(
      `Rencana tindak lanjut yang disepakati: ${rtl.map((n, i) => `${i + 1}) ${n.trim()}`).join("; ")}.`,
    );
  }
  return lines.join(" ");
}

/** Kumpulkan data sesi menjadi NarrativeInput (dari snapshot Fase 2). */
export async function buildNarrativeInput(
  pool: mysql.Pool,
  sessionId: number,
): Promise<NarrativeInput> {
  const s = await loadSession(pool, sessionId);
  if (!s) throw new Error("Sesi tidak ditemukan.");
  const [detailRows] = await pool.query<(RowDataPacket & { name: string })[]>(
    "SELECT name FROM users WHERE id = ?",
    [s.teacher_id],
  );
  const snap = await loadSnapshot(pool, sessionId);
  return {
    teacherName: detailRows[0]?.name ?? "Guru",
    subjectTheme: s.subject_theme,
    observedAt: s.observed_at,
    indicators: snap.elements.flatMap((el) => el.indicators),
    scaleLevels: snap.scaleLevels,
    predicates: snap.predicates,
    evidenceNotes: snap.elements
      .flatMap((el) => el.indicators.map((i) => i.evidence))
      .filter((e) => e.trim() !== ""),
    guruReflections: snap.pascaQuestions.map((q) => q.guru_note).filter((n) => n.trim() !== ""),
    rtlNotes: snap.rtlItems.map((r) => r.note),
  };
}

export async function getStoredNarrative(
  pool: mysql.Pool,
  sessionId: number,
): Promise<StoredNarrative | null> {
  const [rows] = await pool.query<(RowDataPacket & StoredNarrative)[]>(
    "SELECT narrative, edited_by, updated_at FROM report_narratives WHERE session_id = ?",
    [sessionId],
  );
  return (rows[0] as StoredNarrative | undefined) ?? null;
}

/**
 * Narasi untuk ditampilkan: yang tersimpan bila ada (sudah diedit),
 * kalau tidak ada → hasil generator otomatis dari data terkini.
 * Regenerasi otomatis tidak pernah menimpa narasi tersimpan.
 */
export async function getNarrativeForDisplay(
  pool: mysql.Pool,
  sessionId: number,
): Promise<{ text: string; edited: boolean }> {
  const stored = await getStoredNarrative(pool, sessionId);
  if (stored) return { text: stored.narrative, edited: true };
  const input = await buildNarrativeInput(pool, sessionId);
  return { text: generateNarrative(input), edited: false };
}

/**
 * Apakah user boleh mengedit narasi sesi ini? Hanya supervisor pembuat
 * sesi — termasuk sesudah sesi 'selesai' (plan bagian 7). Guru hanya
 * membaca; supervisor lain dan admin tidak mengedit.
 */
export function canEditNarrative(user: SessionUser, session: { supervisor_id: number }): boolean {
  return user.role === "supervisor" && session.supervisor_id === user.id;
}

/** Simpan narasi hasil edit supervisor. Menolak bila bukan pembuat sesi. */
export async function saveNarrative(
  pool: mysql.Pool,
  user: SessionUser,
  sessionId: number,
  text: string,
): Promise<void> {
  const session = await loadSession(pool, sessionId);
  if (!session) throw new Error("Sesi tidak ditemukan.");
  if (!canEditNarrative(user, session)) {
    throw new Error("Hanya supervisor pembuat sesi yang bisa mengedit narasi.");
  }
  if (session.status !== "tindak_lanjut" && session.status !== "selesai") {
    throw new Error("Narasi baru bisa diedit pada tahap tindak lanjut atau sesudah sesi selesai.");
  }
  const clean = text.trim();
  if (clean === "") throw new Error("Narasi tidak boleh kosong.");
  if (clean.length > MAX_NARRATIVE_CHARS) {
    throw new Error(`Narasi terlalu panjang (maks ${MAX_NARRATIVE_CHARS} karakter).`);
  }
  await pool.query(
    `INSERT INTO report_narratives (session_id, narrative, edited_by)
     VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE narrative = VALUES(narrative), edited_by = VALUES(edited_by)`,
    [sessionId, clean, user.id],
  );
  await audit(
    pool,
    user.id,
    session.status === "selesai" ? "narrative.edit_after_complete" : "narrative.edit",
    "report_narratives",
    sessionId,
    { chars: clean.length },
  );
}

/**
 * "Buat ulang narasi": susun ulang dari data sesi saat ini dan simpan,
 * menimpa narasi hasil edit sebelumnya. Hanya supervisor pembuat sesi.
 */
export async function regenerateNarrative(
  pool: mysql.Pool,
  user: SessionUser,
  sessionId: number,
): Promise<string> {
  const session = await loadSession(pool, sessionId);
  if (!session) throw new Error("Sesi tidak ditemukan.");
  if (!canEditNarrative(user, session)) {
    throw new Error("Hanya supervisor pembuat sesi yang bisa membuat ulang narasi.");
  }
  if (session.status !== "tindak_lanjut" && session.status !== "selesai") {
    throw new Error("Narasi baru bisa dibuat ulang pada tahap tindak lanjut atau sesudah sesi selesai.");
  }
  const input = await buildNarrativeInput(pool, sessionId);
  const text = generateNarrative(input);
  await pool.query(
    `INSERT INTO report_narratives (session_id, narrative, edited_by)
     VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE narrative = VALUES(narrative), edited_by = VALUES(edited_by)`,
    [sessionId, text, user.id],
  );
  await audit(
    pool,
    user.id,
    session.status === "selesai" ? "narrative.regenerate_after_complete" : "narrative.regenerate",
    "report_narratives",
    sessionId,
    { chars: text.length },
  );
  return text;
}
