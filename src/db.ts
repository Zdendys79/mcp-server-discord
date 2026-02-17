// Database connection pool - shared across all modules
import mysql from "mysql2/promise";

let pool: mysql.Pool | null = null;

export function getPool(): mysql.Pool {
  if (!pool) {
    pool = mysql.createPool({
      host: process.env.DB_HOST || "127.0.0.1",
      port: parseInt(process.env.DB_PORT || "3306"),
      user: process.env.DB_USER || "claude",
      password:
        process.env.MARIADB_PASSWORD ||
        process.env.DB_PASS ||
        process.env.DB_PASSWORD ||
        "",
      database: process.env.DB_NAME || "discord_dh",
      connectionLimit: 10,
      waitForConnections: true,
      queueLimit: 0,
      charset: "utf8mb4",
    });
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

// Re-export all domain modules for backwards compatibility
export {
  storeMessage,
  ensureChannel,
  isChannelMonitored,
  getMonitoredChannels,
  readMessages,
  searchMessages,
  getChannelHistory,
  getBotStatus,
  updateChannelLastMessage,
  addChannel,
} from "./db-messages.js";

export {
  createVoiceSession,
  endVoiceSession,
  insertVoiceChunk,
  getActiveVoiceSession,
  getVoiceTranscriptions,
  searchVoiceTranscriptions,
} from "./db-voice.js";

export {
  getVoiceCommand,
  clearVoiceCommand,
  setVoiceCommandResult,
  getVoiceCommandResult,
  setVoiceCommand,
} from "./db-voice-ipc.js";

export {
  hasActiveConsent,
  hasSessionConsent,
  grantConsent,
  revokeConsent,
  revokeSessionConsents,
} from "./db-consent.js";

export {
  insertBotkaMessage,
  getPendingBotkaReplies,
  markBotkaReplySent,
  markBotkaReplyFailed,
  insertBotQuery,
  getBotQueryResponse,
  getBotQueryStatus,
  getPendingOutgoingMessages,
  markOutgoingSent,
  markOutgoingFailed,
} from "./db-botka.js";
