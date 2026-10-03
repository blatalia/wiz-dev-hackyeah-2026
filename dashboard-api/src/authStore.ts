import { pool } from "./db";

export type User = { id: string; email: string; passwordHash: string };
export type RefreshTokenRow = { id: string; userId: string; expiresAt: Date; revoked: boolean };

export interface AuthStore {
  findUserByEmail(email: string): Promise<User | null>;
  findUserById(id: string): Promise<User | null>;
  getUserRoles(userId: string): Promise<string[]>;
  createRefreshToken(userId: string, expiresAt: Date): Promise<string>;
  findRefreshToken(id: string): Promise<RefreshTokenRow | null>;
  revokeRefreshToken(id: string): Promise<void>;
}

function toUser(row: any): User | null {
  return row ? { id: row.id, email: row.email, passwordHash: row.password_hash } : null;
}

export class PostgresAuthStore implements AuthStore {
  async findUserByEmail(email: string) {
    const { rows } = await pool.query(
      "SELECT id, email, password_hash FROM users WHERE email = $1", [email]);
    return toUser(rows[0]);
  }

  async findUserById(id: string) {
    const { rows } = await pool.query(
      "SELECT id, email, password_hash FROM users WHERE id = $1", [id]);
    return toUser(rows[0]);
  }

  async getUserRoles(userId: string) {
    const { rows } = await pool.query(
      "SELECT role FROM user_roles WHERE user_id = $1", [userId]);
    return rows.map((r) => r.role as string);
  }

  async createRefreshToken(userId: string, expiresAt: Date) {
    const { rows } = await pool.query(
      "INSERT INTO refresh_tokens (user_id, expires_at) VALUES ($1, $2) RETURNING id",
      [userId, expiresAt]);
    return rows[0].id as string;
  }

  async findRefreshToken(id: string) {
    const { rows } = await pool.query(
      "SELECT id, user_id, expires_at, revoked FROM refresh_tokens WHERE id = $1", [id]);
    const r = rows[0];
    return r ? { id: r.id, userId: r.user_id, expiresAt: r.expires_at, revoked: r.revoked } : null;
  }

  async revokeRefreshToken(id: string) {
    await pool.query("UPDATE refresh_tokens SET revoked = true WHERE id = $1", [id]);
  }
}
