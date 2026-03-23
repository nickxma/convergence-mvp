'use client';

import { useEffect, useState, useCallback } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { useRouter } from 'next/navigation';

// ── Types ─────────────────────────────────────────────────────────────────────

interface DailyUptime {
  date: string;
  uptimePct: number;
  totalChecks: number;
}

interface AgentHealth {
  agentId: string;
  name: string;
  role: string;
  urlKey: string;
  currentStatus: 'healthy' | 'degraded' | 'red' | 'unknown';
  lastHeartbeatAt: string | null;
  minutesSinceHeartbeat: number | null;
  uptimePct7d: number | null;
  sparkline: DailyUptime[];
}

interface HealthData {
  agents: AgentHealth[];
  checkedAt: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATUS_COLOR: Record<AgentHealth['currentStatus'], string> = {
  healthy: '#4caf6e',
  degraded: '#e8a838',
  red: '#d94f4f',
  unknown: '#9c9080',
};

const STATUS_LABEL: Record<AgentHealth['currentStatus'], string> = {
  healthy: 'Healthy',
  degraded: 'Degraded',
  red: 'Down',
  unknown: 'Unknown',
};

function formatLastSeen(agent: AgentHealth): string {
  if (!agent.lastHeartbeatAt) return 'Never';
  if (agent.minutesSinceHeartbeat !== null) {
    const m = agent.minutesSinceHeartbeat;
    if (m < 1) return 'Just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    const rem = m % 60;
    return rem > 0 ? `${h}h ${rem}m ago` : `${h}h ago`;
  }
  return new Date(agent.lastHeartbeatAt).toLocaleTimeString();
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatusDot({ status }: { status: AgentHealth['currentStatus'] }) {
  const color = STATUS_COLOR[status];
  const isRed = status === 'red';
  return (
    <span
      style={{
        display: 'inline-block',
        width: 10,
        height: 10,
        borderRadius: '50%',
        background: color,
        flexShrink: 0,
        boxShadow: isRed ? `0 0 0 2px ${color}33` : undefined,
      }}
    />
  );
}

function Sparkline({ data }: { data: DailyUptime[] }) {
  if (data.length === 0) return <span style={{ color: '#b0a898', fontSize: 11 }}>No data</span>;
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 28 }}>
      {data.map((d) => {
        const pct = d.totalChecks === 0 ? 0 : d.uptimePct;
        const barH = Math.max((pct / 100) * 28, pct > 0 ? 3 : 2);
        const color = pct >= 90 ? '#4caf6e' : pct >= 60 ? '#e8a838' : '#d94f4f';
        const dateLabel = d.date.slice(5).replace('-', '/');
        return (
          <div
            key={d.date}
            title={d.totalChecks === 0 ? `${dateLabel}: no data` : `${dateLabel}: ${pct}% (${d.totalChecks} checks)`}
            style={{
              flex: 1,
              height: barH,
              background: d.totalChecks === 0 ? '#e0d8cc' : color,
              borderRadius: 2,
              cursor: 'default',
            }}
          />
        );
      })}
    </div>
  );
}

function AgentCard({ agent }: { agent: AgentHealth }) {
  const statusColor = STATUS_COLOR[agent.currentStatus];
  const borderColor = agent.currentStatus === 'red' ? '#f5c5c5' : agent.currentStatus === 'degraded' ? '#f5e0bc' : '#e0d8cc';

  return (
    <div
      style={{
        background: '#fdfaf5',
        border: `1px solid ${borderColor}`,
        borderRadius: 12,
        padding: '16px 18px',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <StatusDot status={agent.currentStatus} />
          <span
            style={{
              fontWeight: 600,
              fontSize: 14,
              color: '#3d4f38',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {agent.name}
          </span>
        </div>
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: statusColor,
            background: `${statusColor}18`,
            padding: '2px 8px',
            borderRadius: 99,
            whiteSpace: 'nowrap',
          }}
        >
          {STATUS_LABEL[agent.currentStatus]}
        </span>
      </div>

      {/* Meta */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontSize: 12, color: '#9c9080' }}>
          Last seen: <span style={{ color: '#5c5248' }}>{formatLastSeen(agent)}</span>
        </span>
        <span style={{ fontSize: 12, color: '#9c9080' }}>
          {agent.uptimePct7d !== null ? (
            <>
              7d uptime:{' '}
              <span
                style={{
                  color:
                    agent.uptimePct7d >= 90 ? '#4caf6e' : agent.uptimePct7d >= 60 ? '#e8a838' : '#d94f4f',
                  fontWeight: 600,
                }}
              >
                {agent.uptimePct7d}%
              </span>
            </>
          ) : (
            <span style={{ color: '#b0a898' }}>No history</span>
          )}
        </span>
      </div>

      {/* Sparkline */}
      <Sparkline data={agent.sparkline} />

      {/* Role badge */}
      <span style={{ fontSize: 10, color: '#b0a898', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {agent.role}
      </span>
    </div>
  );
}

function SummaryBar({ agents }: { agents: AgentHealth[] }) {
  const counts = { healthy: 0, degraded: 0, red: 0, unknown: 0 };
  for (const a of agents) counts[a.currentStatus]++;
  return (
    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
      {(['healthy', 'degraded', 'red'] as const).map((s) => (
        <div
          key={s}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            background: `${STATUS_COLOR[s]}12`,
            border: `1px solid ${STATUS_COLOR[s]}44`,
            borderRadius: 8,
            padding: '6px 14px',
          }}
        >
          <StatusDot status={s} />
          <span style={{ fontSize: 13, fontWeight: 600, color: STATUS_COLOR[s] }}>{counts[s]}</span>
          <span style={{ fontSize: 12, color: '#9c9080' }}>{STATUS_LABEL[s]}</span>
        </div>
      ))}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function OpenClawAdminPage() {
  const { ready, authenticated, user } = usePrivy();
  const router = useRouter();
  const walletAddress = user?.wallet?.address ?? null;

  const [data, setData] = useState<HealthData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const fetchHealth = useCallback(async (wallet: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/openclaw/health', {
        headers: { Authorization: `Bearer ${wallet}` },
        cache: 'no-store',
      });
      if (res.status === 403) {
        setError('Access denied. Admin credentials required.');
        return;
      }
      if (!res.ok) {
        setError(`Failed to load agent health (${res.status}).`);
        return;
      }
      setData(await res.json());
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
    if (walletAddress) fetchHealth(walletAddress);
  }, [walletAddress, fetchHealth]);

  // 30-second auto-refresh
  useEffect(() => {
    if (!walletAddress) return;
    const interval = setInterval(() => fetchHealth(walletAddress), 30_000);
    return () => clearInterval(interval);
  }, [walletAddress, fetchHealth]);

  // ── Render ──────────────────────────────────────────────────────────────────

  if (!ready || !authenticated) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ color: '#9c9080' }}>Loading…</span>
      </div>
    );
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#faf7f2',
        padding: '32px 24px',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <div style={{ maxWidth: 960, margin: '0 auto' }}>
        {/* Header */}
        <div style={{ marginBottom: 24, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: '#3d4f38', margin: 0 }}>OpenClaw Agent Status</h1>
            <p style={{ fontSize: 13, color: '#9c9080', marginTop: 4 }}>
              Health monitoring · 5-min polling · 30-min degraded / 60-min red thresholds
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {lastRefresh && (
              <span style={{ fontSize: 11, color: '#b0a898' }}>
                Updated {lastRefresh.toLocaleTimeString()}
              </span>
            )}
            <button
              onClick={() => walletAddress && fetchHealth(walletAddress)}
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

        {/* Summary bar */}
        {data && <div style={{ marginBottom: 20 }}><SummaryBar agents={data.agents} /></div>}

        {/* Loading skeleton */}
        {loading && !data && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                style={{
                  background: '#f0ece4',
                  borderRadius: 12,
                  height: 120,
                  animation: 'pulse 1.5s ease-in-out infinite',
                }}
              />
            ))}
          </div>
        )}

        {/* Agent grid */}
        {data && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
              gap: 16,
            }}
          >
            {data.agents.map((agent) => (
              <AgentCard key={agent.agentId} agent={agent} />
            ))}
          </div>
        )}

        {/* Empty state */}
        {data && data.agents.length === 0 && (
          <div style={{ textAlign: 'center', padding: '48px 0', color: '#9c9080' }}>
            No agents registered.
          </div>
        )}
      </div>
    </div>
  );
}
