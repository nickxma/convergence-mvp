-- Reading list: server-side storage for saved Q&A answers (and future essay support).
-- Replaces the previous localStorage-only bookmark system.

create table if not exists reading_list (
  id         uuid        primary key default gen_random_uuid(),
  user_id    text        not null,
  type       text        not null check (type in ('essay', 'qa_answer')),
  ref_id     text        not null,
  created_at timestamptz not null default now(),
  unique (user_id, type, ref_id)
);

create index if not exists reading_list_user_id_created_at_idx
  on reading_list(user_id, created_at desc);
