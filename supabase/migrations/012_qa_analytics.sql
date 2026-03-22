-- Q&A Engine analytics
-- Tracks per-query metrics: volume, relevance scores, latency, model used.
-- Questions are SHA-256 hashed before storage — no PII retained.

create table if not exists qa_analytics (
  id              uuid        primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  question_hash   text        not null,                     -- SHA-256(question), hex
  pinecone_scores numeric[]   not null default '{}',        -- top-3 relevance scores
  latency_ms      integer     not null,                     -- end-to-end response time
  model_used      text        not null                      -- e.g. 'gpt-4o-mini'
);

-- Fast aggregates by time window
create index if not exists qa_analytics_created_at_idx on qa_analytics(created_at);
-- Fast frequency count by question
create index if not exists qa_analytics_question_hash_idx on qa_analytics(question_hash);
