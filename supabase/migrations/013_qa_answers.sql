-- Shareable Q&A answers
-- Each answer gets a stable UUID so it can be linked to directly.
-- Sources are stored as JSONB for the answer page to render citations.

create table if not exists qa_answers (
  id              uuid        primary key default gen_random_uuid(),
  question        text        not null,
  answer          text        not null,
  sources         jsonb       not null default '[]',
  conversation_id uuid        references conversation_sessions(id) on delete set null,
  created_at      timestamptz not null default now()
);

create index if not exists qa_answers_created_at_idx     on qa_answers(created_at desc);
create index if not exists qa_answers_conversation_id_idx on qa_answers(conversation_id);
