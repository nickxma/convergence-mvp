-- 074_admin_audit_log.sql
-- Admin / governance audit trail for all privileged actions.
-- Supports OLU-800 (admin audit log endpoint and activity feed).

create table if not exists admin_audit_log (
  id          bigserial   primary key,
  actor_id    text        not null,        -- Privy userId, wallet address, or 'system'
  actor_role  text        not null,        -- 'admin' | 'user' | 'system' | 'cron'
  action      text        not null,        -- e.g. 'content.publish', 'governance.vote_cast'
  target_id   text,                        -- ID of affected entity (nullable)
  target_type text,                        -- 'submission' | 'essay' | 'post' | 'user' | etc.
  metadata    jsonb,                       -- arbitrary key/value context
  created_at  timestamptz not null default now()
);

create index admin_audit_log_actor_idx   on admin_audit_log (actor_id,  created_at desc);
create index admin_audit_log_action_idx  on admin_audit_log (action,    created_at desc);
create index admin_audit_log_created_idx on admin_audit_log (created_at desc);

alter table admin_audit_log enable row level security;
create policy "service_role_only" on admin_audit_log
  using (auth.role() = 'service_role');
