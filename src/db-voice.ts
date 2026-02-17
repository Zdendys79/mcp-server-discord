// Voice session and chunk database operations
import mysql from "mysql2/promise";
import { getPool } from "./db.js";

/** Create a new voice recording session. */
export async function createVoiceSession(params: {
  guild_id: string;
  channel_id: string;
  channel_name: string | null;
}): Promise<number> {
  const db = getPool();
  const [result] = await db.execute<mysql.ResultSetHeader>(
    `INSERT INTO voice_sessions (guild_id, channel_id, channel_name) VALUES (?, ?, ?)`,
    [params.guild_id, params.channel_id, params.channel_name]
  );
  return result.insertId;
}

/** End a voice recording session and update stats. */
export async function endVoiceSession(sessionId: number): Promise<void> {
  const db = getPool();
  await db.execute(
    `UPDATE voice_sessions SET status = 'ended', ended_at = NOW(),
       total_chunks = (SELECT COUNT(*) FROM voice_chunks WHERE session_id = ?),
       total_transcribed = (SELECT COUNT(*) FROM voice_chunks WHERE session_id = ? AND status = 'transcribed')
     WHERE id = ?`,
    [sessionId, sessionId, sessionId]
  );
}

/** Insert a voice chunk record and increment session counter. */
export async function insertVoiceChunk(params: {
  session_id: number;
  speaker_id: string;
  speaker_name: string;
  speaker_display_name: string | null;
  filename: string;
  duration_ms: number | null;
  file_size: number | null;
}): Promise<number> {
  const db = getPool();
  const [result] = await db.execute<mysql.ResultSetHeader>(
    `INSERT INTO voice_chunks (session_id, speaker_id, speaker_name, speaker_display_name,
       filename, duration_ms, file_size)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      params.session_id,
      params.speaker_id,
      params.speaker_name,
      params.speaker_display_name,
      params.filename,
      params.duration_ms,
      params.file_size,
    ]
  );
  await db.execute(
    `UPDATE voice_sessions SET total_chunks = total_chunks + 1 WHERE id = ?`,
    [params.session_id]
  );
  return result.insertId;
}

/** Get active (recording) voice session. */
export async function getActiveVoiceSession(
  guildId?: string
): Promise<mysql.RowDataPacket | null> {
  const db = getPool();
  let sql = `SELECT * FROM voice_sessions WHERE status = 'recording'`;
  const params: string[] = [];
  if (guildId) {
    sql += ` AND guild_id = ?`;
    params.push(guildId);
  }
  sql += ` ORDER BY started_at DESC LIMIT 1`;
  const [rows] = await db.execute<mysql.RowDataPacket[]>(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

/** Get voice transcriptions with optional filters. */
export async function getVoiceTranscriptions(params: {
  session_id?: number;
  speaker_id?: string;
  limit?: number;
}): Promise<mysql.RowDataPacket[]> {
  const db = getPool();
  const sqlParams: (string | number)[] = [];
  let sql = `SELECT vc.speaker_name, vc.speaker_display_name, vc.created_at,
      vc.duration_ms, vt.text, vt.confidence, vt.transcribed_at
    FROM voice_chunks vc
    JOIN voice_transcriptions vt ON vc.id = vt.chunk_id
    WHERE 1=1`;

  if (params.session_id) {
    sql += ` AND vc.session_id = ?`;
    sqlParams.push(params.session_id);
  }
  if (params.speaker_id) {
    sql += ` AND vc.speaker_id = ?`;
    sqlParams.push(params.speaker_id);
  }
  sql += ` ORDER BY vc.created_at ASC LIMIT ?`;
  sqlParams.push(params.limit || 100);

  const [rows] = await db.execute<mysql.RowDataPacket[]>(sql, sqlParams);
  return rows;
}

/** Full-text search in voice transcriptions. */
export async function searchVoiceTranscriptions(
  query: string,
  sessionId?: number,
  limit: number = 50
): Promise<mysql.RowDataPacket[]> {
  const db = getPool();
  const params: (string | number)[] = [query];
  let sql = `SELECT vc.speaker_name, vc.speaker_display_name, vc.created_at,
      vc.session_id, vt.text, vt.confidence
    FROM voice_transcriptions vt
    JOIN voice_chunks vc ON vt.chunk_id = vc.id
    WHERE MATCH(vt.text) AGAINST(? IN BOOLEAN MODE)`;

  if (sessionId) {
    sql += ` AND vc.session_id = ?`;
    params.push(sessionId);
  }
  sql += ` ORDER BY vc.created_at DESC LIMIT ?`;
  params.push(limit);

  const [rows] = await db.execute<mysql.RowDataPacket[]>(sql, params);
  return rows;
}
