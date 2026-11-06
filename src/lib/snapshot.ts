import type mysql from "mysql2/promise";
import type { RowDataPacket } from "mysql2/promise";
import { loadTemplateDetail } from "./templates";

/**
 * Snapshot instrumen — Fase 1 (plan bagian 1 keputusan 7, bagian 5).
 *
 * Menyalin seluruh isi templat ke tabel session_* untuk sebuah sesi.
 * Skor dan catatan selalu merujuk ke snapshot, sehingga edit templat
 * belakangan tidak pernah mengubah riwayat supervisi yang sudah ada.
 *
 * Idempotent untuk satu sesi: snapshot lama sesi itu (bila ada)
 * dihapus dulu di dalam transaksi yang sama, lalu ditulis ulang.
 * UI pembuatan sesi baru adalah Fase 2; fungsi ini dipakai tes Fase 1
 * dan nanti route pembuatan sesi.
 */

export type SnapshotCounts = {
  principles: number;
  indicators: number;
  scaleLevels: number;
  questions: number;
  predicates: number;
  rtlItems: number;
};

export async function snapshotTemplateForSession(
  pool: mysql.Pool | mysql.PoolConnection,
  sessionId: number,
): Promise<SnapshotCounts> {
  const [sessions] = await pool.query<
    (RowDataPacket & { id: number; template_id: number | null })[]
  >("SELECT id, template_id FROM sessions WHERE id = ?", [sessionId]);
  const session = sessions[0];
  if (!session) throw new Error("Sesi tidak ditemukan.");
  if (!session.template_id) throw new Error("Sesi ini tidak memakai templat.");
  const detail = await loadTemplateDetail(pool, session.template_id);

  // Bila dipanggil dengan pool: ambil koneksi sendiri + transaksi sendiri
  // (perilaku lama). Bila dipanggil dengan koneksi (mis. dari
  // createGroupSession yang sudah membuka transaksi): jalankan langsung
  // di koneksi itu tanpa begin/commit — transaksi milik pemanggil.
  // JANGAN beginTransaction di koneksi pemanggil: MySQL akan commit
  // implisit transaksi yang sedang berjalan.
  if ("getConnection" in pool) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await writeSnapshot(conn, sessionId, detail);
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  } else {
    await writeSnapshot(pool, sessionId, detail);
  }

  return {
    principles: detail.principles.length,
    indicators: detail.elements.reduce((n, e) => n + e.indicators.length, 0),
    scaleLevels: detail.scaleLevels.length,
    questions: detail.praQuestions.length + detail.pascaQuestions.length,
    predicates: detail.predicates.length,
    rtlItems: detail.rtlItems.length,
  };
}

/** Tulis (atau tulis ulang) seluruh snapshot satu sesi ke executor yang diberi. */
async function writeSnapshot(
  conn: mysql.PoolConnection,
  sessionId: number,
  detail: Awaited<ReturnType<typeof loadTemplateDetail>>,
): Promise<void> {
  // Hapus snapshot lama (bila ada) agar pemanggilan ulang tidak menggandakan.
  for (const table of [
    "session_principles",
    "session_indicators",
    "session_scale_levels",
    "session_questions",
    "session_predicates",
    "session_rtl_items",
  ]) {
    await conn.query(`DELETE FROM ${table} WHERE session_id = ?`, [sessionId]);
  }
  for (const p of detail.principles) {
    await conn.query(
      "INSERT INTO session_principles (session_id, text, sort) VALUES (?, ?, ?)",
      [sessionId, p.text, p.sort],
    );
  }
  for (const el of detail.elements) {
    for (const ind of el.indicators) {
      await conn.query(
        `INSERT INTO session_indicators
           (session_id, source_indicator_id, element_code, element_title, text, sort)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [sessionId, ind.id, el.code, el.title, ind.text, ind.sort],
      );
    }
  }
  for (const lv of detail.scaleLevels) {
    await conn.query(
      "INSERT INTO session_scale_levels (session_id, v, label) VALUES (?, ?, ?)",
      [sessionId, lv.v, lv.label],
    );
  }
  for (const q of [
    ...detail.praQuestions.map((x) => ({ ...x, stage: "pra" })),
    ...detail.pascaQuestions.map((x) => ({ ...x, stage: "pasca" })),
  ]) {
    await conn.query(
      `INSERT INTO session_questions
         (session_id, source_question_id, stage, text, sort)
       VALUES (?, ?, ?, ?, ?)`,
      [sessionId, q.id, q.stage, q.text, q.sort],
    );
  }
  for (const p of detail.predicates) {
    await conn.query(
      `INSERT INTO session_predicates
         (session_id, min_score, max_score, label, sort)
       VALUES (?, ?, ?, ?, ?)`,
      [sessionId, p.min, p.max, p.label, p.sort],
    );
  }
  for (const r of detail.rtlItems) {
    await conn.query(
      `INSERT INTO session_rtl_items
         (session_id, source_rtl_item_id, title, sort)
       VALUES (?, ?, ?, ?)`,
      [sessionId, r.id, r.title, r.sort],
    );
  }
}
