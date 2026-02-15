#!/bin/bash
# MCP server launcher - called via SSH from Claude Code
# Usage: ssh remotes@base7 bash /home/remotes/mcp-server-discord/run-mcp.sh
source ~/.bashrc 2>/dev/null
cd "$(dirname "$0")"
exec node dist/mcp-server.js
