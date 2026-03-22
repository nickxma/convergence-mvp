-- Per-citation quality signals on Q&A answers.
-- Tracks helpful/unhelpful votes per chunk within an answer session.
-- user_id is nullable — anonymous users are allowed (UI enforces one-per-session).
-- Authenticated users are deduplicated by (qa_id, chunk_id, user_id).

create table if not exists citation_feedback (
  id         uuid        primary key default gen_random_uuid(),
  qa_id      uuid        not null references qa_answers(id) on delete cascade,
  chunk_id   text        not null,  -- stable hash of (source || '::' || text prefix)
  signal     text        not null check (signal in ('helpful', 'unhelpful')),
  user_id    text,                  -- null for anonymous
  created_at timestamptz not null default now()
);

-- Dedup authenticated votes: one vote per user per chunk per answer
create unique index if not exists citation_feedback_auth_dedup_idx
  on citation_feedback (qa_id, chunk_id, user_id)
  where user_id is not null;

create index if not exists citation_feedback_qa_id_idx     on citation_feedback(qa_id);
create index if not exists citation_feedback_chunk_id_idx  on citation_feedback(chunk_id);
create index if not exists citation_feedback_created_at_idx on citation_feedback(created_at desc);
