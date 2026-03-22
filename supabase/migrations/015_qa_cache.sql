-- Q&A answer cache
-- Deduplicates repeated standalone questions to cut LLM spend.
-- Cache key: SHA-256(question.toLowerCase().trim()).
-- TTL: 7 days — enforced at read time (no background sweep needed).

create table if not exists qa_cache (
  id          uuid        primary key default gen_random_uuid(),
  hash        text        not null unique,          -- SHA-256(normalized question)
  question    text        not null,                 -- original question text (for debugging)
  answer      text        not null,
  follow_ups  jsonb       not null default '[]',    -- cached follow-up questions (string[])
  chunks_json jsonb       not null default '[]',    -- Pinecone chunks ({text,speaker,source,score}[])
  hit_count   integer     not null default 0,
  created_at  timestamptz not null default now()
);

create index if not exists qa_cache_hash_idx       on qa_cache(hash);
create index if not exists qa_cache_created_at_idx on qa_cache(created_at);

-- Atomic hit-count increment called on cache hits.
create or replace function increment_qa_cache_hit(p_hash text)
returns void language sql as $$
  update qa_cache set hit_count = hit_count + 1 where hash = p_hash;
$$;

-- Add cache_hit tracking to existing analytics table.
alter table qa_analytics
  add column if not exists cache_hit boolean not null default false;
