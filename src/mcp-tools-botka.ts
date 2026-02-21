// Botka reply tool - definitions + handlers
import { getPool } from "./db.js";
import type { ToolEntry } from "./mcp-types.js";
import { jsonResponse, errorResponse } from "./mcp-types.js";

// --- Tool: botka_reply ---

const botkaReplyHandler = async (args: Record<string, unknown>) => {
  const authorId = (args.author_id as string) || null;
  const authorName = (args.author_name as string) || null;
  const content = args.content as string;
  const channelId = args.channel_id as string | undefined;

  if (!content) {
    return errorResponse("content is required");
  }

  const db = getPool();

  if (channelId) {
    // Channel reply - send via discord_outgoing
    await db.execute(
      `INSERT INTO discord_outgoing (channel_id, content)
       VALUES (?, ?)`,
      [channelId, content]
    );

    return jsonResponse({
      success: true,
      type: "channel_reply",
      message: `Channel reply queued for channel ${channelId}`,
    });
  }

  if (authorId) {
    // DM reply
    await db.execute(
      `INSERT INTO botka_replies (target_author_id, target_author_name, content)
       VALUES (?, ?, ?)`,
      [authorId, authorName, content]
    );

    return jsonResponse({
      success: true,
      type: "dm_reply",
      message: `DM reply queued for ${authorName || authorId}`,
    });
  }

  return errorResponse(
    "either author_id (for DM) or channel_id (for channel reply) is required"
  );
};

// --- Exported tool entries ---

export const botkaTools: ToolEntry[] = [
  {
    definition: {
      name: "botka_reply",
      description:
        "Reply to a Discord user via Botka. For DM replies, provide author_id. For channel replies, provide channel_id (from botka_messages content).",
      inputSchema: {
        type: "object" as const,
        properties: {
          author_id: {
            type: "string",
            description: "Discord user ID to reply to (for DM)",
          },
          author_name: {
            type: "string",
            description: "Discord username (for logging)",
          },
          content: {
            type: "string",
            description: "Reply message content",
          },
          channel_id: {
            type: "string",
            description:
              "Discord channel ID (for channel reply). Extract from botka_messages content.",
          },
        },
        required: ["content"],
      },
    },
    handler: botkaReplyHandler,
  },
];
