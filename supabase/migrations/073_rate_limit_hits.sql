-- 073_rate_limit_hits.sql
-- Audit log for Q&A API rate limit events, keyed by tier and wallet.
-- Supports OLU-799 (per-user token-tier rate limiting).

create table if not exists rate_limit_hits (
  id              bigserial     primary key,
  endpoint        text          not null,          -- e.g. '/api/ask'
  user_id         text,                            -- Privy userId (null for anon)
  wallet_address  text,                            -- wallet (null if not provided)
  ip_hash         text,                            -- SHA-256 of IP (no PII stored)
  tier            text          not null,          -- 'unlimited' | 'high' | 'low' | 'anon'
  token_balance   numeric(20,0),                   -- balance at time of hit (null if unknown)
  limit_applied   integer,                         -- req/min ceiling that was enforced
  created_at      timestamptz   not null default now()
);

create index rate_limit_hits_wallet_idx    on rate_limit_hits (wallet_address, created_at desc)
  where wallet_address is not null;
create index rate_limit_hits_created_idx   on rate_limit_hits (created_at desc);
create index rate_limit_hits_user_idx      on rate_limit_hits (user_id, created_at desc)
  where user_id is not null;

alter table rate_limit_hits enable row level security;
create policy "service_role_only" on rate_limit_hits
  using (auth.role() = 'service_role');
