-- Stores public legal corpus metadata for RAG retrieval.

CREATE TABLE IF NOT EXISTS legal_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  law_code TEXT NOT NULL,
  title TEXT NOT NULL,
  version_date TEXT NOT NULL,
  source_url TEXT,
  checksum TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(law_code, version_date, checksum)
);

CREATE TABLE IF NOT EXISTS legal_chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id INTEGER NOT NULL,
  law_code TEXT NOT NULL,
  article TEXT NOT NULL,
  subarticle TEXT,
  article_title TEXT,
  chunk_text TEXT NOT NULL,
  vector_id TEXT NOT NULL UNIQUE,
  source_url TEXT,
  checksum TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(document_id) REFERENCES legal_documents(id)
);

CREATE INDEX IF NOT EXISTS idx_legal_chunks_law_code ON legal_chunks(law_code);
CREATE INDEX IF NOT EXISTS idx_legal_chunks_article ON legal_chunks(law_code, article, subarticle);
CREATE INDEX IF NOT EXISTS idx_legal_chunks_vector_id ON legal_chunks(vector_id);
