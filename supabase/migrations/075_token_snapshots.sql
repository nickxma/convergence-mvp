-- 075_token_snapshots.sql
-- Nightly snapshot of on-chain token balances per wallet.
-- Governance vote eligibility is determined from the snapshot at proposal creation
-- time, not live balance — prevents flash-loan voting manipulation.
-- Supports OLU-801 (nightly token holder snapshot cron).

create table if not exists token_snapshots (
  id              bigserial   primary key,
  wallet_address  text        not null,
  token_balance   numeric(20, 0) not null default 0,
  snapshot_date   date        not null default current_date,
  created_at      timestamptz not null default now(),
  unique (wallet_address, snapshot_date)
);

create index token_snapshots_wallet_idx on token_snapshots (wallet_address, snapshot_date desc);
create index token_snapshots_date_idx   on token_snapshots (snapshot_date desc);

alter table token_snapshots enable row level security;
create policy "service_role_only" on token_snapshots
  using (auth.role() = 'service_role');
