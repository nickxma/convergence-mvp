-- Persistent Q&A conversation store.
-- Unlike conversation_sessions (session-scoped, 24h TTL used by GET /api/conversations),
-- qa_conversations is a permanent record of multi-turn Q&A interactions keyed by the
-- conversationId returned from /api/ask.
--
-- Hot context retrieval uses Upstash Redis (2h TTL); this table is the durable archive.

CREATE TABLE IF NOT EXISTS qa_conversations (
  id         UUID        PRIMARY KEY,
  user_id    TEXT,
  messages   JSONB       NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Fast per-user history lookup (newest first)
CREATE INDEX IF NOT EXISTS qa_conversations_user_id_updated_idx
  ON qa_conversations(user_id, updated_at DESC)
  WHERE user_id IS NOT NULL;
