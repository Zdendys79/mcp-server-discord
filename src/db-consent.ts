// User consent management for voice recording
import mysql from "mysql2/promise";
import { getPool } from "./db.js";

/** Check if user has active permanent consent. */
export async function hasActiveConsent(userId: string): Promise<boolean> {
  const db = getPool();
  const [rows] = await db.execute<mysql.RowDataPacket[]>(
    `SELECT id FROM user_consents
     WHERE user_id = ? AND is_active = TRUE AND consent_type = 'permanent'
     LIMIT 1`,
    [userId]
  );
  return rows.length > 0;
}

/** Check if user has consent for specific session (permanent or one-time). */
export async function hasSessionConsent(
  userId: string,
  sessionId: number
): Promise<boolean> {
  const db = getPool();
  const [rows] = await db.execute<mysql.RowDataPacket[]>(
    `SELECT id FROM user_consents
     WHERE user_id = ? AND is_active = TRUE
       AND (consent_type = 'permanent' OR session_id = ?)
     LIMIT 1`,
    [userId, sessionId]
  );
  return rows.length > 0;
}

/** Grant recording consent. */
export async function grantConsent(params: {
  user_id: string;
  user_name: string;
  consent_type: "one_time" | "permanent";
  guild_id?: string;
  channel_id?: string;
  session_id?: number;
}): Promise<number> {
  const db = getPool();
  const [result] = await db.execute<mysql.ResultSetHeader>(
    `INSERT INTO user_consents (user_id, user_name, consent_type, guild_id, channel_id, session_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      params.user_id,
      params.user_name,
      params.consent_type,
      params.guild_id || null,
      params.channel_id || null,
      params.session_id || null,
    ]
  );
  return result.insertId;
}

/** Revoke all active consents for a user. */
export async function revokeConsent(userId: string): Promise<number> {
  const db = getPool();
  const [result] = await db.execute<mysql.ResultSetHeader>(
    `UPDATE user_consents SET is_active = FALSE, revoked_at = NOW()
     WHERE user_id = ? AND is_active = TRUE`,
    [userId]
  );
  return result.affectedRows;
}

/** Revoke one-time consents for a specific session. */
export async function revokeSessionConsents(
  sessionId: number
): Promise<number> {
  const db = getPool();
  const [result] = await db.execute<mysql.ResultSetHeader>(
    `UPDATE user_consents SET is_active = FALSE, revoked_at = NOW()
     WHERE session_id = ? AND consent_type = 'one_time' AND is_active = TRUE`,
    [sessionId]
  );
  return result.affectedRows;
}
