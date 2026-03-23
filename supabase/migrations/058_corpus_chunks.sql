-- Extend citation_feedback with session-level context and wallet address.
-- The existing table uses qa_id (answerId) for turn identity; we add session_id
-- and wallet_address so the feedback endpoint can accept the full spec.

alter table citation_feedback
  add column if not exists session_id    uuid,
  add column if not exists wallet_address text;

create index if not exists citation_feedback_session_id_idx
  on citation_feedback(session_id);

-- corpus_chunks: stores aggregated per-chunk feedback scores.
-- Populated nightly by /api/cron/feedback-score.
-- feedback_score = (helpful_count - unhelpful_count) / total_count, ranges [-1, 1].

create table if not exists corpus_chunks (
  chunk_id        text        primary key,
  feedback_score  float       not null default 0.0,
  helpful_count   int         not null default 0,
  unhelpful_count int         not null default 0,
  total_count     int         not null default 0,
  last_updated_at timestamptz not null default now()
);

-- Aggregate function: groups citation_feedback by chunk_id and computes feedback_score.
-- Called nightly by /api/cron/feedback-score via supabase.rpc().

create or replace function aggregate_citation_feedback()
returns table(
  chunk_id        text,
  helpful_count   int,
  unhelpful_count int,
  total_count     int,
  feedback_score  float
)
language sql
security definer
as $$
  select
    cf.chunk_id,
    count(*) filter (where cf.signal = 'helpful')   ::int   as helpful_count,
    count(*) filter (where cf.signal = 'unhelpful') ::int   as unhelpful_count,
    count(*)                                         ::int   as total_count,
    case
      when count(*) = 0 then 0.0
      else (
        count(*) filter (where cf.signal = 'helpful')::float
        - count(*) filter (where cf.signal = 'unhelpful')::float
      ) / count(*)::float
    end                                                      as feedback_score
  from citation_feedback cf
  group by cf.chunk_id;
$$;
