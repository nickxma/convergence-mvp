-- Migration: 010_wallet_indexes
-- Adds composite author_wallet + created_at indexes for user profile queries.
--
-- Context: OLU-210 / OLU-208 (user profile API) / OLU-209 (profile page)
--
-- Migration 006 added simple single-column wallet indexes. Those cover
-- equality filters but leave ORDER BY created_at DESC unsatisfied, forcing
-- a sort step. Composite indexes allow Postgres to satisfy both the WHERE
-- and ORDER BY from a single index scan at O(log n + k) instead of O(n).
--
-- Typical profile queries this covers:
--   SELECT * FROM posts   WHERE author_wallet = ? ORDER BY created_at DESC LIMIT 20
--   SELECT * FROM replies WHERE author_wallet = ? ORDER BY created_at DESC LIMIT 20
--   SELECT * FROM votes   WHERE voter_wallet  = ? ORDER BY created_at DESC LIMIT 20

-- ============================================================
-- POSTS TABLE
-- ============================================================

-- Composite index: wallet equality + reverse-chronological ordering.
-- Supersedes simple idx_posts_author_wallet from migration 006 for
-- profile queries that include ORDER BY created_at DESC.
CREATE INDEX IF NOT EXISTS posts_author_wallet_idx
  ON posts (author_wallet, created_at DESC);

-- ============================================================
-- REPLIES TABLE
-- ============================================================

-- Composite index: wallet equality + reverse-chronological ordering.
-- Supersedes simple idx_replies_author_wallet from migration 006 for
-- reply history with ORDER BY created_at DESC.
CREATE INDEX IF NOT EXISTS replies_author_wallet_idx
  ON replies (author_wallet, created_at DESC);

-- ============================================================
-- VOTES TABLE
-- ============================================================

-- Composite index: wallet equality + reverse-chronological ordering.
-- Supersedes simple idx_votes_voter_wallet from migration 006 for
-- vote history queries with ORDER BY created_at DESC.
CREATE INDEX IF NOT EXISTS votes_voter_wallet_idx
  ON votes (voter_wallet, created_at DESC);
