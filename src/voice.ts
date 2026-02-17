// Voice recording module - per-speaker OGG chunks from Discord voice channels
import {
  joinVoiceChannel,
  VoiceConnectionStatus,
  EndBehaviorType,
  entersState,
  getVoiceConnection,
} from "@discordjs/voice";
import type { VoiceConnection } from "@discordjs/voice";
import { Client, VoiceChannel, GuildMember } from "discord.js";
import { createWriteStream, mkdirSync, statSync } from "node:fs";
import { spawn } from "node:child_process";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import { unlink } from "node:fs/promises";
import prism from "prism-media";
import {
  createVoiceSession,
  endVoiceSession,
  insertVoiceChunk,
  hasActiveConsent,
  hasSessionConsent,
  grantConsent,
} from "./db.js";

const RECORDINGS_DIR = path.join(process.cwd(), "recordings");
const SILENCE_DURATION_MS = 300; // End recording after 300ms silence

interface ActiveSession {
  sessionId: number;
  guildId: string;
  channelId: string;
  connection: VoiceConnection;
  chunkCount: number;
  startedAt: Date;
  consentedUsers: Set<string>;
  pendingConsent: Set<string>;
}

// One active session per guild
const activeSessions = new Map<string, ActiveSession>();

function formatTimestamp(date: Date): string {
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const h = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  const s = String(date.getSeconds()).padStart(2, "0");
  const ms = String(date.getMilliseconds()).padStart(3, "0");
  return `${y}-${mo}-${d}_${h}-${mi}-${s}-${ms}`;
}

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, "_").substring(0, 50);
}

async function normalizeChunk(
  rawPath: string,
  outPath: string
): Promise<number> {
  // ffmpeg: read raw PCM (s16le 48kHz mono), normalize loudness, resample to 16kHz, encode opus 32kbps
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn("ffmpeg", [
      "-y",
      "-f",
      "s16le",
      "-ar",
      "48000",
      "-ac",
      "1",
      "-i",
      rawPath,
      "-af",
      "loudnorm=I=-16:TP=-1.5:LRA=11",
      "-ar",
      "16000",
      "-ac",
      "1",
      "-c:a",
      "libopus",
      "-b:a",
      "32k",
      outPath,
    ]);

    ffmpeg.on("close", (code) => {
      if (code === 0) {
        try {
          const stats = statSync(outPath);
          resolve(stats.size);
        } catch {
          resolve(0);
        }
      } else {
        reject(new Error(`ffmpeg exited with code ${code}`));
      }
    });

    ffmpeg.on("error", reject);
  });
}

function getAudioDurationMs(filePath: string): Promise<number> {
  return new Promise((resolve) => {
    const ffprobe = spawn("ffprobe", [
      "-v",
      "quiet",
      "-show_entries",
      "format=duration",
      "-of",
      "csv=p=0",
      filePath,
    ]);

    let output = "";
    ffprobe.stdout.on("data", (data) => {
      output += data.toString();
    });

    ffprobe.on("close", () => {
      const seconds = parseFloat(output.trim());
      resolve(isNaN(seconds) ? 0 : Math.round(seconds * 1000));
    });

    ffprobe.on("error", () => resolve(0));
  });
}

function handleSpeakingUser(
  session: ActiveSession,
  userId: string,
  member: GuildMember | undefined
): void {
  // Skip recording if user has not consented
  if (!session.consentedUsers.has(userId)) {
    return;
  }

  const receiver = session.connection.receiver;

  const displayName = member?.displayName || member?.user.username || userId;
  const username = member?.user.username || userId;

  const opusStream = receiver.subscribe(userId, {
    end: {
      behavior: EndBehaviorType.AfterSilence,
      duration: SILENCE_DURATION_MS,
    },
  });

  const now = new Date();
  const safeName = sanitizeName(displayName);
  const timestamp = formatTimestamp(now);
  const sessionDir = path.join(RECORDINGS_DIR, String(session.sessionId));
  mkdirSync(sessionDir, { recursive: true });

  const rawFilename = `${timestamp}_${userId}_${safeName}_raw.pcm`;
  const rawPath = path.join(sessionDir, rawFilename);
  const finalFilename = `${timestamp}_${userId}_${safeName}.ogg`;
  const finalPath = path.join(sessionDir, finalFilename);
  const relativeFilename = `${session.sessionId}/${finalFilename}`;

  // Decode opus to PCM via prism, then pipe to ffmpeg for raw capture
  const decoder = new prism.opus.Decoder({
    rate: 48000,
    channels: 1,
    frameSize: 960,
  });

  const writeStream = createWriteStream(rawPath);

  // Write raw PCM to file, then process with ffmpeg
  pipeline(opusStream, decoder, writeStream)
    .then(async () => {
      // Check if raw file has meaningful content
      try {
        const rawStats = statSync(rawPath);
        if (rawStats.size < 9600) { // Less than 100ms of 48kHz 16bit mono PCM
          // Too small, likely just silence/noise
          await unlink(rawPath).catch(() => {});
          return;
        }
      } catch {
        return;
      }

      // Normalize with ffmpeg
      try {
        const fileSize = await normalizeChunk(rawPath, finalPath);
        const durationMs = await getAudioDurationMs(finalPath);

        // Clean up raw file
        await unlink(rawPath).catch(() => {});

        // Skip very short chunks (under 200ms)
        if (durationMs < 200) {
          await unlink(finalPath).catch(() => {});
          return;
        }

        // Store in database
        await insertVoiceChunk({
          session_id: session.sessionId,
          speaker_id: userId,
          speaker_name: username,
          speaker_display_name: displayName !== username ? displayName : null,
          filename: relativeFilename,
          duration_ms: durationMs,
          file_size: fileSize,
        });

        session.chunkCount++;
        if (session.chunkCount % 50 === 0) {
          console.log(
            `[VOICE] Session ${session.sessionId}: ${session.chunkCount} chunks recorded`
          );
        }
      } catch (err) {
        console.error(
          `[VOICE] Failed to process chunk ${rawFilename}:`,
          err instanceof Error ? err.message : err
        );
        await unlink(rawPath).catch(() => {});
        await unlink(finalPath).catch(() => {});
      }
    })
    .catch((err) => {
      // Stream error (user disconnected, etc.) - not critical
      if (
        err instanceof Error &&
        !err.message.includes("ERR_STREAM_PREMATURE_CLOSE")
      ) {
        console.error(`[VOICE] Stream error for ${displayName}:`, err.message);
      }
      unlink(rawPath).catch(() => {});
    });
}

export async function joinAndRecord(
  client: Client,
  channelId: string
): Promise<{ sessionId: number; channelName: string }> {
  const channel = await client.channels.fetch(channelId);
  if (!channel || !(channel instanceof VoiceChannel)) {
    throw new Error(`Channel ${channelId} is not a voice channel`);
  }

  const guildId = channel.guild.id;

  // Check if already recording in this guild
  const existing = activeSessions.get(guildId);
  if (existing) {
    throw new Error(
      `Already recording in guild ${guildId} (session ${existing.sessionId})`
    );
  }

  // Ensure recordings directory exists
  mkdirSync(RECORDINGS_DIR, { recursive: true });

  // Create DB session
  const sessionId = await createVoiceSession({
    guild_id: guildId,
    channel_id: channelId,
    channel_name: channel.name,
  });

  // Join voice channel
  const connection = joinVoiceChannel({
    channelId: channelId,
    guildId: guildId,
    adapterCreator: channel.guild.voiceAdapterCreator,
    selfDeaf: false, // Must not be deaf to receive audio
    selfMute: true, // Mute ourselves
  });

  // Wait for connection to be ready
  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 10_000);
  } catch {
    connection.destroy();
    throw new Error("Failed to connect to voice channel within 10 seconds");
  }

  const session: ActiveSession = {
    sessionId,
    guildId,
    channelId,
    connection,
    chunkCount: 0,
    startedAt: new Date(),
    consentedUsers: new Set(),
    pendingConsent: new Set(),
  };

  activeSessions.set(guildId, session);

  // Request consent from all current voice channel members
  const members = channel.members.filter((m) => !m.user.bot);
  for (const [memberId, member] of members) {
    const hasPermanent = await hasActiveConsent(memberId);
    if (hasPermanent) {
      session.consentedUsers.add(memberId);
      console.log(
        `[VOICE] User ${member.displayName} has permanent consent`
      );
    } else {
      session.pendingConsent.add(memberId);
      // Send DM asking for consent
      try {
        const dm = await member.createDM();
        await dm.send(
          `Ahoj! Botka se právě připojila do hlasového kanálu **#${channel.name}** a chtěla by nahrávat.\n\n` +
            `Souhlasíš s nahráváním tvého hlasu?\n` +
            `Odpověz:\n` +
            `- **ano** - jednorázový souhlas (jen tato session)\n` +
            `- **trvale** - trvalý souhlas (pro všechny budoucí nahrávky)\n` +
            `- **ne** - nesouhlasím\n\n` +
            `_Souhlas můžeš kdykoliv odvolat příkazem /botka souhlas zrušit_`
        );
        console.log(
          `[VOICE] Consent DM sent to ${member.displayName}`
        );
      } catch (err) {
        console.error(
          `[VOICE] Failed to DM ${member.displayName}:`,
          err instanceof Error ? err.message : err
        );
      }
    }
  }

  // Listen for speaking events
  const receiver = connection.receiver;
  receiver.speaking.on("start", (userId) => {
    const guild = client.guilds.cache.get(guildId);
    const member = guild?.members.cache.get(userId);
    handleSpeakingUser(session, userId, member);
  });

  // Handle disconnection
  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    try {
      // Try to reconnect
      await Promise.race([
        entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
        entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
      ]);
    } catch {
      // Could not reconnect, clean up
      console.log(
        `[VOICE] Disconnected from voice in guild ${guildId}, ending session`
      );
      await leaveAndStop(guildId);
    }
  });

  console.log(
    `[VOICE] Recording started: session ${sessionId}, channel #${channel.name}`
  );
  return { sessionId, channelName: channel.name };
}

export async function leaveAndStop(
  guildId?: string
): Promise<{ sessionId: number; chunks: number; duration: number } | null> {
  // If no guildId, stop the first active session
  const targetGuildId =
    guildId || (activeSessions.size > 0 ? activeSessions.keys().next().value : null);
  if (!targetGuildId) return null;

  const session = activeSessions.get(targetGuildId);
  if (!session) return null;

  // Disconnect
  session.connection.destroy();
  activeSessions.delete(targetGuildId);

  // End DB session
  await endVoiceSession(session.sessionId);

  const durationSec = Math.round(
    (Date.now() - session.startedAt.getTime()) / 1000
  );

  console.log(
    `[VOICE] Recording ended: session ${session.sessionId}, ${session.chunkCount} chunks, ${durationSec}s`
  );

  return {
    sessionId: session.sessionId,
    chunks: session.chunkCount,
    duration: durationSec,
  };
}

export async function handleConsentResponse(
  userId: string,
  userName: string,
  response: string
): Promise<string> {
  const normalized = response.toLowerCase().trim();

  // Find the session where this user has pending consent
  let targetSession: ActiveSession | null = null;
  for (const session of activeSessions.values()) {
    if (session.pendingConsent.has(userId)) {
      targetSession = session;
      break;
    }
  }

  if (!targetSession) {
    return "Momentálně není žádná aktivní nahrávací session, kde bych potřebovala tvůj souhlas.";
  }

  if (normalized === "ano" || normalized === "yes") {
    targetSession.consentedUsers.add(userId);
    targetSession.pendingConsent.delete(userId);
    await grantConsent({
      user_id: userId,
      user_name: userName,
      consent_type: "one_time",
      guild_id: targetSession.guildId,
      channel_id: targetSession.channelId,
      session_id: targetSession.sessionId,
    });
    console.log(`[VOICE] User ${userName} granted one-time consent`);
    return "Děkuji za souhlas! Budu nahrávat tvůj hlas v této session.";
  }

  if (
    normalized === "trvale" ||
    normalized === "permanent" ||
    normalized === "trvaly"
  ) {
    targetSession.consentedUsers.add(userId);
    targetSession.pendingConsent.delete(userId);
    await grantConsent({
      user_id: userId,
      user_name: userName,
      consent_type: "permanent",
      guild_id: targetSession.guildId,
    });
    console.log(`[VOICE] User ${userName} granted permanent consent`);
    return "Děkuji za trvalý souhlas! Budu nahrávat tvůj hlas ve všech budoucích sessions.";
  }

  if (normalized === "ne" || normalized === "no") {
    targetSession.pendingConsent.delete(userId);
    console.log(`[VOICE] User ${userName} declined consent`);
    return "Rozumím, nebudu nahrávat tvůj hlas. Pokud si to rozmyslíš, napiš mi 'ano' nebo 'trvale'.";
  }

  return (
    "Nerozumím. Odpověz prosím:\n" +
    "- **ano** - jednorázový souhlas\n" +
    "- **trvale** - trvalý souhlas\n" +
    "- **ne** - nesouhlasím"
  );
}

export function hasPendingConsent(userId: string): boolean {
  for (const session of activeSessions.values()) {
    if (session.pendingConsent.has(userId)) {
      return true;
    }
  }
  return false;
}

export function getVoiceStatus(): {
  activeSessions: Array<{
    sessionId: number;
    guildId: string;
    channelId: string;
    chunkCount: number;
    durationSec: number;
  }>;
} {
  const sessions = Array.from(activeSessions.values()).map((s) => ({
    sessionId: s.sessionId,
    guildId: s.guildId,
    channelId: s.channelId,
    chunkCount: s.chunkCount,
    durationSec: Math.round((Date.now() - s.startedAt.getTime()) / 1000),
  }));
  return { activeSessions: sessions };
}
