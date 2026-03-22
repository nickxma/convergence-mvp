-- Migration: 009_search_replies_fts
-- Extends full-text search to include reply bodies.
-- Creates search_community() function used by GET /api/community/search.
--
-- A post surfaces in results if:
--   (a) its own title/body matches the query, OR
--   (b) any of its non-deleted replies match.
-- Ranking: GREATEST(post ts_rank, best matching reply ts_rank).
-- Excerpt: ts_headline on post body (highlights matched terms).

-- ============================================================
-- ADD TSVECTOR COLUMN TO REPLIES
-- ============================================================

ALTER TABLE replies
  ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(body, '')), 'B')
  ) STORED;

-- GIN index for fast full-text lookups on reply bodies
CREATE INDEX IF NOT EXISTS idx_replies_search_vector
  ON replies USING GIN (search_vector);

-- ============================================================
-- SEARCH_COMMUNITY STORED PROCEDURE
-- ============================================================
-- Ranked, paginated full-text search across posts and replies.
--
-- A post is included if its own search_vector matches OR if any
-- non-deleted reply on that post matches.
--
-- Relevance: GREATEST(ts_rank on post, best ts_rank across replies).
-- Secondary sort: vote_score DESC.
--
-- Returns:
--   excerpt       — ts_headline of post body (matched terms highlighted)
--   reply_count   — count of non-deleted replies on the post
--   author_wallet — truncated to first 10 chars + "..."
--   created_at    — post creation timestamp
--   total_count   — total matching posts (for pagination)
--
-- Uses websearch_to_tsquery for user-friendly query parsing (handles
-- phrases, negation, and OR without requiring tsquery syntax).

CREATE OR REPLACE FUNCTION search_community(
  p_query  TEXT,
  p_page   INT  DEFAULT 1,
  p_limit  INT  DEFAULT 20
)
RETURNS TABLE (
  id            BIGINT,   -- posts.id is bigserial (bigint); was incorrectly UUID
  title         TEXT,
  excerpt       TEXT,
  vote_score    INT,
  reply_count   BIGINT,
  author_wallet TEXT,
  created_at    TIMESTAMPTZ,
  rank          FLOAT4,
  total_count   BIGINT
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_offset  INT;
  v_tsquery tsquery;
BEGIN
  v_offset  := (GREATEST(p_page, 1) - 1) * LEAST(p_limit, 50);
  v_tsquery := websearch_to_tsquery('english', p_query);

  RETURN QUERY
  WITH reply_ranks AS (
    -- Best relevance rank from matching replies, grouped by parent post
    SELECT
      r.post_id,
      MAX(ts_rank(r.search_vector, v_tsquery)) AS best_rank
    FROM replies r
    WHERE r.deleted_at IS NULL
      AND r.search_vector @@ v_tsquery
    GROUP BY r.post_id
  ),
  reply_counts AS (
    -- Non-deleted reply count per post (used in result metadata)
    SELECT post_id, COUNT(*) AS cnt
    FROM replies
    WHERE deleted_at IS NULL
    GROUP BY post_id
  ),
  ranked AS (
    SELECT
      p.id,
      p.title,
      ts_headline(
        'english', p.body, v_tsquery,
        'MaxWords=35, MinWords=15, ShortWord=3, HighlightAll=FALSE, MaxFragments=1'
      )                                                     AS excerpt,
      p.vote_score,
      COALESCE(rc.cnt, 0)                                   AS reply_count,
      LEFT(p.author_wallet, 10) || '...'                    AS author_wallet,
      p.created_at,
      GREATEST(
        ts_rank(p.search_vector, v_tsquery),
        COALESCE(rr.best_rank, 0)
      )                                                     AS rank
    FROM posts p
    LEFT JOIN reply_ranks  rr ON rr.post_id = p.id
    LEFT JOIN reply_counts rc ON rc.post_id = p.id
    WHERE p.hidden = false
      AND p.deleted_at IS NULL
      AND (
        p.search_vector @@ v_tsquery
        OR rr.post_id IS NOT NULL
      )
  )
  SELECT
    r.id,
    r.title,
    r.excerpt,
    r.vote_score,
    r.reply_count,
    r.author_wallet,
    r.created_at,
    r.rank,
    COUNT(*) OVER () AS total_count
  FROM ranked r
  ORDER BY r.rank DESC, r.vote_score DESC
  LIMIT  LEAST(p_limit, 50)
  OFFSET v_offset;
END;
$$;
