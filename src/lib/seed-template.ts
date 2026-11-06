import type mysql from "mysql2/promise";
import type { RowDataPacket } from "mysql2/promise";
import type { ScoreScale } from "./templates";

/**
 * Bentuk data seed satu templat (dipakai seed PPB/GM di seed.ts dan
 * seed Kurikulum Merdeka di seed-kurmer.ts). `principles` dan
 * `pra_questions` boleh kosong — templat KurMer tidak punya keduanya.
 */
export type TemplateSeedData = {
  title: string;
  basis: string;
  /**
   * Label versi (mis. tahun ajaran). Opsional: templat KurMer tidak
   * membawanya di data — version_label diisi saat seed dari nama
   * periode aktif (lihat resolveKurmerVersionLabel di seed-kurmer.ts).
   * Bila tidak diisi, yang tersimpan NULL.
   */
  version_label?: string;
  score_scale: ScoreScale;
  scale_levels: { v: number; label: string }[];
  principles?: string[];
  elements: { code: string; title: string; indicators: string[] }[];
  pra_questions?: string[];
  pasca_questions?: string[];
  rtl_items?: string[];
  predicates: { min: number; max: number; label: string }[];
};

/**
 * Sisipkan satu templat seed (status aktif, is_seed = 1) beserta
 * seluruh anaknya dalam satu transaksi. Idempotent: bila templat
 * dengan judul yang sama sudah ada sebagai seed, tidak ada yang
 * disisipkan dan id yang sudah ada dikembalikan.
 */
export async function seedTemplateData(
  pool: mysql.Pool,
  data: TemplateSeedData,
): Promise<{ id: number; created: boolean }> {
  const [existing] = await pool.query<(RowDataPacket & { id: number })[]>(
    "SELECT id FROM templates WHERE title = ? AND is_seed = 1",
    [data.title],
  );
  if (existing.length > 0) return { id: existing[0]!.id, created: false };

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [res] = await conn.query<mysql.ResultSetHeader>(
      `INSERT INTO templates (title, basis, version_label, score_scale, status, is_seed)
       VALUES (?, ?, ?, ?, 'aktif', 1)`,
      [data.title, data.basis, data.version_label ?? null, data.score_scale],
    );
    const templateId = res.insertId;
    for (let i = 0; i < (data.principles ?? []).length; i++) {
      await conn.query(
        "INSERT INTO template_principles (template_id, text, sort) VALUES (?, ?, ?)",
        [templateId, data.principles![i], i + 1],
      );
    }
    for (let e = 0; e < data.elements.length; e++) {
      const el = data.elements[e]!;
      const [elRes] = await conn.query<mysql.ResultSetHeader>(
        "INSERT INTO template_elements (template_id, code, title, sort) VALUES (?, ?, ?, ?)",
        [templateId, el.code, el.title, e + 1],
      );
      for (let i = 0; i < el.indicators.length; i++) {
        await conn.query(
          "INSERT INTO template_indicators (element_id, text, sort) VALUES (?, ?, ?)",
          [elRes.insertId, el.indicators[i], i + 1],
        );
      }
    }
    for (const lv of data.scale_levels) {
      await conn.query(
        "INSERT INTO template_scale_levels (template_id, v, label) VALUES (?, ?, ?)",
        [templateId, lv.v, lv.label],
      );
    }
    const allQuestions = [
      ...(data.pra_questions ?? []).map((t) => ({ stage: "pra", text: t })),
      ...(data.pasca_questions ?? []).map((t) => ({ stage: "pasca", text: t })),
    ];
    for (let i = 0; i < allQuestions.length; i++) {
      await conn.query(
        "INSERT INTO template_questions (template_id, stage, text, sort) VALUES (?, ?, ?, ?)",
        [templateId, allQuestions[i]!.stage, allQuestions[i]!.text, i + 1],
      );
    }
    for (let i = 0; i < (data.rtl_items ?? []).length; i++) {
      await conn.query(
        "INSERT INTO template_rtl_items (template_id, title, sort) VALUES (?, ?, ?)",
        [templateId, data.rtl_items![i], i + 1],
      );
    }
    for (let i = 0; i < data.predicates.length; i++) {
      const p = data.predicates[i]!;
      await conn.query(
        "INSERT INTO template_predicates (template_id, min_score, max_score, label, sort) VALUES (?, ?, ?, ?, ?)",
        [templateId, p.min, p.max, p.label, i + 1],
      );
    }
    await conn.commit();
    return { id: templateId, created: true };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}
