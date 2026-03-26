'use client';

/**
 * /admin/treasury — PYUSD multi-sig treasury approval queue
 *
 * Lists refund disputes that require 2-of-N admin approval before the
 * on-chain transfer executes. Shows:
 *   - Pending approval queue (disputes in 'reviewing' status)
 *   - Per-dispute: amount, user, reason, approval progress (1/2, 2/2)
 *   - Approve and Reject buttons
 *   - Audit trail of all dispute.refund_approved / dispute.rejected actions
 *
 * Auto-refreshes every 15 seconds.
 * Requires admin auth (ADMIN_WALLET bearer token via Privy wallet address).
 */

import { useCallback, useEffect, useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { useRouter } from 'next/navigation';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Approver {
  approver_id: string;
  approved_at: string;
  signature: string | null;
}

interface PendingApproval {
  id: string;
  payment_session_id: string;
  user_id: string;
  reason: string;
  refund_address: string;
  amount_pyusd: string;
  payment_tx_hash: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  approvals_received: number;
  approvals_required: number;
  approvers: Approver[];
}

interface AuditEntry {
  id: string;
  actor_id: string;
  actor_role: string;
  action: string;
  target_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ApprovalProgress({
  received,
  required,
}: {
  received: number;
  required: number;
}) {
  const complete = received >= required;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ display: 'flex', gap: 4 }}>
        {Array.from({ length: required }).map((_, i) => (
          <div
            key={i}
            style={{
              width: 12,
              height: 12,
              borderRadius: '50%',
              background: i < received ? '#4caf6e' : '#e0d8cc',
              border: `1.5px solid ${i < received ? '#3a9a5a' : '#c8bfb5'}`,
            }}
          />
        ))}
      </div>
      <span
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: complete ? '#16a34a' : '#a07020',
        }}
      >
        {received}/{required}
      </span>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function TreasuryPage() {
  const { ready, authenticated, user } = usePrivy();
  const router = useRouter();
  const walletAddress = user?.wallet?.address ?? null;

  const [pending, setPending] = useState<PendingApproval[] | null>(null);
  const [auditLog, setAuditLog] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  // Per-dispute action state
  const [actingId, setActingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  const fetchData = useCallback(async (wallet: string) => {
    setLoading(true);
    setError(null);
    try {
      const [pendingRes, auditRes] = await Promise.all([
        fetch('/api/admin/treasury/pending', {
          headers: { Authorization: `Bearer ${wallet}` },
          cache: 'no-store',
        }),
        fetch(
          '/api/admin/audit-log?action=dispute.refund_approved&limit=50',
          {
            headers: { Authorization: `Bearer ${wallet}` },
            cache: 'no-store',
          },
        ),
      ]);

      if (pendingRes.status === 403 || auditRes.status === 403) {
        setError('Access denied. Admin credentials required.');
        return;
      }
      if (!pendingRes.ok) {
        setError(`Failed to load pending approvals (${pendingRes.status}).`);
        return;
      }

      const pendingData = await pendingRes.json();
      setPending(pendingData.pending ?? []);

      if (auditRes.ok) {
        const auditData = await auditRes.json();
        setAuditLog(auditData.entries ?? []);
      }

      setLastRefresh(new Date());
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (ready && !authenticated) router.replace('/');
  }, [ready, authenticated, router]);

  useEffect(() => {
    if (walletAddress) fetchData(walletAddress);
  }, [walletAddress, fetchData]);

  // 15-second auto-refresh
  useEffect(() => {
    if (!walletAddress) return;
    const id = setInterval(() => fetchData(walletAddress), 15_000);
    return () => clearInterval(id);
  }, [walletAddress, fetchData]);

  async function handleApprove(disputeId: string) {
    if (!walletAddress || actingId) return;
    setActingId(disputeId);
    setActionError(null);
    setActionSuccess(null);
    try {
      const res = await fetch(`/api/admin/treasury/${disputeId}/approve`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${walletAddress}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      });
      const body = await res.json();
      if (!res.ok) {
        setActionError((body as { error?: string }).error ?? 'Approval failed.');
      } else if ((body as { status?: string }).status === 'resolved') {
        setActionSuccess(`Refund executed on-chain. Tx: ${(body as { txHash?: string }).txHash ?? '—'}`);
        await fetchData(walletAddress);
      } else {
        setActionSuccess(
          `Approval recorded. ${(body as { approvalsReceived?: number }).approvalsReceived ?? '?'}/${(body as { approvalsRequired?: number }).approvalsRequired ?? '?'} approvals received.`,
        );
        await fetchData(walletAddress);
      }
    } catch {
      setActionError('Network error.');
    } finally {
      setActingId(null);
    }
  }

  async function handleReject(disputeId: string) {
    if (!walletAddress || actingId) return;
    setActingId(disputeId);
    setActionError(null);
    setActionSuccess(null);
    try {
      const res = await fetch(`/api/admin/disputes/${disputeId}/resolve`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${walletAddress}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action: 'reject' }),
      });
      const body = await res.json();
      if (!res.ok) {
        setActionError((body as { error?: string }).error ?? 'Rejection failed.');
      } else {
        setActionSuccess('Dispute rejected.');
        await fetchData(walletAddress);
      }
    } catch {
      setActionError('Network error.');
    } finally {
      setActingId(null);
    }
  }

  if (!ready || !authenticated) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#faf7f2',
        }}
      >
        <span style={{ color: '#9c9080' }}>Loading…</span>
      </div>
    );
  }

  const pendingItems = pending ?? [];

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#faf7f2',
        padding: '32px 24px',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <div style={{ maxWidth: 860, margin: '0 auto' }}>
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 16,
            flexWrap: 'wrap',
            marginBottom: 28,
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
              <a
                href="/admin"
                style={{
                  fontSize: 12,
                  color: '#7d8c6e',
                  textDecoration: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                ← Admin
              </a>
            </div>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: '#3d4f38', margin: 0 }}>
              Treasury Approvals
            </h1>
            <p style={{ fontSize: 13, color: '#9c9080', marginTop: 4 }}>
              Multi-sig sign-off for PYUSD refunds above threshold · Auto-refreshes every 15s
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {lastRefresh && (
              <span style={{ fontSize: 11, color: '#b0a898' }}>
                Updated {lastRefresh.toLocaleTimeString()}
              </span>
            )}
            <button
              onClick={() => walletAddress && fetchData(walletAddress)}
              disabled={loading}
              style={{
                fontSize: 12,
                padding: '6px 14px',
                borderRadius: 8,
                border: '1px solid #d0c8bc',
                background: loading ? '#f0ece4' : '#fff',
                color: '#5c5248',
                cursor: loading ? 'not-allowed' : 'pointer',
              }}
            >
              {loading ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div
            style={{
              background: '#fef0f0',
              border: '1px solid #f5c5c5',
              borderRadius: 8,
              padding: '12px 16px',
              color: '#d94f4f',
              fontSize: 13,
              marginBottom: 20,
            }}
          >
            {error}
          </div>
        )}

        {/* Action feedback */}
        {actionError && (
          <div
            style={{
              background: '#fef0f0',
              border: '1px solid #f5c5c5',
              borderRadius: 8,
              padding: '10px 16px',
              color: '#d94f4f',
              fontSize: 13,
              marginBottom: 16,
            }}
          >
            {actionError}
          </div>
        )}
        {actionSuccess && (
          <div
            style={{
              background: '#eef8f0',
              border: '1px solid #86efac',
              borderRadius: 8,
              padding: '10px 16px',
              color: '#16a34a',
              fontSize: 13,
              marginBottom: 16,
            }}
          >
            {actionSuccess}
          </div>
        )}

        {/* Pending queue */}
        <section style={{ marginBottom: 40 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <h2 style={{ fontSize: 14, fontWeight: 700, color: '#3d4f38', margin: 0 }}>
              Pending Approvals
            </h2>
            {pending !== null && (
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  padding: '2px 8px',
                  borderRadius: 999,
                  background: pendingItems.length > 0 ? '#fef3c7' : '#f0ece4',
                  color: pendingItems.length > 0 ? '#92400e' : '#9c9080',
                  border: `1px solid ${pendingItems.length > 0 ? '#fcd34d' : '#e0d8cc'}`,
                }}
              >
                {pendingItems.length}
              </span>
            )}
          </div>

          {pending === null ? (
            <div
              style={{
                background: '#f0ece4',
                borderRadius: 12,
                height: 100,
                animation: 'pulse 1.5s ease-in-out infinite',
              }}
            />
          ) : pendingItems.length === 0 ? (
            <div
              style={{
                background: '#fdfaf5',
                border: '1px solid #e0d8cc',
                borderRadius: 12,
                padding: '40px 0',
                textAlign: 'center',
                color: '#9c9080',
              }}
            >
              <div style={{ fontSize: 28, marginBottom: 8 }}>✓</div>
              <p style={{ margin: 0, fontSize: 14 }}>No pending approvals.</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {pendingItems.map((item) => (
                <div
                  key={item.id}
                  style={{
                    background: '#fdfaf5',
                    border: '1px solid #e0d8cc',
                    borderRadius: 12,
                    padding: '18px 20px',
                  }}
                >
                  {/* Top row: amount + status */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      justifyContent: 'space-between',
                      gap: 12,
                      flexWrap: 'wrap',
                      marginBottom: 12,
                    }}
                  >
                    <div>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                        <span
                          style={{ fontSize: 22, fontWeight: 700, color: '#3d4f38' }}
                        >
                          {parseFloat(item.amount_pyusd).toLocaleString(undefined, {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </span>
                        <span style={{ fontSize: 13, color: '#7d8c6e', fontWeight: 600 }}>
                          PYUSD
                        </span>
                      </div>
                      <div style={{ fontSize: 11, color: '#9c9080', marginTop: 2 }}>
                        Opened {formatDate(item.created_at)}
                      </div>
                    </div>
                    <ApprovalProgress
                      received={item.approvals_received}
                      required={item.approvals_required}
                    />
                  </div>

                  {/* Detail rows */}
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 1fr',
                      gap: '6px 16px',
                      marginBottom: 14,
                    }}
                  >
                    <div>
                      <div style={{ fontSize: 10, color: '#9c9080', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 2 }}>
                        User
                      </div>
                      <div
                        style={{
                          fontSize: 12,
                          fontFamily: 'monospace',
                          color: '#5c5248',
                          background: '#f0ece4',
                          borderRadius: 4,
                          padding: '2px 6px',
                          display: 'inline-block',
                        }}
                      >
                        {shortId(item.user_id)}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: 10, color: '#9c9080', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 2 }}>
                        Refund address
                      </div>
                      <div
                        style={{
                          fontSize: 12,
                          fontFamily: 'monospace',
                          color: '#5c5248',
                          background: '#f0ece4',
                          borderRadius: 4,
                          padding: '2px 6px',
                          display: 'inline-block',
                        }}
                      >
                        {shortId(item.refund_address)}
                      </div>
                    </div>
                    <div style={{ gridColumn: '1 / -1' }}>
                      <div style={{ fontSize: 10, color: '#9c9080', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 2 }}>
                        Dispute reason
                      </div>
                      <div style={{ fontSize: 13, color: '#3d4f38' }}>{item.reason}</div>
                    </div>
                    {item.payment_tx_hash && (
                      <div style={{ gridColumn: '1 / -1' }}>
                        <div style={{ fontSize: 10, color: '#9c9080', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 2 }}>
                          Original payment tx
                        </div>
                        <div
                          style={{
                            fontSize: 11,
                            fontFamily: 'monospace',
                            color: '#5c5248',
                          }}
                        >
                          {item.payment_tx_hash}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Existing approvers */}
                  {item.approvers.length > 0 && (
                    <div style={{ marginBottom: 14 }}>
                      <div style={{ fontSize: 10, color: '#9c9080', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
                        Approvers
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {item.approvers.map((a) => (
                          <div
                            key={a.approver_id}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 8,
                              fontSize: 12,
                            }}
                          >
                            <span
                              style={{
                                width: 8,
                                height: 8,
                                borderRadius: '50%',
                                background: '#4caf6e',
                                flexShrink: 0,
                              }}
                            />
                            <span
                              style={{
                                fontFamily: 'monospace',
                                color: '#5c5248',
                                background: '#f0ece4',
                                borderRadius: 4,
                                padding: '1px 5px',
                              }}
                            >
                              {shortId(a.approver_id)}
                            </span>
                            <span style={{ color: '#b0a898', fontSize: 11 }}>
                              {formatDate(a.approved_at)}
                            </span>
                            {a.signature && (
                              <span
                                title={a.signature}
                                style={{
                                  fontSize: 10,
                                  color: '#7d8c6e',
                                  background: '#e8f0e5',
                                  borderRadius: 4,
                                  padding: '1px 5px',
                                }}
                              >
                                sig
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Actions */}
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      onClick={() => handleApprove(item.id)}
                      disabled={actingId === item.id}
                      style={{
                        padding: '7px 16px',
                        borderRadius: 8,
                        border: '1px solid #86efac',
                        background: actingId === item.id ? '#f0ece4' : '#eef8f0',
                        color: actingId === item.id ? '#b0a898' : '#16a34a',
                        fontSize: 13,
                        fontWeight: 600,
                        cursor: actingId === item.id ? 'not-allowed' : 'pointer',
                      }}
                    >
                      {actingId === item.id ? 'Processing…' : 'Approve'}
                    </button>
                    <button
                      onClick={() => handleReject(item.id)}
                      disabled={actingId === item.id}
                      style={{
                        padding: '7px 16px',
                        borderRadius: 8,
                        border: '1px solid #f5c5c5',
                        background: actingId === item.id ? '#f0ece4' : '#fef0f0',
                        color: actingId === item.id ? '#b0a898' : '#d94f4f',
                        fontSize: 13,
                        fontWeight: 600,
                        cursor: actingId === item.id ? 'not-allowed' : 'pointer',
                      }}
                    >
                      Reject
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Audit trail */}
        <section>
          <h2 style={{ fontSize: 14, fontWeight: 700, color: '#3d4f38', margin: '0 0 14px' }}>
            Audit Trail
          </h2>
          {auditLog === null ? (
            <div
              style={{
                background: '#f0ece4',
                borderRadius: 12,
                height: 80,
                animation: 'pulse 1.5s ease-in-out infinite',
              }}
            />
          ) : auditLog.length === 0 ? (
            <div
              style={{
                background: '#fdfaf5',
                border: '1px solid #e0d8cc',
                borderRadius: 12,
                padding: '28px 0',
                textAlign: 'center',
                color: '#b0a898',
                fontSize: 13,
              }}
            >
              No audit entries yet.
            </div>
          ) : (
            <div
              style={{
                background: '#fdfaf5',
                border: '1px solid #e0d8cc',
                borderRadius: 12,
                overflow: 'hidden',
              }}
            >
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#f0ece4' }}>
                    {['Time', 'Action', 'Actor', 'Target', 'Detail'].map((h, i) => (
                      <th
                        key={i}
                        style={{
                          padding: '9px 12px',
                          fontSize: 10,
                          fontWeight: 700,
                          color: '#9c9080',
                          textAlign: 'left',
                          textTransform: 'uppercase',
                          letterSpacing: '0.05em',
                          borderBottom: '1px solid #e0d8cc',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {auditLog.map((entry, idx) => {
                    const meta = entry.metadata ?? {};
                    const detail =
                      'approvalsReceived' in meta
                        ? `${meta.approvalsReceived}/${meta.requiredApprovals ?? '?'}`
                        : 'txHash' in meta
                          ? `tx: ${String(meta.txHash).slice(0, 10)}…`
                          : '';
                    return (
                      <tr
                        key={entry.id}
                        style={{
                          background: idx % 2 === 0 ? '#fdfaf5' : '#faf7f0',
                          borderBottom: '1px solid #ede8e0',
                        }}
                      >
                        <td
                          style={{
                            padding: '8px 12px',
                            fontSize: 11,
                            color: '#9c9080',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {formatDate(entry.created_at)}
                        </td>
                        <td style={{ padding: '8px 12px', fontSize: 12, color: '#3d4f38' }}>
                          <span
                            style={{
                              fontFamily: 'monospace',
                              fontSize: 11,
                              background:
                                entry.action === 'dispute.refund_executed'
                                  ? '#e8f5ee'
                                  : entry.action === 'dispute.rejected'
                                    ? '#fef0f0'
                                    : '#f0ece4',
                              color:
                                entry.action === 'dispute.refund_executed'
                                  ? '#16a34a'
                                  : entry.action === 'dispute.rejected'
                                    ? '#d94f4f'
                                    : '#5c5248',
                              borderRadius: 4,
                              padding: '2px 6px',
                            }}
                          >
                            {entry.action}
                          </span>
                        </td>
                        <td style={{ padding: '8px 12px' }}>
                          <span
                            style={{
                              fontFamily: 'monospace',
                              fontSize: 11,
                              color: '#5c5248',
                              background: '#f0ece4',
                              borderRadius: 4,
                              padding: '2px 5px',
                            }}
                          >
                            {shortId(entry.actor_id)}
                          </span>
                        </td>
                        <td style={{ padding: '8px 12px' }}>
                          {entry.target_id ? (
                            <span
                              style={{
                                fontFamily: 'monospace',
                                fontSize: 11,
                                color: '#5c5248',
                              }}
                            >
                              {shortId(entry.target_id)}
                            </span>
                          ) : (
                            <span style={{ color: '#c8bfb5', fontSize: 11 }}>—</span>
                          )}
                        </td>
                        <td style={{ padding: '8px 12px', fontSize: 11, color: '#7d8c6e' }}>
                          {detail || <span style={{ color: '#c8bfb5' }}>—</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}
