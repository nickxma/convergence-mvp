-- Q&A Quality Monitor
-- Adds quality tracking to qa_cache and creates corpus_refresh_candidates.
--
-- Quality score formula: (pinecone_top1_score * 0.6) + (positive_feedback_rate * 0.4)
-- Flagged when: quality_score < 0.4 AND feedback_count >= 3

-- ── qa_cache: quality tracking columns ───────────────────────────────────────

alter table qa_cache
  add column if not exists pinecone_top1_score  float,
  add column if not exists quality_score        float,
  add column if not exists feedback_count       integer not null default 0,
  add column if not exists positive_feedback_count integer not null default 0;

-- Index for the admin low-quality query
create index if not exists qa_cache_quality_idx
  on qa_cache(quality_score, feedback_count)
  where quality_score is not null;

-- ── qa_answers: link back to cache entry ──────────────────────────────────────

alter table qa_answers
  add column if not exists cache_hash text;

create index if not exists qa_answers_cache_hash_idx
  on qa_answers(cache_hash)
  where cache_hash is not null;

-- ── corpus_refresh_candidates ─────────────────────────────────────────────────

create table if not exists corpus_refresh_candidates (
  id           uuid        primary key default gen_random_uuid(),
  cache_hash   text        not null unique,
  question     text        not null,
  quality_score float,
  added_at     timestamptz not null default now(),
  added_by     text        -- admin wallet address
);

create index if not exists corpus_refresh_candidates_added_at_idx
  on corpus_refresh_candidates(added_at desc);
