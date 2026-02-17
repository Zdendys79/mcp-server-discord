// MCP Server - launched via SSH from Claude Code (stdio transport)
// Reads from MariaDB (populated by bot daemon), sends via Discord REST API
//
// Tool modules are organized by domain:
//   mcp-tools-discord.ts - Discord message/channel tools
//   mcp-tools-voice.ts   - Voice recording/transcription tools
//   mcp-tools-botka.ts   - Botka reply tool
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { closePool } from "./db.js";
import type { ToolEntry, ToolHandler } from "./mcp-types.js";
import { errorResponse } from "./mcp-types.js";
import { discordTools } from "./mcp-tools-discord.js";
import { voiceTools } from "./mcp-tools-voice.js";
import { botkaTools } from "./mcp-tools-botka.js";

const VERSION = process.env.npm_package_version || "0.1.0";

// Collect all tools from modules
const allTools: ToolEntry[] = [
  ...discordTools,
  ...voiceTools,
  ...botkaTools,
];

// Build handler lookup map for O(1) dispatch
const handlerMap = new Map<string, ToolHandler>();
for (const tool of allTools) {
  handlerMap.set(tool.definition.name, tool.handler);
}

// Create MCP server
const server = new Server(
  { name: "mcp-server-discord", version: VERSION },
  { capabilities: { tools: {} } }
);

// Register tool definitions
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: allTools.map((t) => t.definition),
}));

// Route tool calls to handlers
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  const handler = handlerMap.get(name);
  if (!handler) {
    return errorResponse(`Unknown tool: ${name}`);
  }

  try {
    return await handler((args as Record<string, unknown>) || {});
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return errorResponse(message);
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
