# mcp-server-discord

MCP server for Discord integration with D&D session monitoring (Draci Hlidka).

## Architecture

Two separate processes:

1. **Bot daemon** (`bot.ts`) - Runs 24/7 via PM2 on base7
   - Connects to Discord Gateway (WebSocket)
   - Logs all messages from monitored channels to MariaDB
   - Sends intro DM to new users on first contact
   - Handles slash commands (see [Bot Commands](#bot-commands))
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

## Bot Commands

Slash commands handled by the bot daemon. Dispatch uses `switch(true)` in `bot.ts` – adding a new command requires: handler in `commands.ts`, case in the switch, entry in `isCommand()`, and entry in `COMMANDS_MESSAGE`.

| Command | Description |
|---------|-------------|
| `/botka [text]` | Send a query to Claude (also: mention or DM) |
| `/nahravej` | Join voice channel and record audio (no transcription) |
| `/prepis` | Join voice channel, record + transcribe |
| `/prepis stop` \| `/prepis konec` | Stop active recording |
| `/prepis status` \| `/prepis stav` | Show active recording sessions |
| `/anketa Otázka \| A \| B` | Create a poll with emoji reactions |
| `/botka_status` | Show user's interaction stats |
| `/botka_disable` \| `/zakaz` | Revoke recording consent (GDPR) |
| `/botka_intro` | Send intro DM (capabilities overview) |
| `/botka_prikazy` | Send detailed command list to DM |
| `/stop` | Emergency stop (recording + pending queries) |

### User Onboarding

On first contact (any DM or slash command), Botka automatically sends an intro DM.
Known users are tracked in `knownUsers` Set, populated from DB on startup.
Users can re-request the intro at any time with `/botka_intro`.

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
