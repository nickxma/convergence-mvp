-- Audit log for community moderation actions
-- Tracks flag, auto_hide, remove, and restore events on posts and replies.
--
-- target_post_id and target_reply_id are plain bigints (no FK) so that audit
-- records survive hard-deletion of the target content.

create table if not exists audit_logs (
  id              bigserial primary key,
  action          text        not null,
  actor_wallet    text        not null,
  target_post_id  bigint,
  target_reply_id bigint,
  reason          text,
  created_at      timestamptz not null default now(),
  constraint audit_logs_action_check check (action in ('flag', 'auto_hide', 'remove', 'restore'))
);

create index if not exists audit_logs_target_post_id_idx on audit_logs(target_post_id);
create index if not exists audit_logs_action_idx          on audit_logs(action);
create index if not exists audit_logs_created_at_idx      on audit_logs(created_at desc);

-- Service role only; public cannot read or write
alter table audit_logs enable row level security;
