import type mysql from "mysql2/promise";
import type { RowDataPacket } from "mysql2/promise";
import { seedTemplateData } from "./seed-template";
import { KURMER_GROUP, KURMER_TEMPLATES } from "./seed-kurmer-data";

/**
 * Seed kelompok "Instrumen Supervisi Kurikulum Merdeka" (keputusan Pak
 * Gun 2026-11-06, opsi B): 4 templat skala 0–2 dari docx I–IV +
 * satu kelompok yang berisi keempatnya, urutan I–IV.
 *
 * version_label (keputusan Pak Gun 2026-11-06): diambil dari nama
 * periode aktif di /admin/periode (saat ini "2026/2027 Ganjil") —
 * BUKAN hardcode. Dokumen I–IV tidak mencantumkan tahun ajaran, jadi
 * label versi selalu mengikuti periode yang sedang aktif saat seed
 * berjalan. Bila tidak ada periode aktif, fallback "2026/2027".
 *
 * Idempotent: jalan kedua tidak menduplikasi templat maupun kelompok
 * (templat dicocokkan judul + is_seed; kelompok dicocokkan judul;
 * item kelompok di-upsert urutannya). Karena itu seed TIDAK
 * memperbarui templat yang sudah ada — bila periode aktif berganti
 * atau isi data berubah, templat lama harus dihapus dulu (atau
 * pakai database baru) sebelum seed ulang. TIDAK mengubah templat
 * PPB/GM.
 */

/** Fallback version_label bila tidak ada periode aktif saat seed berjalan. */
export const KURMER_VERSION_FALLBACK = "2026/2027";

/**
 * Nama periode aktif (tepat satu — admin mengaturnya di
 * /admin/periode; bila entah bagaimana ada lebih dari satu, yang
 * pertama menurut id dipakai), atau fallback bila tidak ada.
 */
export async function resolveKurmerVersionLabel(pool: mysql.Pool): Promise<string> {
  const [rows] = await pool.query<(RowDataPacket & { name: string })[]>(
    "SELECT name FROM periods WHERE is_active = 1 ORDER BY id LIMIT 1",
  );
  const name = rows[0]?.name?.trim();
  return name ? name : KURMER_VERSION_FALLBACK;
}

export type KurmerSeedCounts = {
  groupId: number;
  groupCreated: boolean;
  versionLabel: string;
  templates: { title: string; id: number; created: boolean; indicators: number }[];
};

export async function seedKurmer(pool: mysql.Pool): Promise<KurmerSeedCounts> {
  const versionLabel = await resolveKurmerVersionLabel(pool);
  const templates: KurmerSeedCounts["templates"] = [];
  for (const t of KURMER_TEMPLATES) {
    const r = await seedTemplateData(pool, { ...t, version_label: versionLabel });
    templates.push({
      title: t.title,
      id: r.id,
      created: r.created,
      indicators: t.elements.reduce((n, e) => n + e.indicators.length, 0),
    });
  }

  const [existing] = await pool.query<(RowDataPacket & { id: number })[]>(
    "SELECT id FROM template_groups WHERE title = ?",
    [KURMER_GROUP.title],
  );
  let groupId: number;
  let groupCreated: boolean;
  if (existing.length > 0) {
    groupId = existing[0]!.id;
    groupCreated = false;
  } else {
    const [res] = await pool.query<mysql.ResultSetHeader>(
      "INSERT INTO template_groups (title, description) VALUES (?, ?)",
      [KURMER_GROUP.title, KURMER_GROUP.description],
    );
    groupId = res.insertId;
    groupCreated = true;
  }

  for (let i = 0; i < templates.length; i++) {
    const tpl = templates[i]!;
    const [other] = await pool.query<(RowDataPacket & { group_id: number })[]>(
      "SELECT group_id FROM template_group_items WHERE template_id = ?",
      [tpl.id],
    );
    if (other[0] && other[0].group_id !== groupId) {
      throw new Error(
        `Templat "${tpl.title}" sudah ada di kelompok lain (id ${other[0].group_id}) — seed dibatalkan.`,
      );
    }
    await pool.query(
      `INSERT INTO template_group_items (group_id, template_id, sort) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE sort = VALUES(sort)`,
      [groupId, tpl.id, i + 1],
    );
  }

  return { groupId, groupCreated, versionLabel, templates };
}
