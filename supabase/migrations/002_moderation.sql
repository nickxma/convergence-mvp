-- Moderation schema for Token-Governed Knowledge Commons
-- Adds content flagging, auto-hide threshold, and admin removal support.

-- Add hidden column to posts
alter table posts add column if not exists hidden boolean not null default false;

-- Index for feed queries that filter out hidden posts
create index if not exists posts_visible_idx on posts(hidden, votes desc, created_at desc);

-- Flags table — one row per (reporter, post); prevents double-reporting
create table if not exists flags (
  id              bigserial primary key,
  post_id         bigint not null references posts(id) on delete cascade,
  reporter_wallet text not null,
  reason          text not null check (char_length(reason) between 1 and 1000),
  created_at      timestamptz not null default now(),
  unique (post_id, reporter_wallet)
);

create index if not exists flags_post_id_idx on flags(post_id);

-- RLS: public can't read or write flags; service role bypasses
alter table flags enable row level security;
