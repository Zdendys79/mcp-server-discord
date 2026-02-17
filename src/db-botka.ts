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
