-- Semantic cache extension for qa_cache (OLU-315)
-- Adds pgvector embeddings to qa_cache so near-duplicate questions reuse cached answers.
-- Cosine similarity threshold is configurable via SEMANTIC_CACHE_THRESHOLD env var (default 0.92).

-- pgvector must already be enabled (required by corpus embedding work in earlier migrations).

-- ── Schema ────────────────────────────────────────────────────────────────────

alter table qa_cache
  add column if not exists question_embedding vector(1536);

-- HNSW index: no training data required, good accuracy at all dataset sizes.
-- Enables sub-millisecond cosine similarity search on the embedding column.
create index if not exists qa_cache_embedding_hnsw_idx
  on qa_cache using hnsw (question_embedding vector_cosine_ops);

-- Separate flag so semantic hits are distinguishable from exact-hash hits in analytics.
-- (cache_hit column already added by migration 015_qa_cache.sql)
alter table qa_analytics
  add column if not exists semantic_cache_hit boolean not null default false;

-- ── Similarity search function ────────────────────────────────────────────────

-- Returns at most `match_count` cache entries whose cosine similarity with the
-- query embedding exceeds `match_threshold`, ordered closest-first.
-- Only rows with a non-null embedding and within the 7-day TTL are considered.
create or replace function match_qa_cache(
  query_embedding vector(1536),
  match_threshold float,
  match_count     int default 1
)
returns table (
  id          uuid,
  answer      text,
  follow_ups  jsonb,
  chunks_json jsonb,
  similarity  float
)
language sql stable as $$
  select
    id,
    answer,
    follow_ups,
    chunks_json,
    (1 - (question_embedding <=> query_embedding))::float as similarity
  from qa_cache
  where question_embedding is not null
    and created_at > now() - interval '7 days'
    and (1 - (question_embedding <=> query_embedding)) > match_threshold
  order by question_embedding <=> query_embedding
  limit match_count;
$$;
