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
 * Apakah user ini supervisor? Supervisor BUKAN peran tersendiri:
 * akun guru dengan flag is_supervisor, atau Kepala Sekolah
 * (is_principal — Kepsek selalu bisa mensupervisi).
 */
export function isSupervisor(user: SessionUser | null | undefined): boolean {
  if (!user || user.role !== "guru") return false;
  return user.is_supervisor || user.is_principal;
}

/**
 * Apakah supervisor boleh membuat sesi untuk guru teacherId?
 * - Kepala Sekolah (is_principal = 1): semua guru (termasuk supervisor lain).
 * - Supervisor biasa: hanya guru yang ditugaskan padanya
 *   (tabel supervisor_assignments) — termasuk supervisor lain yang
 *   ditugaskan padanya (keputusan Pak Gun 2026-11-05).
 * - Admin/guru biasa: tidak pernah (return false; pembuatan sesi adalah
 *   wewenang supervisor).
 */
export async function canSupervise(
  pool: mysql.Pool | mysql.PoolConnection,
  supervisor: SessionUser,
  teacherId: number,
): Promise<boolean> {
  if (!isSupervisor(supervisor)) return false;
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
  if (!isSupervisor(supervisor)) return [];
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
  supervisor: { role: Role; is_principal: boolean; is_supervisor?: boolean },
  assignedTeacherIds: number[],
  teacherId: number,
): boolean {
  if (!isSupervisor(supervisor as SessionUser)) return false;
  if (supervisor.is_principal) return true;
  return assignedTeacherIds.includes(teacherId);
}
