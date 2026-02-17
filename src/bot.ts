// Discord Bot Daemon "Botka" - runs 24/7 via PM2, logs messages to MariaDB
import { Client, GatewayIntentBits, Events, Partials } from "discord.js";
import {
  storeMessage,
  ensureChannel,
  isChannelMonitored,
  updateChannelLastMessage,
  closePool,
  getPool,
  getVoiceCommand,
  clearVoiceCommand,
  setVoiceCommandResult,
  insertBotQuery,
  getBotQueryResponse,
  getBotQueryStatus,
  revokeConsent,
  insertBotkaMessage,
  revokeSessionConsents,
  getPendingBotkaReplies,
  markBotkaReplySent,
  markBotkaReplyFailed,
  getPendingOutgoingMessages,
  markOutgoingSent,
  markOutgoingFailed,
} from "./db.js";
import {
  joinAndRecord,
  leaveAndStop,
  getVoiceStatus,
  handleConsentResponse,
  hasPendingConsent,
} from "./voice.js";
import { isCommand, handleAnketa, handlePrepis } from "./commands.js";

const TOKEN = process.env.DISCORD_BOT_TOKEN;
if (!TOKEN) {
  console.error("[BOT] DISCORD_BOT_TOKEN environment variable is required");
  process.exit(1);
}

const BOTKA_PREFIX = "/botka";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Message, Partials.Channel],
});

let messageCount = 0;

client.once(Events.ClientReady, (c) => {
  console.log(`[BOT] Logged in as ${c.user.tag}`);
  console.log(`[BOT] Serving ${c.guilds.cache.size} guild(s)`);

  // Log available channels for reference
  c.guilds.cache.forEach((guild) => {
    console.log(`[BOT] Guild: ${guild.name} (${guild.id})`);
    const textChannels = guild.channels.cache.filter((ch) => ch.isTextBased());
    console.log(`[BOT]   Text channels: ${textChannels.size}`);
  });

  // Update bot_config
  getPool()
    .execute(
      `INSERT INTO bot_config (key_name, value) VALUES ('bot_started_at', NOW())
       ON DUPLICATE KEY UPDATE value = NOW()`
    )
    .catch((err) => console.error("[BOT] Failed to update bot_config:", err.message));

  // Voice command IPC polling (MCP -> bot communication)
  setInterval(async () => {
    try {
      const cmd = await getVoiceCommand();
      if (!cmd) return;

      await clearVoiceCommand();
      console.log(`[BOT] Voice command received: ${cmd}`);

      let result: string;
      if (cmd.startsWith("join:")) {
        const channelId = cmd.substring(5);
        try {
          const info = await joinAndRecord(c, channelId);
          result = JSON.stringify({
            success: true,
            session_id: info.sessionId,
            channel_name: info.channelName,
          });
        } catch (err) {
          result = JSON.stringify({
            success: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      } else if (cmd === "leave" || cmd.startsWith("leave:")) {
        const guildId = cmd.startsWith("leave:") ? cmd.substring(6) : undefined;
        try {
          const info = await leaveAndStop(guildId);
          result = info
            ? JSON.stringify({ success: true, ...info })
            : JSON.stringify({ success: false, error: "No active recording" });
        } catch (err) {
          result = JSON.stringify({
            success: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      } else if (cmd === "status") {
        result = JSON.stringify({ success: true, ...getVoiceStatus() });
      } else {
        result = JSON.stringify({ success: false, error: `Unknown command: ${cmd}` });
      }

      await setVoiceCommandResult(result);
    } catch (err) {
      console.error(
        "[BOT] Voice command poll error:",
        err instanceof Error ? err.message : err
      );
    }
  }, 1000);

  // Botka reply polling - sends claude's replies as Discord DMs
  setInterval(async () => {
    try {
      const replies = await getPendingBotkaReplies();
      for (const reply of replies) {
        try {
          const user = await c.users.fetch(reply.target_author_id);
          const dm = await user.createDM();
          await dm.send(reply.content);
          await markBotkaReplySent(reply.id);
          console.log(
            `[BOT] Sent botka reply to ${reply.target_author_name || reply.target_author_id}`
          );
        } catch (err) {
          console.error(
            `[BOT] Failed to send botka reply ${reply.id}:`,
            err instanceof Error ? err.message : err
          );
          await markBotkaReplyFailed(reply.id);
        }
      }
    } catch (err) {
      // Silently ignore DB poll errors
    }
  }, 5000);

    // Outgoing messages polling (live transcription -> Discord channel)
    setInterval(async () => {
      try {
        const msgs = await getPendingOutgoingMessages();
        for (const msg of msgs) {
          try {
            const channel = await c.channels.fetch(msg.channel_id);
            if (channel && channel.isTextBased() && "send" in channel) {
              await (channel as any).send(msg.content);
            }
            await markOutgoingSent(msg.id);
          } catch (err) {
            console.error(`[BOT] Failed to send outgoing ${msg.id}:`, err instanceof Error ? err.message : err);
            await markOutgoingFailed(msg.id);
          }
        }
      } catch (err) { /* ignore */ }
    }, 3000);
});

client.on(Events.MessageCreate, async (message) => {
  try {
    // Skip bot messages
    if (message.author.bot) return;

    // Handle DM messages
    if (!message.guild) {
      // Check if user has pending consent request
      const hasPending = hasPendingConsent(message.author.id);
      if (hasPending) {
        const response = await handleConsentResponse(
          message.author.id,
          message.author.username,
          message.content
        );
        await message.reply(response);
      } else {
        // Forward DM to botka_messages for claude relay
        await insertBotkaMessage({
          source: "dm",
          author_id: message.author.id,
          author_name: message.author.username,
          content: message.content,
        });
        console.log(
          `[BOT] DM from ${message.author.username} queued for claude relay`
        );
      }
      return;
    }

      // Handle /anketa and /prepis commands (before /botka)
      if (message.guild && isCommand(message.content)) {
        const lower = message.content.toLowerCase();
        if (lower.startsWith("/anketa")) {
          await handleAnketa(message);
        } else if (lower.startsWith("/prepis")) {
          await handlePrepis(message, client);
        }
        return;
      }
    // Handle /botka commands and @mention
    const isBotkaCommand = message.content.toLowerCase().startsWith(BOTKA_PREFIX);
    const isMention = message.mentions.has(client.user!);

    if ((isBotkaCommand || isMention) && !message.author.bot) {
      let queryText = message.content;
      if (isBotkaCommand) {
        queryText = message.content.substring(BOTKA_PREFIX.length).trim();
      } else if (isMention) {
        queryText = message.content.replace(/<@!?\d+>/g, "").trim();
      }

      if (queryText.length > 0) {
        const displayName =
          message.member?.displayName || message.author.username;
        const channelName =
          "name" in message.channel ? message.channel.name : "unknown";

        // Insert query to get ID for reply tracking
        const queryId = await insertBotQuery({
          channel_id: message.channel.id,
          message_id: message.id,
          author_id: message.author.id,
          author_name: displayName,
          query_text: queryText,
        });

        // Relay to claude via botka_messages (includes query_id for reply)
        await insertBotkaMessage({
          source: "channel",
          author_id: message.author.id,
          author_name: displayName,
          content: `[#${channelName}] ${queryText} (query_id=${queryId})`,
        });

        // Show typing indicator
        if ("sendTyping" in message.channel) {
          await message.channel.sendTyping();
        }

        // Poll for response (no hard timeout - response is mandatory)
        const pollStart = Date.now();
        let patienceMsg: Awaited<ReturnType<typeof message.channel.send>> | null = null;
        const pollInterval = setInterval(async () => {
          try {
            // After 20s, send patience message (once)
            if (!patienceMsg && Date.now() - pollStart > 20000) {
              patienceMsg = await message.channel.send(
                "Můj LLM model je zaneprázdněn. Moje odpověď bude trvat o něco déle. Mějte prosím strpení."
              );
            }

            const status = await getBotQueryStatus(queryId);
            if (status === "answered") {
              clearInterval(pollInterval);
              // Delete patience message if it was sent
              if (patienceMsg) {
                await patienceMsg.delete().catch(() => {});
              }
              const response = await getBotQueryResponse(queryId);
              if (response) {
                const text = response.response_text as string;
                // Split long messages (Discord 2000 char limit)
                if (text.length <= 2000) {
                  await message.channel.send(text);
                } else {
                  const chunks: string[] = [];
                  for (let i = 0; i < text.length; i += 1990) {
                    chunks.push(text.substring(i, i + 1990));
                  }
                  for (const chunk of chunks) {
                    await message.channel.send(chunk);
                  }
                }
              }
            } else if (status === "error") {
              clearInterval(pollInterval);
              await message.channel.send("Omlouvám se, došlo k chybě při zpracování dotazu.");
            }
          } catch (err) {
            console.error(
              "[BOT] Query poll error:",
              err instanceof Error ? err.message : err
            );
          }
        }, 2000);

        console.log(
          `[BOT] Channel query from ${displayName} in #${channelName} relayed to claude`
        );
      }
      return; // Don't log /botka commands as regular messages
    }

    const channelId = message.channel.id;

    // Check if channel is monitored (auto-register if not in DB yet)
    const monitored = await isChannelMonitored(channelId);

    if (!monitored) {
      // Channel not in DB or not monitored - skip but auto-register
      const channelName =
        "name" in message.channel ? message.channel.name : "unknown";
      await ensureChannel({
        id: channelId,
        name: channelName,
        guild_id: message.guild.id,
        guild_name: message.guild.name,
      });
      return;
    }

    // Store message
    const attachmentUrls = message.attachments.size > 0
      ? message.attachments.map((a) => a.url)
      : null;

    await storeMessage({
      id: message.id,
      channel_id: channelId,
      author_id: message.author.id,
      author_name: message.author.username,
      author_display_name: message.member?.displayName || message.author.displayName || null,
      content: message.content,
      has_attachments: message.attachments.size > 0,
      attachment_urls: attachmentUrls ? [...attachmentUrls] : null,
      reply_to_id: message.reference?.messageId || null,
      is_bot: message.author.bot,
      created_at: message.createdAt,
    });

    await updateChannelLastMessage(channelId, message.createdAt);

    messageCount++;
    if (messageCount % 100 === 0) {
      console.log(`[BOT] Logged ${messageCount} messages total`);
      await getPool().execute(
        `INSERT INTO bot_config (key_name, value) VALUES ('messages_logged_total', ?)
         ON DUPLICATE KEY UPDATE value = ?`,
        [String(messageCount), String(messageCount)]
      );
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`[BOT] Error processing message ${message.id}: ${errorMessage}`);
  }
});

// Auto-disconnect when bot is alone in voice channel
client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
  try {
    // Only care about users leaving a voice channel
    if (!oldState.channel) return;

    const channel = oldState.channel;
    // Count non-bot members remaining in the channel
    const humanMembers = channel.members.filter((m) => !m.user.bot);

    if (humanMembers.size === 0) {
      // Bot is alone - check if we have an active session for this guild
      const guildId = channel.guild.id;
      const status = getVoiceStatus();
      const activeInGuild = status.activeSessions.find(
        (s) => s.guildId === guildId
      );

      if (activeInGuild) {
        console.log(
          `[BOT] All users left voice channel #${channel.name}, auto-disconnecting`
        );
        const result = await leaveAndStop(guildId);
        if (result) {
          // Reset one-time consents for this session
          const revoked = await revokeSessionConsents(result.sessionId);
          if (revoked > 0) {
            console.log(
              `[BOT] Revoked ${revoked} one-time consent(s) for session ${result.sessionId}`
            );
          }
          // Notify claude via botka_messages
          await insertBotkaMessage({
            source: "system",
            author_id: null,
            author_name: null,
            content: `Voice session ${result.sessionId} ended (auto-disconnect, channel empty). ${result.chunks} chunks recorded, ${result.duration}s duration. One-time consents reset.`,
          });
        }
      }
    }
  } catch (err) {
    console.error(
      "[BOT] VoiceStateUpdate error:",
      err instanceof Error ? err.message : err
    );
  }
});

// Graceful shutdown
function shutdown(signal: string): void {
  console.log(`[BOT] Received ${signal}, shutting down...`);
  // Stop all active voice recordings
  leaveAndStop()
    .catch(() => {})
    .finally(() => {
      client.destroy();
      closePool()
        .then(() => {
          console.log("[BOT] Cleanup complete, exiting");
          process.exit(0);
        })
        .catch(() => process.exit(1));
    });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// Login
console.log("[BOT] Starting Discord bot daemon...");
client.login(TOKEN).catch((err) => {
  console.error("[BOT] Failed to login:", err.message);
  process.exit(1);
});
