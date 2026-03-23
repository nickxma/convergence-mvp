-- Collaborative Q&A sessions: shared exploration with a link.
--
-- Extends qa_conversations with:
--   is_collaborative  — enables real-time multi-participant mode
--   share_token       — secret UUID used in /qa/join/:token URLs
--   owner_user_id     — explicit owner reference for permission checks
--
-- Adds qa_session_participants to track who has joined a shared session.

ALTER TABLE qa_conversations
  ADD COLUMN IF NOT EXISTS is_collaborative BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS share_token      UUID    UNIQUE,
  ADD COLUMN IF NOT EXISTS owner_user_id    TEXT;

-- Back-fill owner from existing user_id (same field, just made explicit)
UPDATE qa_conversations
SET owner_user_id = user_id
WHERE owner_user_id IS NULL AND user_id IS NOT NULL;

-- Fast lookup: find a session by its share token
CREATE UNIQUE INDEX IF NOT EXISTS qa_conversations_share_token_idx
  ON qa_conversations(share_token)
  WHERE share_token IS NOT NULL;

-- ── Participants ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS qa_session_participants (
  session_id   UUID        NOT NULL REFERENCES qa_conversations(id) ON DELETE CASCADE,
  user_id      TEXT        NOT NULL,
  display_name TEXT,                         -- short label shown in UI (ENS / address / anon)
  joined_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (session_id, user_id)
);

CREATE INDEX IF NOT EXISTS qa_session_participants_session_idx
  ON qa_session_participants(session_id, last_seen_at DESC);

-- Keep last_seen fresh so we can cull stale entries (> 10 min) from the UI
CREATE OR REPLACE FUNCTION touch_participant_seen()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.last_seen_at := NOW();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_participant_seen
BEFORE UPDATE ON qa_session_participants
FOR EACH ROW EXECUTE PROCEDURE touch_participant_seen();
