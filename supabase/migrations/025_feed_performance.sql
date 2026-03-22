-- Migration: 025_feed_performance
-- Replaces single-column feed index with compound index to eliminate
-- secondary sort on created_at, cutting p99 at 100 concurrent requests.
--
-- Problem: GET /api/community/posts orders by (vote_score DESC, created_at DESC)
-- WHERE hidden=false. The existing idx_posts_hidden_vote_score covers the
-- first sort column only; Postgres must re-sort by created_at in memory,
-- causing p99 of ~884ms under 100 concurrent requests (OLU-330).
--
-- Fix: compound partial index covering both sort columns. Postgres resolves
-- the full ORDER BY from the index, zero sort step.

-- Drop superseded single-column index
DROP INDEX IF EXISTS idx_posts_hidden_vote_score;

-- Compound partial index: covers the full feed ORDER BY clause
CREATE INDEX IF NOT EXISTS idx_posts_feed
  ON posts (vote_score DESC, created_at DESC)
  WHERE hidden = false;
