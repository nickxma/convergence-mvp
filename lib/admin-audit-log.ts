/**
 * Admin / governance audit logging.
 *
 * All writes are fire-and-forget (non-blocking). Failures are logged to console
 * but never thrown — audit logging must never interrupt the primary request path.
 */
import { supabase } from '@/lib/supabase';

export type AuditActorRole = 'admin' | 'user' | 'system' | 'cron';

export type AuditAction =
  | 'content.publish'
  | 'content.unpublish'
  | 'content.reject'
  | 'governance.vote_cast'
  | 'governance.vote_changed'
  | 'member.invite'
  | 'rate_limit.override'
  | 'api_key.rotated'
  | 'token.snapshot'
  | 'dispute.refund_executed'
  | 'dispute.refund_approved'
  | 'dispute.rejected';

export interface AuditEntry {
  actorId: string;
  actorRole: AuditActorRole;
  action: AuditAction;
  targetId?: string | number;
  targetType?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Write an audit log entry. Non-blocking — safe to call without await.
 */
export function logAudit(entry: AuditEntry): void {
  supabase
    .from('admin_audit_log')
    .insert({
      actor_id:    entry.actorId,
      actor_role:  entry.actorRole,
      action:      entry.action,
      target_id:   entry.targetId !== undefined ? String(entry.targetId) : null,
      target_type: entry.targetType ?? null,
      metadata:    entry.metadata ?? null,
    })
    .then(({ error }) => {
      if (error) console.warn('[admin-audit-log] insert failed:', error.message);
    });
}
