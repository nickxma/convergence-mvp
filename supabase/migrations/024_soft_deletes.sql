-- Migration: 024_soft_deletes
-- Adds soft-delete support to conversation_sessions.
--
-- Posts and replies already have deleted_at from 008_soft_delete.sql.
-- Conversation sessions store Q&A chat history — hard-deleting a session
-- destroys the user's conversation history with no recovery path.
--
-- With soft deletes:
--   - Sessions are hidden from the active query (deleted_at IS NULL)
--   - History is recoverable for 30 days before physical cleanup
--   - No cascade change needed: sessions are independent objects

ALTER TABLE conversation_sessions
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;

-- Filter active sessions efficiently (the hot path for session lookups).
CREATE INDEX IF NOT EXISTS idx_conversation_sessions_active
  ON conversation_sessions (id)
  WHERE deleted_at IS NULL;

-- Cleanup query: find sessions that are expired AND deleted for purging.
CREATE INDEX IF NOT EXISTS idx_conversation_sessions_deleted
  ON conversation_sessions (deleted_at)
  WHERE deleted_at IS NOT NULL;
