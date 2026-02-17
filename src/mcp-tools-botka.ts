// Botka reply tool - definitions + handlers
import { getPool } from "./db.js";
import type { ToolEntry } from "./mcp-types.js";
import { jsonResponse, errorResponse } from "./mcp-types.js";

// --- Tool: botka_reply ---

const botkaReplyHandler = async (args: Record<string, unknown>) => {
  const authorId = (args.author_id as string) || null;
  const authorName = (args.author_name as string) || null;
  const content = args.content as string;
  const queryId = args.query_id as number | undefined;

  if (!content) {
    return errorResponse("content is required");
  }

  const db = getPool();

  if (queryId) {
    // Channel query reply
    await db.execute(
      `INSERT INTO bot_query_responses (query_id, response_text, model)
       VALUES (?, ?, 'claude')`,
      [queryId, content]
    );
    await db.execute(
      `UPDATE bot_queries SET status = 'answered' WHERE id = ?`,
      [queryId]
    );

    return jsonResponse({
      success: true,
      type: "channel_reply",
      message: `Channel reply sent for query #${queryId}`,
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
    "either author_id (for DM) or query_id (for channel reply) is required"
  );
};

// --- Exported tool entries ---

export const botkaTools: ToolEntry[] = [
  {
    definition: {
      name: "botka_reply",
      description:
        "Reply to a Discord user via Botka. For DM replies, sends a DM. For channel queries (from [username@botka] with [#channel] prefix), replies in the Discord channel. Provide query_id to reply in channel.",
      inputSchema: {
        type: "object" as const,
        properties: {
          author_id: {
            type: "string",
            description: "Discord user ID to reply to",
          },
          author_name: {
            type: "string",
            description: "Discord username (for logging)",
          },
          content: {
            type: "string",
            description: "Reply message content",
          },
          query_id: {
            type: "number",
            description:
              "Bot query ID (if replying to a channel query). When provided, the reply goes to the Discord channel instead of DM.",
          },
        },
        required: ["content"],
      },
    },
    handler: botkaReplyHandler,
  },
];
