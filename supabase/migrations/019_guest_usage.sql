-- Track unauthenticated (guest) question usage per IP per day.
-- Enforces the 3 free questions / 24h guest limit.

create table guest_usage (
  ip_hash  text    not null,
  date     date    not null default current_date,
  count    integer not null default 1,
  constraint guest_usage_pkey primary key (ip_hash, date)
);

-- No public/anon access — service role only.
alter table guest_usage enable row level security;

-- Atomic upsert: insert (count=1) or increment existing count.
-- Returns the new count so the caller can decide whether to allow the request.
create or replace function increment_guest_usage(p_ip_hash text)
  returns integer
  language plpgsql
  security definer
as $$
declare
  v_count integer;
begin
  insert into guest_usage (ip_hash, date, count)
  values (p_ip_hash, current_date, 1)
  on conflict (ip_hash, date)
  do update set count = guest_usage.count + 1
  returning count into v_count;
  return v_count;
end;
$$;
