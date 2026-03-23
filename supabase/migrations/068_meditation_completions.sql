-- 068_meditation_completions.sql
--
-- Habit tracking for the Guided Meditation Generator.
-- meditation_completions  — explicit per-session completion events
-- user_meditation_badges  — earned streak badges (Consistent/Devoted/Enlightened)
-- user_reputation         — running reputation score keyed by Privy user DID

-- ── meditation_completions ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS meditation_completions (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          text        NOT NULL,               -- Privy user DID
  meditation_id    uuid        NOT NULL REFERENCES meditations(id) ON DELETE CASCADE,
  duration_minutes integer     NOT NULL CHECK (duration_minutes > 0),
  rating_stars     smallint    CHECK (rating_stars >= 1 AND rating_stars <= 5),
  completed_at     timestamptz NOT NULL DEFAULT now()
);

-- Per-user history ordered by completion time (completions endpoint + streak calc)
CREATE INDEX IF NOT EXISTS idx_completions_user_completed
  ON meditation_completions (user_id, completed_at DESC);

-- Streak date queries — just the date portion per user
CREATE INDEX IF NOT EXISTS idx_completions_user_date
  ON meditation_completions (user_id, (completed_at::date) DESC);

COMMENT ON TABLE meditation_completions IS
  'Explicit session-completion events for meditation habit tracking. One row per completed session.';
COMMENT ON COLUMN meditation_completions.user_id IS 'Privy user DID';
COMMENT ON COLUMN meditation_completions.duration_minutes IS 'Actual or nominal session duration in minutes';

-- ── user_meditation_badges ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS user_meditation_badges (
  id         bigserial   PRIMARY KEY,
  user_id    text        NOT NULL,   -- Privy user DID
  badge_slug text        NOT NULL    CHECK (badge_slug IN ('consistent', 'devoted', 'enlightened')),
  earned_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, badge_slug)
);

CREATE INDEX IF NOT EXISTS idx_badges_user
  ON user_meditation_badges (user_id);

COMMENT ON TABLE user_meditation_badges IS
  'Streak milestone badges earned by users: consistent (7d), devoted (30d), enlightened (100d).';

-- ── user_reputation ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS user_reputation (
  user_id    text    PRIMARY KEY,   -- Privy user DID
  points     integer NOT NULL DEFAULT 0 CHECK (points >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE user_reputation IS
  'Running reputation score per user. +2 awarded per meditation completion.';
COMMENT ON COLUMN user_reputation.points IS 'Total accumulated reputation points';
