-- Migration: 008_soft_delete
-- Adds soft-delete support to posts and replies.
--
-- Deleted posts:
--   - Immediately hidden from feed (paginated list)
--   - Show as [deleted] in thread view for 30 days
--   - Fully excluded from thread view after 30 days
-- Deleted replies:
--   - Immediately hidden from thread view (reply count decrements)
-- Cascade: deleting a post also soft-deletes all its replies.

ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;

ALTER TABLE replies
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;

-- Feed query: active posts only (hidden = false AND not soft-deleted).
-- Replaces idx_posts_hidden_vote_score partial index with a narrower one.
DROP INDEX IF EXISTS idx_posts_hidden_vote_score;

CREATE INDEX IF NOT EXISTS idx_posts_feed
  ON posts (vote_score DESC)
  WHERE hidden = false AND deleted_at IS NULL;

-- Quick lookup for "recently deleted" posts (thread [deleted] placeholder).
CREATE INDEX IF NOT EXISTS idx_posts_deleted_at
  ON posts (deleted_at)
  WHERE deleted_at IS NOT NULL;

-- Reply thread: only non-deleted replies, chronological.
DROP INDEX IF EXISTS idx_replies_post_id;

CREATE INDEX IF NOT EXISTS idx_replies_post_id
  ON replies (post_id, created_at ASC)
  WHERE deleted_at IS NULL;
