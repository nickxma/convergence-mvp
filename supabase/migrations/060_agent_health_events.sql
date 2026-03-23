-- agent_health_events: stores per-agent health check results.
-- Populated every 5 minutes by /api/cron/agent-health-check.
--
-- status values:
--   healthy  = lastHeartbeatAt < 30 min ago
--   degraded = lastHeartbeatAt 30–60 min ago
--   red      = lastHeartbeatAt > 60 min ago (or never seen)

create table if not exists agent_health_events (
  id                      uuid        primary key default gen_random_uuid(),
  agent_id                text        not null,
  agent_name              text        not null,
  status                  text        not null check (status in ('healthy', 'degraded', 'red')),
  checked_at              timestamptz not null default now(),
  last_heartbeat_at       timestamptz,
  minutes_since_heartbeat int
);

create index if not exists agent_health_events_agent_id_idx
  on agent_health_events(agent_id);

create index if not exists agent_health_events_checked_at_idx
  on agent_health_events(checked_at desc);

create index if not exists agent_health_events_agent_checked_idx
  on agent_health_events(agent_id, checked_at desc);
