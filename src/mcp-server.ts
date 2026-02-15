// MCP Server - launched via SSH from Claude Code (stdio transport)
// Reads from MariaDB (populated by bot daemon), sends via Discord REST API
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { REST, Routes } from "discord.js";
import {
  readMessages,
  searchMessages,
  getMonitoredChannels,
  getChannelHistory,
  addChannel,
  getBotStatus,
  closePool,
} from "./db.js";

const VERSION = process.env.npm_package_version || "0.1.0";

// Discord REST client for sending messages (no Gateway needed)
const TOKEN = process.env.DISCORD_BOT_TOKEN;
const discordRest = TOKEN ? new REST().setToken(TOKEN) : null;

const server = new Server(
  { name: "mcp-server-discord", version: VERSION },
  { capabilities: { tools: {} } }
);

// Tool definitions
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "discord_read_messages",
      description:
        "Read recent messages from a monitored Discord channel. Returns messages from MariaDB cache.",
      inputSchema: {
        type: "object" as const,
        properties: {
          channel_id: {
            type: "string",
            description: "Discord channel ID",
          },
          channel_name: {
            type: "string",
            description:
              "Channel name (alternative to channel_id - will search by name)",
          },
          limit: {
            type: "number",
            description: "Number of messages to return (default: 50, max: 200)",
          },
        },
      },
    },
    {
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
    {
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
          limit: {
            type: "number",
            description: "Max results (default: 50)",
          },
        },
        required: ["query"],
      },
    },
    {
      name: "discord_list_channels",
      description:
        "List all monitored Discord channels with message counts and last activity.",
      inputSchema: {
        type: "object" as const,
        properties: {},
      },
    },
    {
      name: "discord_get_channel_history",
      description:
        "Get message history from a channel for a specific date range.",
      inputSchema: {
        type: "object" as const,
        properties: {
          channel_id: {
            type: "string",
            description: "Discord channel ID",
          },
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
    {
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
          name: {
            type: "string",
            description: "Channel name for reference",
          },
          guild_id: {
            type: "string",
            description: "Discord guild (server) ID",
          },
          project: {
            type: "string",
            description:
              "Project tag: dh_charlie, dh_robo, general (optional)",
          },
        },
        required: ["channel_id", "name", "guild_id"],
      },
    },
    {
      name: "discord_list_guilds",
      description:
        "List all Discord servers (guilds) the bot is a member of. Use this to discover guild IDs before listing channels.",
      inputSchema: {
        type: "object" as const,
        properties: {},
      },
    },
    {
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
    {
      name: "discord_bot_status",
      description:
        "Get bot status: total messages logged, monitored channels, database stats.",
      inputSchema: {
        type: "object" as const,
        properties: {},
      },
    },
  ],
}));

// Tool implementations
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "discord_read_messages": {
        const limit = Math.min((args?.limit as number) || 50, 200);

        let channelId = args?.channel_id as string | undefined;

        // If channel_name provided, look up ID
        if (!channelId && args?.channel_name) {
          const channels = await getMonitoredChannels();
          const match = channels.find(
            (c) =>
              c.name === args.channel_name ||
              c.name.includes(args.channel_name as string)
          );
          if (!match) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Channel "${args.channel_name}" not found. Use discord_list_channels to see available channels.`,
                },
              ],
            };
          }
          channelId = match.id;
        }

        if (!channelId) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Either channel_id or channel_name is required.",
              },
            ],
          };
        }

        const messages = await readMessages(channelId, limit);
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(messages, null, 2) },
          ],
        };
      }

      case "discord_send_message": {
        if (!discordRest) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Error: DISCORD_BOT_TOKEN not set, cannot send messages.",
              },
            ],
            isError: true,
          };
        }

        const channelId = args?.channel_id as string;
        const content = args?.content as string;

        if (!content || content.length > 2000) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Error: Content is required and must be <= 2000 characters.",
              },
            ],
            isError: true,
          };
        }

        const result = await discordRest.post(
          Routes.channelMessages(channelId),
          { body: { content } }
        );

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                { success: true, message_id: (result as { id: string }).id },
                null,
                2
              ),
            },
          ],
        };
      }

      case "discord_search_messages": {
        const query = args?.query as string;
        const channelId = args?.channel_id as string | undefined;
        const project = args?.project as string | undefined;
        const limit = Math.min((args?.limit as number) || 50, 200);

        const results = await searchMessages(query, channelId, project, limit);
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(results, null, 2) },
          ],
        };
      }

      case "discord_list_channels": {
        const channels = await getMonitoredChannels();
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(channels, null, 2) },
          ],
        };
      }

      case "discord_get_channel_history": {
        const channelId = args?.channel_id as string;
        const from = args?.from as string;
        const to = args?.to as string;

        const history = await getChannelHistory(channelId, from, to);
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(history, null, 2) },
          ],
        };
      }

      case "discord_add_channel": {
        const channelId = args?.channel_id as string;
        const channelName = args?.name as string;
        const guildId = args?.guild_id as string;
        const project = (args?.project as string) || null;

        await addChannel(channelId, channelName, guildId, null, project);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  success: true,
                  message: `Channel #${channelName} (${channelId}) added to monitoring.`,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case "discord_list_guilds": {
        if (!discordRest) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Error: DISCORD_BOT_TOKEN not set, cannot query Discord API.",
              },
            ],
            isError: true,
          };
        }

        const guilds = (await discordRest.get(Routes.userGuilds())) as Array<{
          id: string;
          name: string;
          icon: string | null;
          owner: boolean;
        }>;

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                guilds.map((g) => ({
                  id: g.id,
                  name: g.name,
                  owner: g.owner,
                })),
                null,
                2
              ),
            },
          ],
        };
      }

      case "discord_list_guild_channels": {
        if (!discordRest) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Error: DISCORD_BOT_TOKEN not set, cannot query Discord API.",
              },
            ],
            isError: true,
          };
        }

        const guildId = args?.guild_id as string;
        const allChannels = (await discordRest.get(
          Routes.guildChannels(guildId)
        )) as Array<{
          id: string;
          name: string;
          type: number;
          parent_id: string | null;
          position: number;
        }>;

        // Channel type names
        const typeNames: Record<number, string> = {
          0: "text",
          2: "voice",
          4: "category",
          5: "announcement",
          13: "stage",
          15: "forum",
          16: "media",
        };

        // Build category name lookup
        const categories = new Map<string, string>();
        for (const ch of allChannels) {
          if (ch.type === 4) {
            categories.set(ch.id, ch.name);
          }
        }

        // Return text channels sorted by position, with category info
        const textChannels = allChannels
          .filter((ch) => ch.type === 0)
          .sort((a, b) => a.position - b.position)
          .map((ch) => ({
            id: ch.id,
            name: ch.name,
            category: ch.parent_id ? categories.get(ch.parent_id) || null : null,
          }));

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  guild_id: guildId,
                  total_channels: allChannels.length,
                  text_channels: textChannels.length,
                  channels: textChannels,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case "discord_bot_status": {
        const status = await getBotStatus();
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(status, null, 2) },
          ],
        };
      }

      default:
        return {
          content: [
            { type: "text" as const, text: `Unknown tool: ${name}` },
          ],
          isError: true,
        };
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: "text" as const, text: `Error: ${errorMessage}` }],
      isError: true,
    };
  }
});

// Startup
async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[MCP] Discord MCP server running on stdio");
}

// Cleanup on exit
process.on("SIGTERM", async () => {
  await closePool();
  process.exit(0);
});

main().catch((error) => {
  console.error("[MCP] Fatal error:", error);
  process.exit(1);
});
