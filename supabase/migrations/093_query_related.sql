-- 093_query_related.sql
-- "People also asked" — related query search for /api/queries/:id/related.
--
-- Adds a dedicated similarity search function that:
--   1. Searches ALL qa_cache entries with embeddings (no 7-day TTL cap)
--   2. Uses a tighter similarity threshold (0.82) per the spec
--
-- The existing match_qa_related (028) is kept for backward compat and is used
-- by /api/qa/related (question text input, Pinecone-boosted ranking, 0.65 threshold).
-- This new function is used by /api/queries/:id/related (answer-id input, 0.82 threshold).

-- ── Related query search (all-time, tight threshold) ──────────────────────────

CREATE OR REPLACE FUNCTION match_related_queries(
  query_embedding vector(1536),
  match_threshold float  DEFAULT 0.82,
  match_count     int    DEFAULT 8
)
RETURNS TABLE (
  question       text,
  answer         text,
  similarity     float
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    question,
    answer,
    (1 - (question_embedding <=> query_embedding))::float AS similarity
  FROM qa_cache
  WHERE question_embedding IS NOT NULL
    AND (1 - (question_embedding <=> query_embedding)) > match_threshold
  ORDER BY question_embedding <=> query_embedding
  LIMIT match_count;
$$;
