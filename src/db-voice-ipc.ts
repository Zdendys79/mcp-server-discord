// Voice IPC - communication between MCP server and bot daemon via DB
import { getPool } from "./db.js";
import mysql from "mysql2/promise";

/** Get pending voice command (MCP -> bot). */
export async function getVoiceCommand(): Promise<string | null> {
  const db = getPool();
  const [rows] = await db.execute<mysql.RowDataPacket[]>(
    `SELECT value FROM bot_config WHERE key_name = 'voice_command'`
  );
  return rows.length > 0 && rows[0].value ? rows[0].value : null;
}

/** Clear voice command after processing. */
export async function clearVoiceCommand(): Promise<void> {
  const db = getPool();
  await db.execute(
    `UPDATE bot_config SET value = NULL WHERE key_name = 'voice_command'`
  );
}

/** Set voice command result (bot -> MCP). */
export async function setVoiceCommandResult(result: string): Promise<void> {
  const db = getPool();
  await db.execute(
    `UPDATE bot_config SET value = ? WHERE key_name = 'voice_command_result'`,
    [result]
  );
}

/** Get voice command result (MCP polls this). */
export async function getVoiceCommandResult(): Promise<string | null> {
  const db = getPool();
  const [rows] = await db.execute<mysql.RowDataPacket[]>(
    `SELECT value FROM bot_config WHERE key_name = 'voice_command_result'`
  );
  return rows.length > 0 && rows[0].value ? rows[0].value : null;
}

/** Set voice command and clear previous result. */
export async function setVoiceCommand(command: string): Promise<void> {
  const db = getPool();
  await db.execute(
    `UPDATE bot_config SET value = ? WHERE key_name = 'voice_command'`,
    [command]
  );
  await db.execute(
    `UPDATE bot_config SET value = NULL WHERE key_name = 'voice_command_result'`
  );
}
