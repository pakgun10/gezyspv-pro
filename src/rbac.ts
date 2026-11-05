import type mysql from "mysql2/promise";
import type { RowDataPacket } from "mysql2/promise";
import type { Role, SessionUser } from "./auth";

/**
 * RBAC Fase 0 (plan bagian 4 & 12).
 * Semua cek dilakukan di server; UI hanya menyembunyikan tautan.
 */

export function isAdmin(user: SessionUser | null): boolean {
  return user?.role === "admin";
}

export function hasRole(user: SessionUser | null, ...roles: Role[]): boolean {
  return !!user && roles.includes(user.role);
}

/**
 * Apakah supervisor boleh membuat sesi untuk guru teacherId?
 * - Kepala Sekolah (is_principal = 1): semua guru.
 * - Supervisor biasa: hanya guru yang ditugaskan padanya
 *   (tabel supervisor_assignments).
 * - Admin/guru: tidak pernah (return false; pembuatan sesi adalah
 *   wewenang supervisor).
 */
export async function canSupervise(
  pool: mysql.Pool,
  supervisor: SessionUser,
  teacherId: number,
): Promise<boolean> {
  if (supervisor.role !== "supervisor") return false;
  if (supervisor.is_principal) return true;
  const [rows] = await pool.query<(RowDataPacket & { c: number })[]>(
    `SELECT COUNT(*) AS c FROM supervisor_assignments
     WHERE supervisor_id = ? AND teacher_id = ?`,
    [supervisor.id, teacherId],
  );
  return (rows[0]?.c ?? 0) > 0;
}

/** Daftar id guru yang boleh disupervisi oleh supervisor ini. */
export async function supervisedTeacherIds(
  pool: mysql.Pool,
  supervisor: SessionUser,
): Promise<number[]> {
  if (supervisor.role !== "supervisor") return [];
  if (supervisor.is_principal) {
    const [rows] = await pool.query<(RowDataPacket & { id: number })[]>(
      "SELECT id FROM users WHERE role = 'guru' AND active = 1 ORDER BY name",
    );
    return rows.map((r) => r.id);
  }
  const [rows] = await pool.query<(RowDataPacket & { teacher_id: number })[]>(
    "SELECT teacher_id FROM supervisor_assignments WHERE supervisor_id = ?",
    [supervisor.id],
  );
  return rows.map((r) => r.teacher_id);
}

/** Versi murni (tanpa DB) dari aturan penugasan — untuk bun test. */
export function canSupervisePure(
  supervisor: { role: Role; is_principal: boolean },
  assignedTeacherIds: number[],
  teacherId: number,
): boolean {
  if (supervisor.role !== "supervisor") return false;
  if (supervisor.is_principal) return true;
  return assignedTeacherIds.includes(teacherId);
}
