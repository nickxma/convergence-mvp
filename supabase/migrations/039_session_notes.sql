-- 039_session_notes.sql
-- Per-user notes for course sessions (Pro feature).
--
-- Users write private notes against a session slug (e.g. "the-honest-meditator-3").
-- The session_id is a composite key of course_slug + session_number, matching the
-- format produced by shared/session-notes.js.
-- Access is gated to Pro subscribers via the API layer (requiresPro('session_notes')).

CREATE TABLE IF NOT EXISTS session_notes (
  user_id     TEXT  NOT NULL,
  session_id  TEXT  NOT NULL,   -- e.g. "the-honest-meditator-3"
  content     TEXT  NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT session_notes_pkey PRIMARY KEY (user_id, session_id)
);

CREATE INDEX IF NOT EXISTS session_notes_user_id_idx ON session_notes (user_id);

ALTER TABLE session_notes ENABLE ROW LEVEL SECURITY;

-- All reads and writes go through the service-role API server only.
CREATE POLICY "service role only session_notes"
  ON session_notes USING (false);

-- Auto-update updated_at on every write.
CREATE OR REPLACE FUNCTION update_session_notes_updated_at()
  RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER session_notes_updated_at
  BEFORE UPDATE ON session_notes
  FOR EACH ROW EXECUTE FUNCTION update_session_notes_updated_at();
