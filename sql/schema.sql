-- Discord MCP Server - Database Schema
-- Database: discord_dh

CREATE DATABASE IF NOT EXISTS discord_dh
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE discord_dh;

-- Monitored channels
CREATE TABLE IF NOT EXISTS channels (
  id VARCHAR(20) PRIMARY KEY COMMENT 'Discord channel snowflake ID',
  name VARCHAR(100) NOT NULL,
  guild_id VARCHAR(20) NOT NULL,
  guild_name VARCHAR(100) DEFAULT NULL,
  project VARCHAR(50) DEFAULT NULL COMMENT 'dh_charlie, dh_robo, general, etc.',
  monitoring_enabled BOOLEAN DEFAULT TRUE,
  last_message_at TIMESTAMP NULL DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_guild (guild_id),
  INDEX idx_project (project)
) ENGINE=InnoDB;

-- Stored messages
CREATE TABLE IF NOT EXISTS messages (
  id VARCHAR(20) PRIMARY KEY COMMENT 'Discord message snowflake ID',
  channel_id VARCHAR(20) NOT NULL,
  author_id VARCHAR(20) NOT NULL,
  author_name VARCHAR(100) NOT NULL,
  author_display_name VARCHAR(100) DEFAULT NULL,
  content TEXT,
  has_attachments BOOLEAN DEFAULT FALSE,
  attachment_urls JSON DEFAULT NULL,
  reply_to_id VARCHAR(20) DEFAULT NULL,
  is_bot BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL COMMENT 'Discord message timestamp',
  indexed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE,
  INDEX idx_channel_time (channel_id, created_at),
  INDEX idx_author (author_id),
  INDEX idx_created (created_at),
  FULLTEXT idx_content (content)
) ENGINE=InnoDB;

-- Bot configuration key-value store
CREATE TABLE IF NOT EXISTS bot_config (
  key_name VARCHAR(100) PRIMARY KEY,
  value TEXT,
  description VARCHAR(255) DEFAULT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- Initial config
INSERT IGNORE INTO bot_config (key_name, value, description) VALUES
  ('bot_started_at', NULL, 'Timestamp when bot daemon started'),
  ('messages_logged_total', '0', 'Total messages logged since start');

-- Grant permissions for claude user
GRANT ALL PRIVILEGES ON discord_dh.* TO 'claude'@'localhost';
FLUSH PRIVILEGES;
