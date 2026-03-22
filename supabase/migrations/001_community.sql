-- Community discussion schema for Token-Governed Knowledge Commons
-- Acceptance Pass holders can create posts, replies, and vote.

-- Posts table
create table if not exists posts (
  id          bigserial primary key,
  author_wallet text not null,
  title       text not null check (char_length(title) between 1 and 300),
  body        text not null check (char_length(body) between 1 and 10000),
  votes       integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Replies table
create table if not exists replies (
  id          bigserial primary key,
  post_id     bigint not null references posts(id) on delete cascade,
  author_wallet text not null,
  body        text not null check (char_length(body) between 1 and 5000),
  votes       integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Votes table — one row per (voter, target, target_type)
-- Prevents double-voting; on conflict update allows changing vote direction.
create table if not exists votes (
  id            bigserial primary key,
  voter_wallet  text not null,
  target_type   text not null check (target_type in ('post', 'reply')),
  target_id     bigint not null,
  direction     smallint not null check (direction in (1, -1)),
  created_at    timestamptz not null default now(),
  unique (voter_wallet, target_type, target_id)
);

-- Indexes for common query patterns
create index if not exists posts_votes_idx on posts(votes desc, created_at desc);
create index if not exists replies_post_id_idx on replies(post_id, created_at asc);
create index if not exists votes_target_idx on votes(target_type, target_id);

-- Auto-update updated_at
create or replace function touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger posts_updated_at
  before update on posts
  for each row execute function touch_updated_at();

create trigger replies_updated_at
  before update on replies
  for each row execute function touch_updated_at();

-- Atomic vote increment helpers (avoids read-modify-write races)
-- Called via supabase.rpc() from the vote route handler.
create or replace function increment_post_votes(post_id bigint, delta int)
returns void language sql security definer as $$
  update posts set votes = votes + delta where id = post_id;
$$;

create or replace function increment_reply_votes(reply_id bigint, delta int)
returns void language sql security definer as $$
  update replies set votes = votes + delta where id = reply_id;
$$;

-- Row Level Security: service role bypasses; anon can only read.
alter table posts enable row level security;
alter table replies enable row level security;
alter table votes enable row level security;

create policy "public read posts"  on posts  for select using (true);
create policy "public read replies" on replies for select using (true);
-- writes are done via service role key in API routes, which bypasses RLS
