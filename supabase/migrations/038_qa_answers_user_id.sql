-- Add user_id to qa_answers so shared links can be attributed to the asker.
-- Nullable: anonymous questions remain shareable without auth.

ALTER TABLE qa_answers
  ADD COLUMN IF NOT EXISTS user_id text;

CREATE INDEX IF NOT EXISTS qa_answers_user_id_idx ON qa_answers(user_id)
  WHERE user_id IS NOT NULL;
