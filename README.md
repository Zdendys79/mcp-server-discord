# mcp-server-discord

MCP server for Discord integration with D&D session monitoring (Draci Hlidka).

## Architecture

Two separate processes:

1. **Bot daemon** (`bot.ts`) - Runs 24/7 via PM2 on base7
   - Connects to Discord Gateway (WebSocket)
   - Logs all messages from monitored channels to MariaDB
   - Graceful shutdown on SIGTERM

2. **MCP server** (`mcp-server.ts`) - Launched on-demand via SSH from Claude Code
   - Reads messages from MariaDB (populated by bot daemon)
   - Sends messages via Discord REST API
   - stdio transport for MCP protocol

## Setup

### Prerequisites
- Node.js 22+
- MariaDB with `discord_dh` database
- Discord bot token

### Install
```bash
npm install
npm run build
```

### Database
```bash
mysql -u claude -p < sql/schema.sql
```

### Environment Variables
```bash
export DISCORD_BOT_TOKEN="your-token"
export DB_HOST="127.0.0.1"
export DB_PORT="3306"
export DB_USER="claude"
export DB_PASS="your-password"
export DB_NAME="discord_dh"
```

### Run bot daemon (PM2)
```bash
pm2 start dist/bot.js --name mcp-server-discord-bot
pm2 save
```

### MCP client config (Claude Code on jz-work)
```json
{
  "mcpServers": {
    "discord": {
      "command": "ssh",
      "args": ["remotes@base7", "bash", "/home/remotes/mcp-server-discord/run-mcp.sh"]
    }
  }
}
```

## MCP Tools

| Tool | Description |
|------|-------------|
| `discord_read_messages` | Read recent messages from a channel |
| `discord_send_message` | Send a message to a channel |
| `discord_search_messages` | Full-text search across messages |
| `discord_list_channels` | List monitored channels |
| `discord_get_channel_history` | Get messages for a date range |
| `discord_add_channel` | Add channel to monitoring |
| `discord_bot_status` | Bot and database statistics |
