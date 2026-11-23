CREATE TABLE conversation_groups (
  chat_id INTEGER PRIMARY KEY,
  since INTEGER NOT NULL
);

CREATE TABLE conversation_members (
  chat_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL CHECK(user_id > 0),
  since INTEGER NOT NULL,
  PRIMARY KEY(chat_id, user_id)
) WITHOUT ROWID;

-- Only consenting humans' message identities and direct same-group reply relationships.
CREATE TABLE conversation_messages (
  chat_id INTEGER NOT NULL,
  message_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  sent_at INTEGER NOT NULL,
  parent_id INTEGER,
  parent_user INTEGER,
  parent_sent INTEGER,
  verified INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(chat_id, message_id)
) WITHOUT ROWID;
CREATE INDEX conversation_expiry ON conversation_messages(sent_at);
CREATE INDEX conversation_by_author ON conversation_messages(chat_id, user_id, sent_at);
CREATE INDEX conversation_by_parent ON conversation_messages(chat_id, parent_id);
CREATE INDEX conversation_by_recipient ON conversation_messages(chat_id, parent_user, sent_at);

CREATE TABLE conversation_dirty (
  chat_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  PRIMARY KEY(chat_id, user_id)
) WITHOUT ROWID;
