// Discord message and channel database operations
import mysql from "mysql2/promise";
import { getPool } from "./db.js";

/** Store a Discord message (upsert). */
export async function storeMessage(msg: {
  id: string;
  channel_id: string;
  author_id: string;
  author_name: string;
  author_display_name: string | null;
  content: string;
  has_attachments: boolean;
  attachment_urls: string[] | null;
  reply_to_id: string | null;
  is_bot: boolean;
  created_at: Date;
}): Promise<void> {
  const db = getPool();
  await db.execute(
    `INSERT INTO messages (id, channel_id, author_id, author_name, author_display_name,
      content, has_attachments, attachment_urls, reply_to_id, is_bot, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE content = VALUES(content)`,
    [
      msg.id,
      msg.channel_id,
      msg.author_id,
      msg.author_name,
      msg.author_display_name,
      msg.content,
      msg.has_attachments,
      msg.attachment_urls ? JSON.stringify(msg.attachment_urls) : null,
      msg.reply_to_id,
      msg.is_bot,
      msg.created_at,
    ]
  );
}

/** Ensure channel exists in DB (upsert). */
export async function ensureChannel(channel: {
  id: string;
  name: string;
  guild_id: string;
  guild_name: string | null;
}): Promise<void> {
  const db = getPool();
  await db.execute(
    `INSERT INTO channels (id, name, guild_id, guild_name)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE name = VALUES(name), guild_name = VALUES(guild_name)`,
    [channel.id, channel.name, channel.guild_id, channel.guild_name]
  );
}

/** Check if channel has monitoring enabled. */
export async function isChannelMonitored(
  channelId: string
): Promise<boolean> {
  const db = getPool();
  const [rows] = await db.execute<mysql.RowDataPacket[]>(
    `SELECT monitoring_enabled FROM channels WHERE id = ?`,
    [channelId]
  );
  if (rows.length === 0) return false;
  return rows[0].monitoring_enabled === 1;
}

/** Get all monitored channels with message counts. */
export async function getMonitoredChannels(): Promise<mysql.RowDataPacket[]> {
  const db = getPool();
  const [rows] = await db.execute<mysql.RowDataPacket[]>(
    `SELECT c.*, COUNT(m.id) as message_count, MAX(m.created_at) as last_message
     FROM channels c
     LEFT JOIN messages m ON c.id = m.channel_id
     WHERE c.monitoring_enabled = TRUE
     GROUP BY c.id
     ORDER BY c.name`
  );
  return rows;
}

/** Read messages from a channel (newest first, reversed to chronological). */
export async function readMessages(
  channelId: string,
  limit: number = 50,
  before?: string
): Promise<mysql.RowDataPacket[]> {
  const db = getPool();
  const params: (string | number)[] = [channelId];
  let query = `SELECT id, author_name, author_display_name, content, has_attachments,
    attachment_urls, reply_to_id, is_bot, created_at
    FROM messages WHERE channel_id = ?`;

  if (before) {
    query += ` AND created_at < ?`;
    params.push(before);
  }

  query += ` ORDER BY created_at DESC LIMIT ?`;
  params.push(limit);

  const [rows] = await db.execute<mysql.RowDataPacket[]>(query, params);
  return rows.reverse();
}

/** Full-text search messages. */
export async function searchMessages(
  query: string,
  channelId?: string,
  project?: string,
  limit: number = 50
): Promise<mysql.RowDataPacket[]> {
  const db = getPool();
  const params: (string | number)[] = [query];
  let sql = `SELECT m.id, m.channel_id, c.name as channel_name, m.author_name,
    m.author_display_name, m.content, m.created_at
    FROM messages m
    JOIN channels c ON m.channel_id = c.id
    WHERE MATCH(m.content) AGAINST(? IN BOOLEAN MODE)`;

  if (channelId) {
    sql += ` AND m.channel_id = ?`;
    params.push(channelId);
  }
  if (project) {
    sql += ` AND c.project = ?`;
    params.push(project);
  }
  sql += ` ORDER BY m.created_at DESC LIMIT ?`;
  params.push(limit);

  const [rows] = await db.execute<mysql.RowDataPacket[]>(sql, params);
  return rows;
}

/** Get channel history for a date range. */
export async function getChannelHistory(
  channelId: string,
  from: string,
  to: string
): Promise<mysql.RowDataPacket[]> {
  const db = getPool();
  const [rows] = await db.execute<mysql.RowDataPacket[]>(
    `SELECT id, author_name, author_display_name, content, has_attachments,
      created_at FROM messages
     WHERE channel_id = ? AND created_at BETWEEN ? AND ?
     ORDER BY created_at ASC`,
    [channelId, from, to]
  );
  return rows;
}

/** Get bot status summary. */
export async function getBotStatus(): Promise<{
  total_messages: number;
  total_channels: number;
  monitored_channels: number;
  oldest_message: string | null;
  newest_message: string | null;
}> {
  const db = getPool();
  const [msgRows] = await db.execute<mysql.RowDataPacket[]>(
    `SELECT COUNT(*) as total, MIN(created_at) as oldest, MAX(created_at) as newest
     FROM messages`
  );
  const [chRows] = await db.execute<mysql.RowDataPacket[]>(
    `SELECT COUNT(*) as total, SUM(monitoring_enabled) as monitored FROM channels`
  );
  return {
    total_messages: msgRows[0].total,
    total_channels: chRows[0].total,
    monitored_channels: chRows[0].monitored || 0,
    oldest_message: msgRows[0].oldest,
    newest_message: msgRows[0].newest,
  };
}

/** Update channel's last_message_at timestamp. */
export async function updateChannelLastMessage(
  channelId: string,
  timestamp: Date
): Promise<void> {
  const db = getPool();
  await db.execute(
    `UPDATE channels SET last_message_at = ? WHERE id = ?`,
    [timestamp, channelId]
  );
}

/** Add channel to monitoring. */
export async function addChannel(
  id: string,
  name: string,
  guildId: string,
  guildName: string | null,
  project: string | null
): Promise<void> {
  const db = getPool();
  await db.execute(
    `INSERT INTO channels (id, name, guild_id, guild_name, project, monitoring_enabled)
     VALUES (?, ?, ?, ?, ?, TRUE)
     ON DUPLICATE KEY UPDATE monitoring_enabled = TRUE, project = COALESCE(VALUES(project), project)`,
    [id, name, guildId, guildName, project]
  );
}
