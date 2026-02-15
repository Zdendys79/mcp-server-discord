module.exports = {
  apps: [
    {
      name: "mcp-server-discord-bot",
      script: "dist/bot.js",
      cwd: "/home/remotes/mcp-server-discord",
      env: {
        NODE_ENV: "production",
        DB_HOST: "127.0.0.1",
        DB_PORT: "3306",
        DB_USER: "claude",
        DB_NAME: "discord_dh",
        // DB_PASSWORD is read from /etc/environment
        // DISCORD_BOT_TOKEN is read from /etc/environment
      },
    },
  ],
};
