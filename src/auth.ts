import { createHash, randomBytes } from "node:crypto";
import type mysql from "mysql2/promise";
import type { RowDataPacket } from "mysql2/promise";

export type Role = "admin" | "supervisor" | "guru";

export type SessionUser = {
  id: number;
  username: string;
  name: string;
  nip: string | null;
  role: Role;
  is_principal: boolean;
  must_change_password: boolean;
  active: boolean;
};

export const SESSION_COOKIE = "spv_session";
export const SESSION_DAYS = 30;

export async function hashPassword(plain: string): Promise<string> {
  return Bun.password.hash(plain, { algorithm: "argon2id" });
}

export async function verifyPassword(
  plain: string,
  hash: string,
): Promise<boolean> {
  try {
    return await Bun.password.verify(plain, hash);
  } catch {
    return false;
  }
}

function sha256(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Buat sesi login, kembalikan token mentah (hanya ini yang masuk cookie). */
export async function createSession(
  pool: mysql.Pool,
  userId: number,
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await pool.query(
    "INSERT INTO user_sessions (user_id, token_hash, expires_at) VALUES (?, ?, ?)",
    [userId, sha256(token), expiresAt],
  );
  return { token, expiresAt };
}

export async function destroySession(
  pool: mysql.Pool,
  token: string,
): Promise<void> {
  await pool.query("DELETE FROM user_sessions WHERE token_hash = ?", [sha256(token)]);
}

export async function destroyAllSessionsForUser(
  pool: mysql.Pool,
  userId: number,
): Promise<void> {
  await pool.query("DELETE FROM user_sessions WHERE user_id = ?", [userId]);
}

/** Ambil user dari token cookie; null bila tidak ada / kedaluwarsa / nonaktif. */
export async function getSessionUser(
  pool: mysql.Pool,
  token: string | null | undefined,
): Promise<SessionUser | null> {
  if (!token) return null;
  const [rows] = await pool.query<
    (RowDataPacket & {
      id: number;
      username: string;
      name: string;
      nip: string | null;
      role: Role;
      is_principal: number;
      must_change_password: number;
      active: number;
      expires_at: Date;
    })[]
  >(
    `SELECT u.id, u.username, u.name, u.nip, u.role, u.is_principal,
            u.must_change_password, u.active, s.expires_at
     FROM user_sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > NOW()`,
    [sha256(token)],
  );
  const row = rows[0];
  if (!row || !row.active) return null;
  // Perbarui last_seen_at (best-effort, jangan gagalkan login).
  void pool
    .query("UPDATE user_sessions SET last_seen_at = NOW() WHERE token_hash = ?", [
      sha256(token),
    ])
    .catch(() => undefined);
  return {
    id: row.id,
    username: row.username,
    name: row.name,
    nip: row.nip,
    role: row.role,
    is_principal: row.is_principal === 1,
    must_change_password: row.must_change_password === 1,
    active: row.active === 1,
  };
}

/** Verifikasi kredensial login. Mengembalikan user bila cocok & aktif. */
export async function authenticate(
  pool: mysql.Pool,
  username: string,
  password: string,
): Promise<SessionUser | null> {
  const [rows] = await pool.query<
    (RowDataPacket & {
      id: number;
      username: string;
      name: string;
      nip: string | null;
      role: Role;
      is_principal: number;
      must_change_password: number;
      active: number;
      password_hash: string;
    })[]
  >("SELECT * FROM users WHERE username = ?", [username.trim()]);
  const row = rows[0];
  if (!row || !row.active) return null;
  if (!(await verifyPassword(password, row.password_hash))) return null;
  return {
    id: row.id,
    username: row.username,
    name: row.name,
    nip: row.nip,
    role: row.role,
    is_principal: row.is_principal === 1,
    must_change_password: row.must_change_password === 1,
    active: row.active === 1,
  };
}

export function sessionCookie(
  token: string,
  secure: boolean,
): string {
  const parts = [
    `${SESSION_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${SESSION_DAYS * 24 * 60 * 60}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}
