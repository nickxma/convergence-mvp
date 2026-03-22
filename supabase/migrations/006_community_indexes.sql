-- Migration: 006_community_indexes
-- Adds indexes and cast_vote stored procedure to community tables.
-- Ensures community API queries perform well at scale (target: <100ms at 10K rows).
--
-- Tables targeted: posts, replies, votes, user_profiles
-- Run EXPLAIN ANALYZE results documented in OLU-163 issue comment.
--
-- Note: votes table was rebuilt in 005_schema_fixes to use post_id + direction TEXT.

-- ============================================================
-- POSTS TABLE
-- ============================================================

-- Primary feed query: WHERE hidden = false ORDER BY vote_score DESC
-- Covers: GET /api/community/posts (most frequent endpoint).
-- Partial index keeps it small — only visible posts are indexed.
CREATE INDEX IF NOT EXISTS idx_posts_hidden_vote_score
  ON posts (vote_score DESC)
  WHERE hidden = false;

-- Author wallet: user profile / post history lookups.
-- Used when fetching posts by a specific wallet address.
CREATE INDEX IF NOT EXISTS idx_posts_author_wallet
  ON posts (author_wallet);

-- Chronological queries (secondary sort, time-based feeds).
CREATE INDEX IF NOT EXISTS idx_posts_created_at
  ON posts (created_at DESC);

-- ============================================================
-- VOTES TABLE
-- ============================================================

-- Unique constraint enforcing one-vote-per-wallet-per-post.
-- Also the primary lookup used inside cast_vote for upsert logic.
-- Doubles as the leaderboard composite — grouping votes by post_id
-- uses this index for efficient aggregation.
CREATE UNIQUE INDEX IF NOT EXISTS idx_votes_post_voter
  ON votes (post_id, voter_wallet);

-- Per-post vote aggregation path (e.g., COUNT(*) GROUP BY post_id).
CREATE INDEX IF NOT EXISTS idx_votes_post_id
  ON votes (post_id);

-- Per-wallet vote history (leaderboard, user profile).
CREATE INDEX IF NOT EXISTS idx_votes_voter_wallet
  ON votes (voter_wallet);

-- ============================================================
-- REPLIES TABLE
-- ============================================================

-- Per-post reply thread: post_id FK + chronological ordering.
-- Covers: SELECT * FROM replies WHERE post_id = X ORDER BY created_at ASC.
CREATE INDEX IF NOT EXISTS idx_replies_post_id
  ON replies (post_id, created_at ASC);

-- Per-author reply history (user profile pages).
CREATE INDEX IF NOT EXISTS idx_replies_author_wallet
  ON replies (author_wallet);

-- ============================================================
-- USER_PROFILES TABLE
-- ============================================================

-- Wallet address is the natural primary lookup key for profiles.
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_profiles_wallet_address
  ON user_profiles (wallet_address);

-- ============================================================
-- cast_vote STORED PROCEDURE
-- ============================================================
-- Atomic vote upsert used by POST /api/community/posts/:id/vote.
-- Handles: new vote, direction change, and vote removal (toggle).
-- Returns: { new_vote_score integer }
--
-- Locking strategy: FOR UPDATE on posts row prevents concurrent
-- vote_score drift under parallel requests for the same post.
-- ============================================================

CREATE OR REPLACE FUNCTION cast_vote(
  p_post_id     BIGINT,   -- posts.id is bigserial (bigint); was incorrectly UUID
  p_voter_wallet TEXT,
  p_direction   TEXT      -- 'up' | 'down'
)
RETURNS TABLE (new_vote_score INTEGER)
LANGUAGE plpgsql
AS $$
DECLARE
  v_existing_direction TEXT;
  v_score_delta        INTEGER;
BEGIN
  -- Validate direction
  IF p_direction NOT IN ('up', 'down') THEN
    RAISE EXCEPTION 'direction must be ''up'' or ''down'', got: %', p_direction;
  END IF;

  -- Lock the post row to prevent concurrent vote_score drift
  PERFORM id FROM posts WHERE id = p_post_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'post not found: %', p_post_id;
  END IF;

  -- Check for existing vote by this wallet on this post
  SELECT direction
    INTO v_existing_direction
    FROM votes
   WHERE post_id = p_post_id
     AND voter_wallet = p_voter_wallet;

  IF NOT FOUND THEN
    -- New vote: insert and apply delta
    INSERT INTO votes (post_id, voter_wallet, direction)
    VALUES (p_post_id, p_voter_wallet, p_direction);

    v_score_delta := CASE WHEN p_direction = 'up' THEN 1 ELSE -1 END;

  ELSIF v_existing_direction = p_direction THEN
    -- Same direction toggle: remove vote and reverse delta
    DELETE FROM votes
     WHERE post_id = p_post_id
       AND voter_wallet = p_voter_wallet;

    v_score_delta := CASE WHEN p_direction = 'up' THEN -1 ELSE 1 END;

  ELSE
    -- Direction change: update and apply double delta (remove old + add new)
    UPDATE votes
       SET direction = p_direction
     WHERE post_id = p_post_id
       AND voter_wallet = p_voter_wallet;

    v_score_delta := CASE WHEN p_direction = 'up' THEN 2 ELSE -2 END;

  END IF;

  -- Apply delta to denormalized vote_score on posts
  UPDATE posts
     SET vote_score = vote_score + v_score_delta
   WHERE id = p_post_id;

  -- Return updated score
  RETURN QUERY
    SELECT vote_score AS new_vote_score
      FROM posts
     WHERE id = p_post_id;
END;
$$;
