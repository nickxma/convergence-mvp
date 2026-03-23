-- Per-request RAG pipeline latency metrics (OLU-599)
-- Stores timing for each stage of the /api/ask pipeline so we can identify
-- the slowest stage per request without inspecting logs.
-- question_hash links to qa_analytics for cross-referencing.

create table if not exists qa_metrics (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  question_hash   text,          -- sha-256 of the raw question (links to qa_analytics)
  conversation_id uuid,          -- optional, for session-level analysis
  embed_ms        integer,       -- rag.embed_query span duration
  retrieve_ms     integer,       -- rag.pinecone_retrieve span duration
  rerank_ms       integer,       -- rag.cohere_rerank span duration (null if Cohere disabled)
  generate_ms     integer,       -- rag.llm_generate span duration
  total_ms        integer not null  -- end-to-end request latency
);

-- Index for time-series analysis (e.g. p95 latency per stage over the last 7 days)
create index if not exists qa_metrics_created_at_idx on qa_metrics (created_at desc);

-- Index for joining with qa_analytics by question hash
create index if not exists qa_metrics_question_hash_idx on qa_metrics (question_hash)
  where question_hash is not null;

-- RLS: service role writes only — no public access
alter table qa_metrics enable row level security;
