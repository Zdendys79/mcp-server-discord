// Discord Bot Daemon - runs 24/7 via PM2, logs messages to MariaDB
import { Client, GatewayIntentBits, Events, Partials } from "discord.js";
import {
  storeMessage,
  ensureChannel,
  isChannelMonitored,
  updateChannelLastMessage,
  closePool,
  getPool,
} from "./db.js";

const TOKEN = process.env.DISCORD_BOT_TOKEN;
if (!TOKEN) {
  console.error("[BOT] DISCORD_BOT_TOKEN environment variable is required");
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
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
});

client.on(Events.MessageCreate, async (message) => {
  try {
    // Skip DM messages
    if (!message.guild) return;

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

// Graceful shutdown
function shutdown(signal: string): void {
  console.log(`[BOT] Received ${signal}, shutting down...`);
  client.destroy();
  closePool()
    .then(() => {
      console.log("[BOT] Cleanup complete, exiting");
      process.exit(0);
    })
    .catch(() => process.exit(1));
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// Login
console.log("[BOT] Starting Discord bot daemon...");
client.login(TOKEN).catch((err) => {
  console.error("[BOT] Failed to login:", err.message);
  process.exit(1);
});
