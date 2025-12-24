-- Single persistent conversation session database schema

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'thought')),
  content TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  metadata TEXT
);

-- Index for efficient timestamp queries
CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
CREATE INDEX IF NOT EXISTS idx_messages_role ON messages(role);
