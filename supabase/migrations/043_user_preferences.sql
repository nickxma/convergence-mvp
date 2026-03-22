-- User preferences table — stores per-user settings that persist across sessions.
-- answer_style: 'brief' | 'detailed' | 'citations_first' (default 'detailed')

create table if not exists user_preferences (
  user_id text primary key,
  answer_style text not null default 'detailed'
    check (answer_style in ('brief', 'detailed', 'citations_first')),
  updated_at timestamptz not null default now()
);

-- RLS: users may only read/write their own row
alter table user_preferences enable row level security;

create policy "Users can read own preferences"
  on user_preferences for select
  using (auth.uid()::text = user_id);

create policy "Users can upsert own preferences"
  on user_preferences for insert
  with check (auth.uid()::text = user_id);

create policy "Users can update own preferences"
  on user_preferences for update
  using (auth.uid()::text = user_id);
