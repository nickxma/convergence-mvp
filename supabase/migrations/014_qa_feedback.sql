-- Thumbs up/down quality signals for Q&A answers.
-- Deduplicated by (user_id, answer_id) — one vote per user per answer.

create table if not exists qa_feedback (
  id          uuid        primary key default gen_random_uuid(),
  answer_id   uuid        not null references qa_answers(id) on delete cascade,
  user_id     text        not null,  -- Privy user DID
  rating      text        not null check (rating in ('up', 'down')),
  created_at  timestamptz not null default now(),
  unique (user_id, answer_id)
);

create index if not exists qa_feedback_answer_id_idx  on qa_feedback(answer_id);
create index if not exists qa_feedback_created_at_idx on qa_feedback(created_at desc);
