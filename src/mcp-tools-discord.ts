// Discord message and channel tools - definitions + handlers
import { REST, Routes } from "discord.js";
import {
  readMessages,
  searchMessages,
  getMonitoredChannels,
  getChannelHistory,
  addChannel,
  getBotStatus,
} from "./db.js";
import type { ToolEntry } from "./mcp-types.js";
import { jsonResponse, errorResponse } from "./mcp-types.js";

// Discord REST client (no Gateway needed for MCP)
const TOKEN = process.env.DISCORD_BOT_TOKEN;
const discordRest = TOKEN ? new REST().setToken(TOKEN) : null;

function requireDiscordRest() {
  if (!discordRest) {
    throw new Error("DISCORD_BOT_TOKEN not set, cannot query Discord API.");
  }
  return discordRest;
}

// --- Tool: discord_read_messages ---

const readMessagesHandler = async (
  args: Record<string, unknown>
) => {
  const limit = Math.min((args.limit as number) || 50, 200);
  let channelId = args.channel_id as string | undefined;

  if (!channelId && args.channel_name) {
    const channels = await getMonitoredChannels();
    const match = channels.find(
      (c) =>
        c.name === args.channel_name ||
        c.name.includes(args.channel_name as string)
    );
    if (!match) {
      return errorResponse(
        `Channel "${args.channel_name}" not found. Use discord_list_channels to see available channels.`
      );
    }
    channelId = match.id;
  }

  if (!channelId) {
    return errorResponse("Either channel_id or channel_name is required.");
  }

  const messages = await readMessages(channelId, limit);
  return jsonResponse(messages);
};

// --- Tool: discord_send_message ---

const sendMessageHandler = async (
  args: Record<string, unknown>
) => {
  const rest = requireDiscordRest();
  const channelId = args.channel_id as string;
  const content = args.content as string;

  if (!content || content.length > 2000) {
    return errorResponse("Content is required and must be <= 2000 characters.");
  }

  const result = await rest.post(Routes.channelMessages(channelId), {
    body: { content },
  });

  return jsonResponse({
    success: true,
    message_id: (result as { id: string }).id,
  });
};

// --- Tool: discord_search_messages ---

const searchMessagesHandler = async (
  args: Record<string, unknown>
) => {
  const query = args.query as string;
  const channelId = args.channel_id as string | undefined;
  const project = args.project as string | undefined;
  const limit = Math.min((args.limit as number) || 50, 200);

  const results = await searchMessages(query, channelId, project, limit);
  return jsonResponse(results);
};

// --- Tool: discord_list_channels ---

const listChannelsHandler = async () => {
  const channels = await getMonitoredChannels();
  return jsonResponse(channels);
};

// --- Tool: discord_get_channel_history ---

const getChannelHistoryHandler = async (
  args: Record<string, unknown>
) => {
  const channelId = args.channel_id as string;
  const from = args.from as string;
  const to = args.to as string;

  const history = await getChannelHistory(channelId, from, to);
  return jsonResponse(history);
};

// --- Tool: discord_add_channel ---

const addChannelHandler = async (
  args: Record<string, unknown>
) => {
  const channelId = args.channel_id as string;
  const channelName = args.name as string;
  const guildId = args.guild_id as string;
  const project = (args.project as string) || null;

  await addChannel(channelId, channelName, guildId, null, project);
  return jsonResponse({
    success: true,
    message: `Channel #${channelName} (${channelId}) added to monitoring.`,
  });
};

// --- Tool: discord_fetch_messages ---

interface DiscordMessage {
  id: string;
  author: { username: string; global_name?: string | null; id: string };
  content: string;
  timestamp: string;
  attachments?: Array<{ url: string; filename: string }>;
  referenced_message?: { id: string } | null;
}

const fetchMessagesHandler = async (
  args: Record<string, unknown>
) => {
  const rest = requireDiscordRest();
  const channelId = args.channel_id as string;
  const maxMessages = Math.min((args.limit as number) || 100, 500);
  const beforeId = args.before as string | undefined;
  const afterId = args.after as string | undefined;

  const allMessages: DiscordMessage[] = [];
  let cursor = beforeId;
  const batchSize = 100;

  while (allMessages.length < maxMessages) {
    const params = new URLSearchParams();
    params.set(
      "limit",
      String(Math.min(batchSize, maxMessages - allMessages.length))
    );
    if (afterId && allMessages.length === 0) {
      params.set("after", afterId);
    } else if (cursor) {
      params.set("before", cursor);
    }

    const batch = (await rest.get(Routes.channelMessages(channelId), {
      query: params,
    })) as DiscordMessage[];

    if (batch.length === 0) break;
    allMessages.push(...batch);
    cursor = batch[batch.length - 1].id;
    if (batch.length < batchSize) break;
  }

  allMessages.reverse();

  const formatted = allMessages.map((m) => ({
    id: m.id,
    date: m.timestamp.substring(0, 10),
    time: m.timestamp.substring(11, 16),
    author: m.author.global_name || m.author.username,
    author_id: m.author.id,
    content: m.content || "[no text]",
    attachments: m.attachments?.length
      ? m.attachments.map((a) => a.filename)
      : undefined,
    reply_to: m.referenced_message?.id || undefined,
  }));

  return jsonResponse({
    channel_id: channelId,
    count: formatted.length,
    messages: formatted,
  });
};

// --- Tool: discord_list_guilds ---

const listGuildsHandler = async () => {
  const rest = requireDiscordRest();
  const guilds = (await rest.get(Routes.userGuilds())) as Array<{
    id: string;
    name: string;
    icon: string | null;
    owner: boolean;
  }>;

  return jsonResponse(
    guilds.map((g) => ({ id: g.id, name: g.name, owner: g.owner }))
  );
};

// --- Tool: discord_list_guild_channels ---

const CHANNEL_TYPE_NAMES: Record<number, string> = {
  0: "text",
  2: "voice",
  4: "category",
  5: "announcement",
  13: "stage",
  15: "forum",
  16: "media",
};

const listGuildChannelsHandler = async (
  args: Record<string, unknown>
) => {
  const rest = requireDiscordRest();
  const guildId = args.guild_id as string;

  const allChannels = (await rest.get(
    Routes.guildChannels(guildId)
  )) as Array<{
    id: string;
    name: string;
    type: number;
    parent_id: string | null;
    position: number;
  }>;

  const categories = new Map<string, string>();
  for (const ch of allChannels) {
    if (ch.type === 4) {
      categories.set(ch.id, ch.name);
    }
  }

  const textChannels = allChannels
    .filter((ch) => ch.type === 0)
    .sort((a, b) => a.position - b.position)
    .map((ch) => ({
      id: ch.id,
      name: ch.name,
      category: ch.parent_id ? categories.get(ch.parent_id) || null : null,
    }));

  return jsonResponse({
    guild_id: guildId,
    total_channels: allChannels.length,
    text_channels: textChannels.length,
    channels: textChannels,
  });
};

// --- Tool: discord_bot_status ---

const botStatusHandler = async () => {
  const status = await getBotStatus();
  return jsonResponse(status);
};

// --- Exported tool entries ---

export const discordTools: ToolEntry[] = [
  {
    definition: {
      name: "discord_read_messages",
      description:
        "Read recent messages from a monitored Discord channel. Returns messages from MariaDB cache.",
      inputSchema: {
        type: "object" as const,
        properties: {
          channel_id: { type: "string", description: "Discord channel ID" },
          channel_name: {
            type: "string",
            description: "Channel name (alternative to channel_id - will search by name)",
          },
          limit: {
            type: "number",
            description: "Number of messages to return (default: 50, max: 200)",
          },
        },
      },
    },
    handler: readMessagesHandler,
  },
  {
    definition: {
      name: "discord_send_message",
      description: "Send a message to a Discord channel via REST API.",
      inputSchema: {
        type: "object" as const,
        properties: {
          channel_id: {
            type: "string",
            description: "Discord channel ID to send to",
          },
          content: {
            type: "string",
            description: "Message content (max 2000 characters)",
          },
        },
        required: ["channel_id", "content"],
      },
    },
    handler: sendMessageHandler,
  },
  {
    definition: {
      name: "discord_search_messages",
      description:
        "Full-text search across Discord messages stored in MariaDB. Supports boolean mode (+word -word).",
      inputSchema: {
        type: "object" as const,
        properties: {
          query: {
            type: "string",
            description:
              'Search query (supports boolean: +required -excluded "exact phrase")',
          },
          channel_id: {
            type: "string",
            description: "Limit search to specific channel (optional)",
          },
          project: {
            type: "string",
            description:
              "Limit search to project channels: dh_charlie, dh_robo, general (optional)",
          },
          limit: { type: "number", description: "Max results (default: 50)" },
        },
        required: ["query"],
      },
    },
    handler: searchMessagesHandler,
  },
  {
    definition: {
      name: "discord_list_channels",
      description:
        "List all monitored Discord channels with message counts and last activity.",
      inputSchema: { type: "object" as const, properties: {} },
    },
    handler: listChannelsHandler,
  },
  {
    definition: {
      name: "discord_get_channel_history",
      description: "Get message history from a channel for a specific date range.",
      inputSchema: {
        type: "object" as const,
        properties: {
          channel_id: { type: "string", description: "Discord channel ID" },
          from: {
            type: "string",
            description: "Start date (YYYY-MM-DD or YYYY-MM-DD HH:MM:SS)",
          },
          to: {
            type: "string",
            description: "End date (YYYY-MM-DD or YYYY-MM-DD HH:MM:SS)",
          },
        },
        required: ["channel_id", "from", "to"],
      },
    },
    handler: getChannelHistoryHandler,
  },
  {
    definition: {
      name: "discord_add_channel",
      description:
        "Add a Discord channel to monitoring. Bot daemon will start logging messages from this channel.",
      inputSchema: {
        type: "object" as const,
        properties: {
          channel_id: {
            type: "string",
            description: "Discord channel ID to monitor",
          },
          name: { type: "string", description: "Channel name for reference" },
          guild_id: { type: "string", description: "Discord guild (server) ID" },
          project: {
            type: "string",
            description: "Project tag: dh_charlie, dh_robo, general (optional)",
          },
        },
        required: ["channel_id", "name", "guild_id"],
      },
    },
    handler: addChannelHandler,
  },
  {
    definition: {
      name: "discord_list_guilds",
      description:
        "List all Discord servers (guilds) the bot is a member of. Use this to discover guild IDs before listing channels.",
      inputSchema: { type: "object" as const, properties: {} },
    },
    handler: listGuildsHandler,
  },
  {
    definition: {
      name: "discord_list_guild_channels",
      description:
        "List all text channels in a Discord guild. Use this to discover channel IDs before adding them to monitoring.",
      inputSchema: {
        type: "object" as const,
        properties: {
          guild_id: {
            type: "string",
            description: "Discord guild (server) ID",
          },
        },
        required: ["guild_id"],
      },
    },
    handler: listGuildChannelsHandler,
  },
  {
    definition: {
      name: "discord_fetch_messages",
      description:
        "Fetch messages directly from Discord REST API (not from DB cache). Use this to read historical messages from any channel the bot can access. Returns messages in chronological order.",
      inputSchema: {
        type: "object" as const,
        properties: {
          channel_id: {
            type: "string",
            description: "Discord channel ID to fetch from",
          },
          limit: {
            type: "number",
            description:
              "Number of messages to fetch (default: 100, max: 500). Fetches in batches of 100.",
          },
          before: {
            type: "string",
            description: "Fetch messages before this message ID (for pagination)",
          },
          after: {
            type: "string",
            description: "Fetch messages after this message ID (for newer messages)",
          },
        },
        required: ["channel_id"],
      },
    },
    handler: fetchMessagesHandler,
  },
  {
    definition: {
      name: "discord_bot_status",
      description:
        "Get bot status: total messages logged, monitored channels, database stats.",
      inputSchema: { type: "object" as const, properties: {} },
    },
    handler: botStatusHandler,
  },
];
