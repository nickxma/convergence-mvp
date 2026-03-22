-- Migration: 007_posts_fts
-- Adds full-text search support for community posts.
-- Uses a generated tsvector column with GIN index for sub-100ms search at 10K rows.
-- Title weighted 'A' (higher), body weighted 'B' (lower) for relevance ranking.
-- Adds search_posts() RPC for ranked, paginated results with ts_rank.

-- ============================================================
-- ADD TSVECTOR COLUMN TO POSTS
-- ============================================================

ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(body, '')), 'B')
  ) STORED;

-- GIN index for fast full-text lookups
CREATE INDEX IF NOT EXISTS idx_posts_search_vector
  ON posts USING GIN (search_vector);

-- ============================================================
-- SEARCH_POSTS STORED PROCEDURE
-- ============================================================
-- Ranked, paginated full-text search across posts.
-- Relevance: ts_rank on search_vector (title weighted higher).
-- Secondary sort: vote_score DESC.
-- Returns excerpt (first 200 chars of body) and total_count for pagination.
-- Uses websearch_to_tsquery for user-friendly query parsing (handles
-- phrases, negation, and OR without requiring tsquery syntax).

CREATE OR REPLACE FUNCTION search_posts(
  p_query  TEXT,
  p_page   INT  DEFAULT 1,
  p_limit  INT  DEFAULT 20
)
RETURNS TABLE (
  id            BIGINT,   -- posts.id is bigserial (bigint); was incorrectly UUID
  title         TEXT,
  excerpt       TEXT,
  vote_score    INT,
  author_wallet TEXT,
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
  SELECT
    p.id,
    p.title,
    LEFT(p.body, 200)                         AS excerpt,
    p.vote_score,
    p.author_wallet,
    ts_rank(p.search_vector, v_tsquery)       AS rank,
    COUNT(*) OVER ()                          AS total_count
  FROM posts p
  WHERE
    p.hidden = false
    AND p.search_vector @@ v_tsquery
  ORDER BY
    ts_rank(p.search_vector, v_tsquery) DESC,
    p.vote_score DESC
  LIMIT LEAST(p_limit, 50)
  OFFSET v_offset;
END;
$$;
