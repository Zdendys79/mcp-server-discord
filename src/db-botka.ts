// Botka message relay, replies, queries, and outgoing messages
import mysql from "mysql2/promise";
import { getPool } from "./db.js";

// --- Botka message relay (Discord -> Claude) ---

/** Insert an incoming message for Claude relay. */
export async function insertBotkaMessage(params: {
  source: string;
  author_id: string | null;
  author_name: string | null;
  content: string;
}): Promise<number> {
  const db = getPool();
  const [result] = await db.execute<mysql.ResultSetHeader>(
    `INSERT INTO botka_messages (source, author_id, author_name, content)
     VALUES (?, ?, ?, ?)`,
    [params.source, params.author_id, params.author_name, params.content]
  );
  return result.insertId;
}

// --- Botka replies (Claude -> Discord DM) ---

/** Get pending replies to send as Discord DMs. */
export async function getPendingBotkaReplies(): Promise<mysql.RowDataPacket[]> {
  const db = getPool();
  const [rows] = await db.execute<mysql.RowDataPacket[]>(
    `SELECT * FROM botka_replies WHERE status = 'pending' ORDER BY created_at ASC LIMIT 10`
  );
  return rows;
}

/** Mark a botka reply as sent. */
export async function markBotkaReplySent(replyId: number): Promise<void> {
  const db = getPool();
  await db.execute(
    `UPDATE botka_replies SET status = 'sent', sent_at = NOW() WHERE id = ?`,
    [replyId]
  );
}

/** Mark a botka reply as failed. */
export async function markBotkaReplyFailed(replyId: number): Promise<void> {
  const db = getPool();
  await db.execute(
    `UPDATE botka_replies SET status = 'failed' WHERE id = ?`,
    [replyId]
  );
}

// --- Bot queries (channel /botka commands) ---

/** Insert a channel query for Claude processing. */
export async function insertBotQuery(params: {
  channel_id: string;
  message_id: string | null;
  author_id: string;
  author_name: string;
  query_text: string;
}): Promise<number> {
  const db = getPool();
  const [result] = await db.execute<mysql.ResultSetHeader>(
    `INSERT INTO bot_queries (channel_id, message_id, author_id, author_name, query_text)
     VALUES (?, ?, ?, ?, ?)`,
    [
      params.channel_id,
      params.message_id,
      params.author_id,
      params.author_name,
      params.query_text,
    ]
  );
  return result.insertId;
}

/** Get response for a bot query. */
export async function getBotQueryResponse(
  queryId: number
): Promise<mysql.RowDataPacket | null> {
  const db = getPool();
  const [rows] = await db.execute<mysql.RowDataPacket[]>(
    `SELECT * FROM bot_query_responses WHERE query_id = ?`,
    [queryId]
  );
  return rows.length > 0 ? rows[0] : null;
}

/** Get status of a bot query. */
export async function getBotQueryStatus(
  queryId: number
): Promise<string | null> {
  const db = getPool();
  const [rows] = await db.execute<mysql.RowDataPacket[]>(
    `SELECT status FROM bot_queries WHERE id = ?`,
    [queryId]
  );
  return rows.length > 0 ? rows[0].status : null;
}

// --- Discord outgoing messages (live transcription -> channel) ---

/** Get pending outgoing messages for bot to send. */
export async function getPendingOutgoingMessages(): Promise<
  mysql.RowDataPacket[]
> {
  const db = getPool();
  const [rows] = await db.execute<mysql.RowDataPacket[]>(
    `SELECT * FROM discord_outgoing WHERE status = 'pending' ORDER BY created_at ASC LIMIT 20`
  );
  return rows;
}

/** Mark outgoing message as sent. */
export async function markOutgoingSent(id: number): Promise<void> {
  const db = getPool();
  await db.execute(
    `UPDATE discord_outgoing SET status = 'sent', sent_at = NOW() WHERE id = ?`,
    [id]
  );
}

/** Mark outgoing message as failed. */
export async function markOutgoingFailed(id: number): Promise<void> {
  const db = getPool();
  await db.execute(
    `UPDATE discord_outgoing SET status = 'failed' WHERE id = ?`,
    [id]
  );
}

// --- Stop/cancel functions ---

/** Cancel pending bot queries for a user (/stop). */
export async function cancelPendingBotQueries(authorId: string): Promise<number> {
  const db = getPool();
  const [result] = await db.execute<mysql.ResultSetHeader>(
    `UPDATE bot_queries SET status = 'error', error_message = 'Cancelled by /stop'
     WHERE author_id = ? AND status IN ('pending', 'processing')`,
    [authorId]
  );
  return result.affectedRows;
}

/** Cancel pending botka messages for a user (/stop). */
export async function cancelPendingBotkaMessages(authorId: string): Promise<number> {
  const db = getPool();
  const [result] = await db.execute<mysql.ResultSetHeader>(
    `UPDATE botka_messages SET status = 'failed'
     WHERE author_id = ? AND status = 'pending'`,
    [authorId]
  );
  return result.affectedRows;
}

// --- User status functions ---

/** Get user's interaction statistics with Botka. */
export async function getUserBotkaStats(userId: string): Promise<{
  total_conversations: number;
  total_recordings: number;
  total_chunks: number;
  consent_status: string;
  last_interaction: string | null;
}> {
  const db = getPool();

  const [convRows] = await db.execute<mysql.RowDataPacket[]>(
    `SELECT COUNT(*) as total FROM botka_messages WHERE author_id = ?`,
    [userId]
  );

  const [recRows] = await db.execute<mysql.RowDataPacket[]>(
    `SELECT COUNT(DISTINCT vs.id) as sessions, COALESCE(SUM(vs.total_chunks), 0) as chunks
     FROM voice_sessions vs
     JOIN voice_chunks vc ON vs.id = vc.session_id
     WHERE vc.speaker_id = ?`,
    [userId]
  );

  const [consentRows] = await db.execute<mysql.RowDataPacket[]>(
    `SELECT consent_type, granted_at FROM user_consents
     WHERE user_id = ? AND is_active = TRUE
     ORDER BY granted_at DESC LIMIT 1`,
    [userId]
  );

  const [lastRows] = await db.execute<mysql.RowDataPacket[]>(
    `SELECT MAX(created_at) as last_at FROM botka_messages WHERE author_id = ?`,
    [userId]
  );

  let consentStatus = "zadny souhlas";
  if (consentRows.length > 0) {
    consentStatus = consentRows[0].consent_type === "permanent"
      ? "trvaly souhlas"
      : "jednorazovy souhlas";
  }

  return {
    total_conversations: convRows[0].total,
    total_recordings: recRows[0].sessions,
    total_chunks: recRows[0].chunks,
    consent_status: consentStatus,
    last_interaction: lastRows[0].last_at,
  };
}
