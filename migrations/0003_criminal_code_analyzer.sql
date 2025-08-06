-- Миграция для системы анализа нарушений УК РФ

-- Таблица статей УК РФ
CREATE TABLE IF NOT EXISTS criminal_articles (
  number TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  category TEXT NOT NULL,
  subcategory TEXT,
  severity TEXT NOT NULL,
  keywords TEXT NOT NULL, -- JSON array
  related_articles TEXT, -- JSON array
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Части статей с санкциями
CREATE TABLE IF NOT EXISTS article_parts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  article_number TEXT NOT NULL,
  part_number TEXT NOT NULL,
  content TEXT NOT NULL,
  penalties TEXT NOT NULL, -- JSON array
  FOREIGN KEY (article_number) REFERENCES criminal_articles(number)
);

-- Результаты анализа сообщений
CREATE TABLE IF NOT EXISTS message_analyses (
  id TEXT PRIMARY KEY,
  message_hash TEXT NOT NULL,
  user_hash TEXT NOT NULL,
  chat_hash TEXT NOT NULL,
  timestamp DATETIME NOT NULL,
  violation_found BOOLEAN NOT NULL,
  severity_level TEXT,
  articles_violated TEXT, -- JSON array
  confidence REAL,
  processing_time_ms INTEGER,
  review_status TEXT DEFAULT 'pending',
  context_data TEXT, -- JSON with tone, intent analysis
  llm_reasoning TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Ежедневная статистика по нарушениям УК РФ
CREATE TABLE IF NOT EXISTS criminal_daily_stats (
  date DATE PRIMARY KEY,
  total_messages INTEGER DEFAULT 0,
  analyzed_messages INTEGER DEFAULT 0,
  violations_found INTEGER DEFAULT 0,
  avg_processing_time REAL DEFAULT 0,
  severity_breakdown TEXT, -- JSON object
  top_articles TEXT, -- JSON array
  chat_breakdown TEXT, -- JSON object with per-chat stats
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Версионирование УК РФ
CREATE TABLE IF NOT EXISTS criminal_code_versions (
  version TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  updated_at DATETIME NOT NULL,
  articles_count INTEGER NOT NULL,
  checksum TEXT NOT NULL,
  scraping_success BOOLEAN DEFAULT TRUE
);

-- Конфигурация системы анализа УК РФ
CREATE TABLE IF NOT EXISTS criminal_system_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Категории преступлений
CREATE TABLE IF NOT EXISTS crime_categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  articles TEXT NOT NULL -- JSON array
);

-- Индексы для оптимизации поиска
CREATE INDEX IF NOT EXISTS idx_criminal_articles_category ON criminal_articles(category);
CREATE INDEX IF NOT EXISTS idx_criminal_articles_severity ON criminal_articles(severity);
CREATE INDEX IF NOT EXISTS idx_criminal_articles_title ON criminal_articles(title);

CREATE INDEX IF NOT EXISTS idx_message_analyses_timestamp ON message_analyses(timestamp);
CREATE INDEX IF NOT EXISTS idx_message_analyses_chat ON message_analyses(chat_hash);
CREATE INDEX IF NOT EXISTS idx_message_analyses_severity ON message_analyses(severity_level);
CREATE INDEX IF NOT EXISTS idx_message_analyses_violation ON message_analyses(violation_found);

CREATE INDEX IF NOT EXISTS idx_criminal_daily_stats_date ON criminal_daily_stats(date);

-- Полнотекстовый поиск для статей УК РФ
CREATE VIRTUAL TABLE IF NOT EXISTS criminal_articles_fts USING fts5(
  number,
  title,
  content,
  keywords,
  content='criminal_articles',
  content_rowid='rowid'
);

-- Триггеры для поддержания FTS индекса
CREATE TRIGGER IF NOT EXISTS criminal_articles_fts_insert AFTER INSERT ON criminal_articles BEGIN
  INSERT INTO criminal_articles_fts(rowid, number, title, content, keywords) 
  VALUES (new.rowid, new.number, new.title, new.content, new.keywords);
END;

CREATE TRIGGER IF NOT EXISTS criminal_articles_fts_delete AFTER DELETE ON criminal_articles BEGIN
  INSERT INTO criminal_articles_fts(criminal_articles_fts, rowid, number, title, content, keywords) 
  VALUES('delete', old.rowid, old.number, old.title, old.content, old.keywords);
END;

CREATE TRIGGER IF NOT EXISTS criminal_articles_fts_update AFTER UPDATE ON criminal_articles BEGIN
  INSERT INTO criminal_articles_fts(criminal_articles_fts, rowid, number, title, content, keywords) 
  VALUES('delete', old.rowid, old.number, old.title, old.content, old.keywords);
  INSERT INTO criminal_articles_fts(rowid, number, title, content, keywords) 
  VALUES (new.rowid, new.number, new.title, new.content, new.keywords);
END;