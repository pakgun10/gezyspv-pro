import type mysql from "mysql2/promise";
import type { RowDataPacket } from "mysql2/promise";
import type { SessionUser } from "../auth";
import { isAdmin, isSupervisor } from "../rbac";
import { audit, createSession } from "./sessions";

/**
 * Kelompok templat & supervisi berkelompok (keputusan Pak Gun 2026-11-06,
 * opsi B): satu kelompok berisi beberapa templat (mis. 4 instrumen
 * Kurikulum Merdeka); satu supervisi berkelompok membuat SATU
 * session_group + satu sesi per templat, dengan identitas yang sama.
 * Tiap sesi tetap berjalan dengan alur pra → observasi → pasca →
 * tindak_lanjut → selesai dan snapshot-nya masing-masing; rekap yang
 * sudah ada tetap menghitung per sesi.
 */

export type TemplateGroup = {
  id: number;
  title: string;
  description: string | null;
  created_at: string;
  template_count: number;
};

export type GroupItem = {
  group_id: number;
  template_id: number;
  sort: number;
  template_title: string;
  template_basis: string | null;
  template_scale: number;
  template_status: string;
  indicator_count: number;
};

export type TemplateGroupDetail = {
  id: number;
  title: string;
  description: string | null;
  created_at: string;
  items: GroupItem[];
};

export type SessionGroupRow = {
  id: number;
  group_id: number;
  supervisor_id: number;
  teacher_id: number;
  class_id: number;
  period_id: number;
  subject_theme: string | null;
  phase_semester: string | null;
  observed_at: string;
  observed_time: string | null;
  created_at: string;
};

export type SessionGroupListItem = SessionGroupRow & {
  group_title: string;
  supervisor_name: string;
  teacher_name: string;
  class_name: string;
  session_count: number;
  finished_count: number;
};

/** Daftar kelompok beserta jumlah templatnya. */
export async function listGroups(pool: mysql.Pool): Promise<TemplateGroup[]> {
  const [rows] = await pool.query<(RowDataPacket & TemplateGroup)[]>(
    `SELECT g.*,
            (SELECT COUNT(*) FROM template_group_items WHERE group_id = g.id) AS template_count
     FROM template_groups g ORDER BY g.id`,
  );
  return rows as TemplateGroup[];
}

/** Satu kelompok beserta templat-templatnya (urut sort). */
export async function getGroup(pool: mysql.Pool, id: number): Promise<TemplateGroupDetail | null> {
  const [grows] = await pool.query<(RowDataPacket & { id: number; title: string; description: string | null; created_at: string })[]>(
    "SELECT * FROM template_groups WHERE id = ?",
    [id],
  );
  const g = grows[0];
  if (!g) return null;
  const [items] = await pool.query<(RowDataPacket & GroupItem)[]>(
    `SELECT gi.group_id, gi.template_id, gi.sort,
            t.title AS template_title, t.basis AS template_basis,
            t.score_scale AS template_scale, t.status AS template_status,
            (SELECT COUNT(*) FROM template_indicators ti
             JOIN template_elements te ON te.id = ti.element_id
             WHERE te.template_id = t.id) AS indicator_count
     FROM template_group_items gi
     JOIN templates t ON t.id = gi.template_id
     WHERE gi.group_id = ?
     ORDER BY gi.sort, gi.template_id`,
    [id],
  );
  return { id: g.id, title: g.title, description: g.description, created_at: g.created_at, items: items as GroupItem[] };
}

export async function createGroup(
  pool: mysql.Pool,
  title: string,
  description: string,
): Promise<number> {
  const t = title.trim();
  if (!t) throw new Error("Nama kelompok wajib diisi.");
  const [res] = await pool.query<mysql.ResultSetHeader>(
    "INSERT INTO template_groups (title, description) VALUES (?, ?)",
    [t, description.trim() || null],
  );
  return res.insertId;
}

export async function updateGroup(
  pool: mysql.Pool,
  id: number,
  title: string,
  description: string,
): Promise<void> {
  const t = title.trim();
  if (!t) throw new Error("Nama kelompok wajib diisi.");
  await pool.query("UPDATE template_groups SET title = ?, description = ? WHERE id = ?", [
    t,
    description.trim() || null,
    id,
  ]);
}

/**
 * Hapus kelompok. Ditolak bila kelompok sudah pernah dipakai membuat
 * supervisi berkelompok (riwayat session_groups harus utuh).
 */
export async function deleteGroup(pool: mysql.Pool, id: number): Promise<void> {
  const [used] = await pool.query<(RowDataPacket & { c: number })[]>(
    "SELECT COUNT(*) AS c FROM session_groups WHERE group_id = ?",
    [id],
  );
  if ((used[0]?.c ?? 0) > 0) {
    throw new Error("Kelompok ini sudah dipakai membuat supervisi berkelompok dan tidak boleh dihapus.");
  }
  await pool.query("DELETE FROM template_groups WHERE id = ?", [id]);
}

/**
 * Masukkan templat ke kelompok. Hanya templat aktif; satu templat hanya
 * boleh ada di satu kelompok.
 */
export async function addTemplateToGroup(
  pool: mysql.Pool,
  groupId: number,
  templateId: number,
): Promise<void> {
  const [tpl] = await pool.query<(RowDataPacket & { id: number; title: string; status: string })[]>(
    "SELECT id, title, status FROM templates WHERE id = ?",
    [templateId],
  );
  if (!tpl[0]) throw new Error("Templat tidak ditemukan.");
  if (tpl[0].status !== "aktif") {
    throw new Error(`Templat "${tpl[0].title}" berstatus ${tpl[0].status} dan tidak bisa masuk kelompok. Aktifkan dulu.`);
  }
  const [other] = await pool.query<(RowDataPacket & { group_id: number; title: string })[]>(
    `SELECT gi.group_id, g.title FROM template_group_items gi
     JOIN template_groups g ON g.id = gi.group_id
     WHERE gi.template_id = ?`,
    [templateId],
  );
  if (other[0] && other[0].group_id !== groupId) {
    throw new Error(`Templat ini sudah ada di kelompok "${other[0].title}". Satu templat hanya boleh ada di satu kelompok.`);
  }
  const [maxSort] = await pool.query<(RowDataPacket & { m: number | null })[]>(
    "SELECT MAX(sort) AS m FROM template_group_items WHERE group_id = ?",
    [groupId],
  );
  await pool.query(
    `INSERT INTO template_group_items (group_id, template_id, sort) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE sort = VALUES(sort)`,
    [groupId, templateId, (maxSort[0]?.m ?? 0) + 1],
  );
}

export async function removeTemplateFromGroup(
  pool: mysql.Pool,
  groupId: number,
  templateId: number,
): Promise<void> {
  await pool.query(
    "DELETE FROM template_group_items WHERE group_id = ? AND template_id = ?",
    [groupId, templateId],
  );
}

/** Atur urutan templat di kelompok (daftar id templat sesuai urutan baru). */
export async function reorderGroupItems(
  pool: mysql.Pool,
  groupId: number,
  templateIds: number[],
): Promise<void> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    for (let i = 0; i < templateIds.length; i++) {
      await conn.query(
        "UPDATE template_group_items SET sort = ? WHERE group_id = ? AND template_id = ?",
        [i + 1, groupId, templateIds[i]],
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

export type CreateGroupSessionInput = {
  groupId: number;
  teacherId: number;
  classId: number;
  subject_theme: string;
  phase_semester: string;
  observed_at: string;
  observed_time: string;
};

/**
 * Buat supervisi berkelompok: SATU session_group + satu sesi per templat
 * di kelompok, dalam satu transaksi (gagal di tengah → tidak ada yang
 * tersimpan). Semua validasi dilakukan sebelum ada yang ditulis:
 * supervisor & penugasan & larangan supervisi diri ditegakkan oleh
 * createSession; templat non-aktif menggagalkan dengan menyebut namanya.
 * Mengembalikan id session_group.
 */
export async function createGroupSession(
  pool: mysql.Pool,
  supervisor: SessionUser,
  input: CreateGroupSessionInput,
): Promise<number> {
  if (!isSupervisor(supervisor)) {
    throw new Error("Hanya supervisor yang bisa membuat supervisi berkelompok.");
  }
  if (input.teacherId === supervisor.id) {
    throw new Error("Anda tidak bisa mensupervisi diri sendiri.");
  }
  if (!input.observed_at) throw new Error("Tanggal observasi wajib diisi.");
  const group = await getGroup(pool, input.groupId);
  if (!group) throw new Error("Kelompok templat tidak ditemukan.");
  if (group.items.length === 0) {
    throw new Error(`Kelompok "${group.title}" belum berisi templat.`);
  }
  const nonAktif = group.items.find((it) => it.template_status !== "aktif");
  if (nonAktif) {
    throw new Error(
      `Templat "${nonAktif.template_title}" di kelompok ini berstatus ${nonAktif.template_status} — supervisi berkelompok dibatalkan. Aktifkan templat itu dulu atau keluarkan dari kelompok.`,
    );
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [res] = await conn.query<mysql.ResultSetHeader>(
      `INSERT INTO session_groups
         (group_id, supervisor_id, teacher_id, class_id, period_id,
          subject_theme, phase_semester, observed_at, observed_time)
       SELECT ?, ?, ?, ?, period_id, ?, ?, ?, ?
       FROM classes WHERE id = ?`,
      [
        input.groupId,
        supervisor.id,
        input.teacherId,
        input.classId,
        input.subject_theme.trim(),
        input.phase_semester.trim(),
        input.observed_at,
        input.observed_time.trim(),
        input.classId,
      ],
    );
    const sessionGroupId = res.insertId;
    if (!sessionGroupId) throw new Error("Kelas tidak ditemukan.");
    for (const item of group.items) {
      await createSession(conn, supervisor, {
        templateId: item.template_id,
        teacherId: input.teacherId,
        classId: input.classId,
        subject_theme: input.subject_theme,
        phase_semester: input.phase_semester,
        observed_at: input.observed_at,
        observed_time: input.observed_time,
        sessionGroupId,
      });
    }
    await audit(conn, supervisor.id, "session_group.create", "session_groups", sessionGroupId, {
      group_id: input.groupId,
      teacher_id: input.teacherId,
      class_id: input.classId,
      sessions: group.items.length,
    });
    await conn.commit();
    return sessionGroupId;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/** Apakah user boleh MELIHAT kelompok sesi ini? Sama dengan aturan sesi: admin, Kepsek, pembuat, yang disupervisi. Supervisor lain tidak. */
export function canViewSessionGroup(user: SessionUser, g: SessionGroupRow): boolean {
  return (
    isAdmin(user) ||
    user.is_principal ||
    user.id === g.supervisor_id ||
    user.id === g.teacher_id
  );
}

export async function loadSessionGroup(
  pool: mysql.Pool,
  id: number,
): Promise<SessionGroupRow | null> {
  const [rows] = await pool.query<(RowDataPacket & SessionGroupRow)[]>(
    "SELECT * FROM session_groups WHERE id = ?",
    [id],
  );
  return (rows[0] as SessionGroupRow | undefined) ?? null;
}

/** Daftar kelompok sesi yang boleh dilihat user (untuk dasbor). */
export async function listSessionGroupsForUser(
  pool: mysql.Pool,
  user: SessionUser,
): Promise<SessionGroupListItem[]> {
  const all = user.role === "admin" || user.is_principal;
  const where = all ? "" : "WHERE sg.supervisor_id = ? OR sg.teacher_id = ?";
  const params = all ? [] : [user.id, user.id];
  const [rows] = await pool.query<(RowDataPacket & SessionGroupListItem)[]>(
    `SELECT sg.*,
            g.title AS group_title,
            sup.name AS supervisor_name,
            t.name AS teacher_name,
            c.name AS class_name,
            (SELECT COUNT(*) FROM sessions WHERE session_group_id = sg.id) AS session_count,
            (SELECT COUNT(*) FROM sessions WHERE session_group_id = sg.id AND status = 'selesai') AS finished_count
     FROM session_groups sg
     JOIN template_groups g ON g.id = sg.group_id
     JOIN users sup ON sup.id = sg.supervisor_id
     JOIN users t ON t.id = sg.teacher_id
     JOIN classes c ON c.id = sg.class_id
     ${where}
     ORDER BY sg.observed_at DESC, sg.id DESC`,
    params,
  );
  return rows as SessionGroupListItem[];
}
