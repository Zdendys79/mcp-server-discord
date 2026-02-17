// Voice recording and transcription tools - definitions + handlers
import {
  setVoiceCommand,
  getVoiceCommandResult,
  getActiveVoiceSession,
  getVoiceTranscriptions,
  searchVoiceTranscriptions,
  getPool,
} from "./db.js";
import type { ToolEntry } from "./mcp-types.js";
import { textResponse, jsonResponse } from "./mcp-types.js";

/** Poll for voice command result with timeout. */
async function pollVoiceResult(maxAttempts: number): Promise<string | null> {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const result = await getVoiceCommandResult();
    if (result) return result;
  }
  return null;
}

/** Format voice command result into tool response. */
function voiceCommandResponse(result: string | null) {
  const fallback = JSON.stringify({
    success: false,
    error: "Timeout waiting for bot response",
  });
  const text = result || fallback;
  const isError = result ? JSON.parse(result).success === false : true;
  return textResponse(text, isError);
}

// --- Tool: voice_join ---

const voiceJoinHandler = async (args: Record<string, unknown>) => {
  const channelId = args.channel_id as string;
  await setVoiceCommand(`join:${channelId}`);
  const result = await pollVoiceResult(15);
  return voiceCommandResponse(result);
};

// --- Tool: voice_leave ---

const voiceLeaveHandler = async (args: Record<string, unknown>) => {
  const guildId = args.guild_id as string | undefined;
  const cmd = guildId ? `leave:${guildId}` : "leave";
  await setVoiceCommand(cmd);
  const result = await pollVoiceResult(10);
  return voiceCommandResponse(result);
};

// --- Tool: voice_status ---

const voiceStatusHandler = async () => {
  const active = await getActiveVoiceSession();
  const db = getPool();
  const [recent] = await db.execute(
    `SELECT id, guild_id, channel_id, channel_name, started_at, ended_at,
       status, total_chunks, total_transcribed
     FROM voice_sessions ORDER BY started_at DESC LIMIT 10`
  );

  return jsonResponse({ active_session: active, recent_sessions: recent });
};

// --- Tool: voice_transcriptions ---

const voiceTranscriptionsHandler = async (
  args: Record<string, unknown>
) => {
  const sessionId = args.session_id as number | undefined;
  const speakerId = args.speaker_id as string | undefined;
  const query = args.query as string | undefined;
  const limit = Math.min((args.limit as number) || 100, 500);

  let results;
  if (query) {
    results = await searchVoiceTranscriptions(query, sessionId, limit);
  } else {
    results = await getVoiceTranscriptions({
      session_id: sessionId,
      speaker_id: speakerId,
      limit,
    });
  }

  return jsonResponse({ count: results.length, transcriptions: results });
};

// --- Exported tool entries ---

export const voiceTools: ToolEntry[] = [
  {
    definition: {
      name: "voice_join",
      description:
        "Join a Discord voice channel and start recording per-speaker audio. Bot must be in the guild.",
      inputSchema: {
        type: "object" as const,
        properties: {
          channel_id: {
            type: "string",
            description: "Discord voice channel ID to join",
          },
        },
        required: ["channel_id"],
      },
    },
    handler: voiceJoinHandler,
  },
  {
    definition: {
      name: "voice_leave",
      description:
        "Leave the voice channel and stop recording. Ends the active recording session.",
      inputSchema: {
        type: "object" as const,
        properties: {
          guild_id: {
            type: "string",
            description:
              "Guild ID to leave (optional, defaults to first active session)",
          },
        },
      },
    },
    handler: voiceLeaveHandler,
  },
  {
    definition: {
      name: "voice_status",
      description:
        "Get current voice recording status: active sessions, chunks recorded, recent sessions from DB.",
      inputSchema: { type: "object" as const, properties: {} },
    },
    handler: voiceStatusHandler,
  },
  {
    definition: {
      name: "voice_transcriptions",
      description:
        "Query voice transcriptions. Filter by session, speaker, or full-text search.",
      inputSchema: {
        type: "object" as const,
        properties: {
          session_id: {
            type: "number",
            description: "Filter by voice session ID",
          },
          speaker_id: {
            type: "string",
            description: "Filter by speaker Discord user ID",
          },
          query: {
            type: "string",
            description:
              'Full-text search in transcriptions (supports boolean: +word -word "phrase")',
          },
          limit: {
            type: "number",
            description: "Max results (default: 100)",
          },
        },
      },
    },
    handler: voiceTranscriptionsHandler,
  },
];
