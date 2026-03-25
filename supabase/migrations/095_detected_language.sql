-- Store the detected language on conversation sessions.
-- Enables per-session language tracking and future analytics on non-English usage.

ALTER TABLE conversation_sessions
  ADD COLUMN IF NOT EXISTS detected_language TEXT;

-- Optional index for analytics queries filtering by language
CREATE INDEX IF NOT EXISTS conversation_sessions_lang_idx
  ON conversation_sessions(detected_language)
  WHERE detected_language IS NOT NULL;
