-- Migration: 005_schema_fixes
-- Reconciles schema between base migrations (001-003) and community features (006-010).
--
-- Changes:
-- 1. Rename posts.votes -> posts.vote_score  (API code uses vote_score throughout)
-- 2. Rebuild votes table with post_id-based schema (cast_vote in 006 requires this)
-- 3. Create user_profiles table (006 creates an index on user_profiles.wallet_address)

-- ============================================================
-- 1. RENAME posts.votes -> posts.vote_score
-- ============================================================
-- 001_community.sql created posts with a column named 'votes'.
-- All API routes and later migrations reference 'vote_score'.

ALTER TABLE posts RENAME COLUMN votes TO vote_score;

-- Update the feed index from 001 to reference the renamed column
DROP INDEX IF EXISTS posts_votes_idx;
CREATE INDEX IF NOT EXISTS posts_votes_idx ON posts(vote_score DESC, created_at DESC);

-- ============================================================
-- 2. REBUILD votes TABLE
-- ============================================================
-- 001_community.sql created a generic votes table with target_type/target_id.
-- 006_community_indexes.sql (cast_vote function) expects:
--   - post_id BIGINT FK (not target_type + target_id)
--   - direction TEXT ('up' | 'down', not smallint 1/-1)
--   - voter_wallet TEXT
-- This is a pre-production migration; no data to preserve.

DROP TABLE IF EXISTS votes;

CREATE TABLE votes (
  id            BIGSERIAL    PRIMARY KEY,
  post_id       BIGINT       NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  voter_wallet  TEXT         NOT NULL,
  direction     TEXT         NOT NULL CHECK (direction IN ('up', 'down')),
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
  -- Uniqueness enforced by idx_votes_post_voter created in 006_community_indexes
);

-- RLS: cast_vote runs as SECURITY DEFINER (service role); no public write access
ALTER TABLE votes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read votes" ON votes FOR SELECT USING (true);

-- ============================================================
-- 3. CREATE user_profiles TABLE
-- ============================================================
-- 006_community_indexes.sql creates an index on user_profiles.wallet_address.
-- The table must exist before that migration runs.

CREATE TABLE IF NOT EXISTS user_profiles (
  id             BIGSERIAL    PRIMARY KEY,
  wallet_address TEXT         NOT NULL,
  display_name   TEXT,
  bio            TEXT,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TRIGGER user_profiles_updated_at
  BEFORE UPDATE ON user_profiles
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read profiles" ON user_profiles FOR SELECT USING (true);
