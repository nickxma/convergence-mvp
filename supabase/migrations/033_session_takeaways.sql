-- AI-generated 3-point key takeaways per conversation session.
-- Generated async after session completion; polled by the frontend until available.
-- One row per session (upserted on regenerate).

CREATE TABLE session_takeaways (
  session_id   UUID        PRIMARY KEY,
  takeaways    JSONB       NOT NULL,  -- array of exactly 3 strings
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  model        TEXT        NOT NULL
);
