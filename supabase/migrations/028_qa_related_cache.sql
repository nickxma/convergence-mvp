-- Related questions cache (OLU-360)
-- Stores the set of related Q&A pairs for a given question, keyed by SHA-256 hash.
-- TTL: 24h — enforced at read time.

create table if not exists qa_related_cache (
  id            uuid        primary key default gen_random_uuid(),
  question_hash text        not null unique,   -- SHA-256(question.toLowerCase().trim())
  related       jsonb       not null default '[]',  -- [{question, answer_snippet, similarity}]
  created_at    timestamptz not null default now()
);

create index if not exists qa_related_cache_hash_idx       on qa_related_cache(question_hash);
create index if not exists qa_related_cache_created_at_idx on qa_related_cache(created_at);

-- Similarity search for related questions.
-- Returns qa_cache rows (question + answer + chunks_json) whose cosine similarity
-- with the query embedding exceeds match_threshold, ordered closest-first.
-- Intentionally uses a lower threshold than match_qa_cache (which targets dedup at 0.92).
-- Only considers rows with embeddings that are within the 7-day cache TTL.
create or replace function match_qa_related(
  query_embedding vector(1536),
  match_threshold float,
  match_count     int default 8
)
returns table (
  question    text,
  answer      text,
  chunks_json jsonb,
  similarity  float
)
language sql stable as $$
  select
    question,
    answer,
    chunks_json,
    (1 - (question_embedding <=> query_embedding))::float as similarity
  from qa_cache
  where question_embedding is not null
    and created_at > now() - interval '7 days'
    and (1 - (question_embedding <=> query_embedding)) > match_threshold
  order by question_embedding <=> query_embedding
  limit match_count;
$$;
