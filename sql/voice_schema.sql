-- Discord MCP Server - Voice Recording & Knowledge Bot Schema
-- Database: discord_dh (extends existing schema)
-- Run after schema.sql

USE discord_dh;

-- Voice recording sessions (one per bot join/leave cycle)
CREATE TABLE IF NOT EXISTS voice_sessions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  guild_id VARCHAR(20) NOT NULL,
  channel_id VARCHAR(20) NOT NULL,
  channel_name VARCHAR(100) DEFAULT NULL,
  started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ended_at TIMESTAMP NULL DEFAULT NULL,
  status ENUM('recording', 'ended') DEFAULT 'recording',
  total_chunks INT DEFAULT 0,
  total_transcribed INT DEFAULT 0,
  INDEX idx_channel (channel_id),
  INDEX idx_status (status),
  INDEX idx_started (started_at)
) ENGINE=InnoDB;

-- Individual audio chunks (one per speaking event per user)
CREATE TABLE IF NOT EXISTS voice_chunks (
  id INT AUTO_INCREMENT PRIMARY KEY,
  session_id INT NOT NULL,
  speaker_id VARCHAR(20) NOT NULL COMMENT 'Discord user snowflake ID',
  speaker_name VARCHAR(100) NOT NULL,
  speaker_display_name VARCHAR(100) DEFAULT NULL,
  filename VARCHAR(255) NOT NULL COMMENT 'Relative path under recordings/',
  duration_ms INT DEFAULT NULL COMMENT 'Audio duration in milliseconds',
  file_size INT DEFAULT NULL COMMENT 'File size in bytes',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status ENUM('saved', 'synced', 'transcribing', 'transcribed', 'error') DEFAULT 'saved',
  FOREIGN KEY (session_id) REFERENCES voice_sessions(id) ON DELETE CASCADE,
  INDEX idx_session (session_id),
  INDEX idx_speaker (speaker_id),
  INDEX idx_status (status),
  INDEX idx_created (created_at),
  UNIQUE KEY uk_filename (filename)
) ENGINE=InnoDB;

-- Transcription results (one row per chunk, written by jz-work worker)
CREATE TABLE IF NOT EXISTS voice_transcriptions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  chunk_id INT NOT NULL,
  text TEXT NOT NULL COMMENT 'Transcribed text',
  language VARCHAR(10) DEFAULT 'cs',
  confidence FLOAT DEFAULT NULL,
  model VARCHAR(100) DEFAULT NULL COMMENT 'Model used for transcription',
  processing_time_ms INT DEFAULT NULL,
  transcribed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (chunk_id) REFERENCES voice_chunks(id) ON DELETE CASCADE,
  UNIQUE KEY uk_chunk (chunk_id),
  FULLTEXT idx_text (text)
) ENGINE=InnoDB;

-- Bot knowledge queries (from Discord chat, waiting for jz-work processing)
CREATE TABLE IF NOT EXISTS bot_queries (
  id INT AUTO_INCREMENT PRIMARY KEY,
  channel_id VARCHAR(20) NOT NULL COMMENT 'Discord channel where query was asked',
  message_id VARCHAR(20) DEFAULT NULL COMMENT 'Discord message ID of the query',
  author_id VARCHAR(20) NOT NULL,
  author_name VARCHAR(100) NOT NULL,
  query_text TEXT NOT NULL,
  status ENUM('pending', 'processing', 'answered', 'error') DEFAULT 'pending',
  error_message TEXT DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_status (status),
  INDEX idx_created (created_at)
) ENGINE=InnoDB;

-- Bot knowledge query responses (written by jz-work knowledge worker)
CREATE TABLE IF NOT EXISTS bot_query_responses (
  id INT AUTO_INCREMENT PRIMARY KEY,
  query_id INT NOT NULL,
  response_text TEXT NOT NULL,
  sources_json JSON DEFAULT NULL COMMENT 'Array of source references used',
  model VARCHAR(100) DEFAULT NULL COMMENT 'LLM model used',
  processing_time_ms INT DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (query_id) REFERENCES bot_queries(id) ON DELETE CASCADE,
  UNIQUE KEY uk_query (query_id)
) ENGINE=InnoDB;

-- Voice IPC config entries
INSERT IGNORE INTO bot_config (key_name, value, description) VALUES
  ('voice_command', NULL, 'Pending voice command: join:CHANNEL_ID or leave or leave:GUILD_ID'),
  ('voice_command_result', NULL, 'JSON result of last voice command execution'),
  ('voice_command_at', NULL, 'Timestamp when voice command was issued');
