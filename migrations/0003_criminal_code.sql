-- ========================================
-- 🏛️ CRIMINAL CODE ANALYSIS TABLES
-- ========================================
-- Migration for Criminal Code of Russian Federation analysis functionality
-- Creates tables for violations tracking, statistics and caching

-- Main table for storing criminal violations found in messages
CREATE TABLE criminal_violations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  chat_id INTEGER NOT NULL,
  message_id INTEGER,
  article TEXT NOT NULL,
  quote TEXT NOT NULL,
  punishment TEXT,
  severity INTEGER CHECK (severity BETWEEN 1 AND 10),
  confidence REAL CHECK (confidence BETWEEN 0.0 AND 1.0),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Aggregated statistics table for users and chats
CREATE TABLE violation_stats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  chat_id INTEGER,
  total_violations INTEGER DEFAULT 0,
  avg_severity REAL DEFAULT 0.0,
  most_common_article TEXT,
  last_violation_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, chat_id)
);

-- Cache table for analysis results to improve performance
CREATE TABLE criminal_analysis_cache (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  text_hash TEXT UNIQUE NOT NULL,
  analysis_result TEXT NOT NULL, -- JSON string
  expires_at DATETIME NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for better performance
CREATE INDEX idx_criminal_violations_user_chat ON criminal_violations(user_id, chat_id);
CREATE INDEX idx_criminal_violations_created_at ON criminal_violations(created_at);
CREATE INDEX idx_criminal_violations_article ON criminal_violations(article);
CREATE INDEX idx_criminal_violations_severity ON criminal_violations(severity);

CREATE INDEX idx_violation_stats_user_chat ON violation_stats(user_id, chat_id);
CREATE INDEX idx_violation_stats_last_violation ON violation_stats(last_violation_at);

CREATE INDEX idx_criminal_cache_hash ON criminal_analysis_cache(text_hash);
CREATE INDEX idx_criminal_cache_expires ON criminal_analysis_cache(expires_at);

-- Trigger to automatically update violation statistics
CREATE TRIGGER update_violation_stats
AFTER INSERT ON criminal_violations
FOR EACH ROW
BEGIN
  INSERT OR REPLACE INTO violation_stats (
    user_id, 
    chat_id, 
    total_violations, 
    avg_severity, 
    most_common_article, 
    last_violation_at,
    updated_at
  )
  SELECT 
    NEW.user_id,
    NEW.chat_id,
    COUNT(*) as total_violations,
    AVG(severity) as avg_severity,
    (
      SELECT article 
      FROM criminal_violations 
      WHERE user_id = NEW.user_id AND chat_id = NEW.chat_id 
      GROUP BY article 
      ORDER BY COUNT(*) DESC 
      LIMIT 1
    ) as most_common_article,
    MAX(created_at) as last_violation_at,
    CURRENT_TIMESTAMP as updated_at
  FROM criminal_violations 
  WHERE user_id = NEW.user_id AND chat_id = NEW.chat_id;
END;
