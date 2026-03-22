-- Q&A Engine conversation sessions with 24h TTL
-- Stores multi-turn conversation history server-side so follow-up questions
-- can retrieve context even if the client has lost localStorage state.

create table if not exists conversation_sessions (
  id          uuid primary key default gen_random_uuid(),
  history     jsonb not null default '[]',
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default (now() + interval '24 hours')
);

-- Index for TTL queries and cleanup
create index if not exists conversation_sessions_expires_idx
  on conversation_sessions(expires_at);
