# STATUS.md - mcp-server-discord

**Last Updated:** 2026-02-15
**Current Phase:** Bot running, MCP functional, missing guild discovery tools

---

## Current State

- Bot daemon: Running on base7 via PM2 (`DH Scribe Bot#3962`)
- MCP server: Functional, launched via SSH from jz-work
- Database: `discord_dh` on base7 MariaDB (schema OK)
- Guild: SF&F Club DRAKONIAN Most (263381917523640321) - 30 text channels
- Monitored channels: 1 (dh-trigon-u-zdendyse, test)

---

## Feature Requests

### 1. `discord_list_guilds` - List bot's guilds

MCP tool to list all Discord servers (guilds) the bot is a member of.
Bot doesn't know in advance where it will be used - MCP must be able to discover guilds.

**Implementation:** Discord REST API `GET /users/@me/guilds` (already have REST client in mcp-server.ts)

### 2. `discord_list_guild_channels(guild_id)` - List guild channels

MCP tool to list all text channels in a specific guild.
Needed to discover channel IDs before adding them to monitoring.

**Implementation:** Discord REST API `GET /guilds/{guild_id}/channels` (filter type=0 for text)

### 3. Bot should NOT do anything automatically on startup

Bot is a tool - all actions driven by MCP commands. No auto-registration,
no auto-monitoring. Bot connects to Gateway, receives events, and responds
to what MCP has configured (monitored channels in DB).

---

## Known Issues

### 1. No message backfill

When a channel is added to monitoring, only NEW messages are captured.
Historical messages are not fetched. Could use REST API `GET /channels/{id}/messages`
to backfill.

### 2. `guild_name` not populated in channels table

`discord_add_channel` doesn't set `guild_name`. Could be fetched via REST API
when adding channel.

---

## Architecture

```
Discord Gateway <-- Bot daemon (base7, PM2) --> MariaDB discord_dh
                                                       ^
                                    MCP server (reads DB, REST API) --> Claude Code
```

MCP server has Discord REST client - can query guilds/channels without Gateway.
Bot daemon only needed for real-time message logging via Gateway events.

---

**Version:** 2026-02-15
