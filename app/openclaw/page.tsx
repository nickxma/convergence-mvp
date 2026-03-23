'use client';

/**
 * /openclaw — Machine browser and waitlist UI.
 *
 * Shows all online claw machines with:
 *   • Available machines  → credits per play, "Play Now" button
 *   • Busy machines       → queue depth, "Join Queue" button
 *   • User's queue spots  → live position counter + estimated wait, "Leave Queue"
 *
 * Real-time queue position updates delivered via SSE
 * (GET /api/machines/:id/queue/stream).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { usePrivy } from '@privy-io/react-auth';
import { CreditBalance } from '@/components/credit-balance';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Machine {
  id: string;
  name: string;
  location: string | null;
  streamUrl: string;
  creditsPerPlay: number;
  prizeStockCount: number;
  busy: boolean;
  queueDepth: number;
}

interface QueueState {
  position: number;
  queueDepth: number;
  estimatedWaitMs: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatWait(ms: number): string {
  if (ms <= 0) return 'any moment';
  const mins = Math.ceil(ms / 60_000);
  return `~${mins} min${mins !== 1 ? 's' : ''}`;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatusDot({ busy }: { busy: boolean }) {
  return (
    <span
      style={{
        display: 'inline-block',
        width: 8,
        height: 8,
        borderRadius: '50%',
        background: busy ? '#f97316' : '#22c55e',
        marginRight: 6,
        flexShrink: 0,
      }}
    />
  );
}

interface MachineCardProps {
  machine: Machine;
  queueState: QueueState | null; // null = not in queue for this machine
  onPlay: (machineId: string) => void;
  onJoinQueue: (machineId: string) => void;
  onLeaveQueue: (machineId: string) => void;
  loading: boolean;
}

function MachineCard({
  machine,
  queueState,
  onPlay,
  onJoinQueue,
  onLeaveQueue,
  loading,
}: MachineCardProps) {
  const inQueue = queueState !== null;
  const statusLabel = machine.busy ? 'Busy' : 'Available';

  return (
    <div
      style={{
        background: '#1e293b',
        border: `1px solid ${machine.busy ? '#f9731644' : '#22c55e44'}`,
        borderRadius: 12,
        padding: '20px 24px',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        boxShadow: '0 2px 12px rgba(0,0,0,0.2)',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 18, color: '#f1f5f9' }}>{machine.name}</div>
          {machine.location && (
            <div style={{ fontSize: 13, color: '#94a3b8', marginTop: 2 }}>{machine.location}</div>
          )}
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            fontSize: 12,
            fontWeight: 600,
            color: machine.busy ? '#ea580c' : '#16a34a',
            background: machine.busy ? '#fff7ed' : '#f0fdf4',
            border: `1px solid ${machine.busy ? '#fed7aa' : '#bbf7d0'}`,
            borderRadius: 99,
            padding: '3px 10px',
            whiteSpace: 'nowrap',
          }}
        >
          <StatusDot busy={machine.busy} />
          {statusLabel}
        </div>
      </div>

      {/* Stats row */}
      <div style={{ display: 'flex', gap: 16, fontSize: 13, color: '#cbd5e1' }}>
        <div>
          <span style={{ color: '#9ca3af' }}>Credits: </span>
          <strong>{machine.creditsPerPlay}</strong>
        </div>
        <div>
          <span style={{ color: '#9ca3af' }}>Prizes left: </span>
          <strong>{machine.prizeStockCount}</strong>
        </div>
        {machine.busy && (
          <div>
            <span style={{ color: '#9ca3af' }}>Queue: </span>
            <strong>
              {inQueue ? queueState!.queueDepth : machine.queueDepth} waiting
            </strong>
          </div>
        )}
      </div>

      {/* Queue position (if waiting) */}
      {inQueue && (
        <div
          style={{
            background: '#fffbeb',
            border: '1px solid #fde68a',
            borderRadius: 8,
            padding: '10px 14px',
            fontSize: 14,
          }}
        >
          <div style={{ fontWeight: 600, color: '#92400e', marginBottom: 4 }}>
            You're #{queueState!.position} in queue
          </div>
          <div style={{ color: '#b45309' }}>
            Estimated wait: {formatWait(queueState!.estimatedWaitMs)}
          </div>
        </div>
      )}

      {/* Action button */}
      <div style={{ marginTop: 4 }}>
        {!machine.busy ? (
          <button
            onClick={() => onPlay(machine.id)}
            disabled={loading}
            style={{
              width: '100%',
              padding: '10px 0',
              background: '#f97316',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              fontWeight: 700,
              fontSize: 15,
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.6 : 1,
              transition: 'opacity 0.15s',
            }}
          >
            Play Now
          </button>
        ) : inQueue ? (
          <button
            onClick={() => onLeaveQueue(machine.id)}
            disabled={loading}
            style={{
              width: '100%',
              padding: '10px 0',
              background: '#f3f4f6',
              color: '#374151',
              border: '1px solid #d1d5db',
              borderRadius: 8,
              fontWeight: 600,
              fontSize: 15,
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.6 : 1,
              transition: 'opacity 0.15s',
            }}
          >
            Leave Queue
          </button>
        ) : (
          <button
            onClick={() => onJoinQueue(machine.id)}
            disabled={loading || machine.prizeStockCount === 0}
            style={{
              width: '100%',
              padding: '10px 0',
              background: '#1d4ed8',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              fontWeight: 700,
              fontSize: 15,
              cursor: loading || machine.prizeStockCount === 0 ? 'not-allowed' : 'pointer',
              opacity: loading || machine.prizeStockCount === 0 ? 0.5 : 1,
              transition: 'opacity 0.15s',
            }}
          >
            {machine.prizeStockCount === 0 ? 'Out of Prizes' : 'Join Queue'}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function OpenClawPage() {
  const router = useRouter();
  const { ready, authenticated, login, getAccessToken } = usePrivy();

  const [machines, setMachines] = useState<Machine[]>([]);
  const [loadingMachines, setLoadingMachines] = useState(true);
  const [machinesError, setMachinesError] = useState<string | null>(null);

  // Map of machineId → queue state (only for machines where user is waiting)
  const [queueStates, setQueueStates] = useState<Map<string, QueueState>>(new Map());

  // Map of machineId → EventSource (active SSE connections for queue streams)
  const sseRefs = useRef<Map<string, EventSource>>(new Map());

  // Per-machine loading state for button actions
  const [actionLoading, setActionLoading] = useState<Set<string>>(new Set());

  const setLoading = (machineId: string, val: boolean) => {
    setActionLoading((prev) => {
      const next = new Set(prev);
      val ? next.add(machineId) : next.delete(machineId);
      return next;
    });
  };

  // ── Fetch machines ──────────────────────────────────────────────────────────

  const fetchMachines = useCallback(async () => {
    try {
      const res = await fetch('/api/machines');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { machines: data } = await res.json();
      setMachines(data ?? []);
      setMachinesError(null);
    } catch {
      setMachinesError('Failed to load machines. Retrying…');
    } finally {
      setLoadingMachines(false);
    }
  }, []);

  useEffect(() => {
    fetchMachines();
    // Refresh machine list every 30 s (busy/queue status changes)
    const id = setInterval(fetchMachines, 30_000);
    return () => clearInterval(id);
  }, [fetchMachines]);

  // ── Queue SSE management ────────────────────────────────────────────────────

  const openQueueStream = useCallback(
    async (machineId: string) => {
      if (sseRefs.current.has(machineId)) return; // already connected

      const token = await getAccessToken().catch(() => null);
      if (!token) return;

      const url = `/api/machines/${machineId}/queue/stream?token=${encodeURIComponent(token)}`;
      const es = new EventSource(url);
      sseRefs.current.set(machineId, es);

      const handleUpdate = (e: MessageEvent, eventType: string) => {
        try {
          const payload = JSON.parse(e.data);
          if (eventType === 'connected' || eventType === 'queue_update') {
            setQueueStates((prev) => {
              const next = new Map(prev);
              next.set(machineId, {
                position: payload.position,
                queueDepth: payload.queueDepth,
                estimatedWaitMs: payload.estimatedWaitMs,
              });
              return next;
            });
          } else if (eventType === 'session_ready') {
            // Auto-redirect to play page
            es.close();
            sseRefs.current.delete(machineId);
            setQueueStates((prev) => {
              const next = new Map(prev);
              next.delete(machineId);
              return next;
            });
            router.push(`/play/${payload.sessionId}`);
          }
        } catch { /* ignore */ }
      };

      es.addEventListener('connected', (e) => handleUpdate(e, 'connected'));
      es.addEventListener('queue_update', (e) => handleUpdate(e, 'queue_update'));
      es.addEventListener('session_ready', (e) => handleUpdate(e, 'session_ready'));

      es.onerror = () => {
        es.close();
        sseRefs.current.delete(machineId);
        // If user is still in queue state, retry after 3 s
        setTimeout(() => {
          if (queueStates.has(machineId)) {
            openQueueStream(machineId);
          }
        }, 3_000);
      };
    },
    [getAccessToken, router, queueStates],
  );

  const closeQueueStream = useCallback((machineId: string) => {
    const es = sseRefs.current.get(machineId);
    if (es) {
      es.close();
      sseRefs.current.delete(machineId);
    }
  }, []);

  // Cleanup SSE on unmount
  useEffect(() => {
    const refs = sseRefs.current;
    return () => {
      refs.forEach((es) => es.close());
      refs.clear();
    };
  }, []);

  // ── Action handlers ─────────────────────────────────────────────────────────

  const handlePlay = useCallback(
    async (machineId: string) => {
      if (!authenticated) { login(); return; }
      setLoading(machineId, true);
      try {
        const token = await getAccessToken();
        const res = await fetch('/api/openclaw/sessions/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ machineId }),
        });
        const data = await res.json();
        if (!res.ok) {
          alert(data.error?.message ?? 'Failed to start session.');
          return;
        }
        router.push(`/play/${data.sessionId}`);
      } catch {
        alert('Network error. Please try again.');
      } finally {
        setLoading(machineId, false);
      }
    },
    [authenticated, login, getAccessToken, router],
  );

  const handleJoinQueue = useCallback(
    async (machineId: string) => {
      if (!authenticated) { login(); return; }
      setLoading(machineId, true);
      try {
        const token = await getAccessToken();
        const res = await fetch(`/api/machines/${machineId}/queue/join`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({}),
        });
        const data = await res.json();
        if (!res.ok) {
          // If machine became available while the user was clicking, redirect to start
          if (data.error?.code === 'MACHINE_AVAILABLE') {
            await handlePlay(machineId);
            return;
          }
          alert(data.error?.message ?? 'Failed to join queue.');
          return;
        }
        // Update queue state immediately, then open SSE stream
        setQueueStates((prev) => {
          const next = new Map(prev);
          next.set(machineId, {
            position: data.position,
            queueDepth: data.queueDepth,
            estimatedWaitMs: data.estimatedWaitMs,
          });
          return next;
        });
        openQueueStream(machineId);
        // Refresh machine list so queueDepth updates
        fetchMachines();
      } catch {
        alert('Network error. Please try again.');
      } finally {
        setLoading(machineId, false);
      }
    },
    [authenticated, login, getAccessToken, handlePlay, openQueueStream, fetchMachines],
  );

  const handleLeaveQueue = useCallback(
    async (machineId: string) => {
      setLoading(machineId, true);
      try {
        const token = await getAccessToken();
        const res = await fetch(`/api/machines/${machineId}/queue/leave`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) {
          const data = await res.json();
          alert(data.error?.message ?? 'Failed to leave queue.');
          return;
        }
        closeQueueStream(machineId);
        setQueueStates((prev) => {
          const next = new Map(prev);
          next.delete(machineId);
          return next;
        });
        fetchMachines();
      } catch {
        alert('Network error. Please try again.');
      } finally {
        setLoading(machineId, false);
      }
    },
    [getAccessToken, closeQueueStream, fetchMachines],
  );

  // ── Render ──────────────────────────────────────────────────────────────────

  if (!ready) {
    return (
      <div style={{ textAlign: 'center', padding: '80px 20px', color: '#64748b', background: '#0f172a', minHeight: '100vh' }}>
        Loading…
      </div>
    );
  }

  return (
    <div style={{ fontFamily: 'system-ui, -apple-system, sans-serif', background: '#0f172a', minHeight: '100vh' }}>
      <style>{`
        @keyframes float { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-8px); } }
        @keyframes pulseDot { 0%,100% { opacity:1; transform:scale(1); } 50% { opacity:0.5; transform:scale(0.8); } }
      `}</style>

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section
        style={{
          background: 'linear-gradient(160deg, #0f172a 0%, #1e1b4b 50%, #0f172a 100%)',
          padding: '80px 24px 60px',
          textAlign: 'center',
          borderBottom: '1px solid #1e293b',
        }}
      >
        <div style={{ maxWidth: 680, margin: '0 auto' }}>
          <div
            style={{
              fontSize: 72,
              marginBottom: 16,
              animation: 'float 3s ease-in-out infinite',
              display: 'inline-block',
            }}
          >
            🦀
          </div>
          <h1
            style={{
              fontSize: 'clamp(32px, 6vw, 52px)',
              fontWeight: 900,
              color: '#f8fafc',
              margin: '0 0 16px',
              lineHeight: 1.15,
              letterSpacing: '-0.03em',
            }}
          >
            Play a Real Claw Machine,{' '}
            <span style={{ color: '#f97316' }}>Live from Your Phone.</span>
          </h1>
          <p
            style={{
              fontSize: 18,
              color: '#94a3b8',
              margin: '0 0 32px',
              lineHeight: 1.6,
            }}
          >
            Real machines. Real prizes. Control the claw with your phone and win
            shipped to your door.
          </p>

          {/* Live status indicator */}
          <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginBottom: 32 }}>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                background: '#052e16',
                border: '1px solid #16a34a44',
                borderRadius: 99,
                padding: '6px 16px',
                fontSize: 13,
                color: '#4ade80',
                fontWeight: 600,
              }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: '#22c55e',
                  animation: 'pulseDot 2s infinite',
                  flexShrink: 0,
                }}
              />
              {machines.filter((m) => !m.busy).length > 0
                ? `${machines.filter((m) => !m.busy).length} machine${
                    machines.filter((m) => !m.busy).length !== 1 ? 's' : ''
                  } available`
                : 'Machines coming online soon'}
            </span>
          </div>

          {/* Credit balance chip */}
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 20 }}>
            <CreditBalance variant="chip" />
          </div>

          <button
            onClick={() => {
              document.getElementById('machines-section')?.scrollIntoView({ behavior: 'smooth' });
            }}
            style={{
              padding: '16px 40px',
              background: 'linear-gradient(90deg, #ea580c, #f97316)',
              color: '#fff',
              border: 'none',
              borderRadius: 99,
              fontWeight: 800,
              fontSize: 17,
              cursor: 'pointer',
              boxShadow: '0 8px 32px rgba(249,115,22,0.4)',
              letterSpacing: '0.02em',
            }}
          >
            Play Now →
          </button>
        </div>
      </section>

      {/* ── How it works ──────────────────────────────────────────────────── */}
      <section style={{ padding: '60px 24px', borderBottom: '1px solid #1e293b' }}>
        <div style={{ maxWidth: 900, margin: '0 auto' }}>
          <h2
            style={{
              textAlign: 'center',
              fontSize: 24,
              fontWeight: 800,
              color: '#f8fafc',
              margin: '0 0 40px',
              letterSpacing: '-0.02em',
            }}
          >
            How it works
          </h2>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: 24,
            }}
          >
            {[
              {
                step: '01',
                icon: '🎯',
                title: 'Pick a machine',
                body: 'Browse live machines. Each one has real prizes inside — stuffed animals, collectibles, and more.',
              },
              {
                step: '02',
                icon: '🕹️',
                title: 'Control the claw',
                body: 'Use the on-screen D-pad to move the claw left, right, forward, back — then drop and grab.',
              },
              {
                step: '03',
                icon: '🏆',
                title: 'Win & claim',
                body: 'If you grab a prize, it gets shipped directly to your door. No gimmicks.',
              },
            ].map(({ step, icon, title, body }) => (
              <div
                key={step}
                style={{
                  background: '#1e293b',
                  border: '1px solid #334155',
                  borderRadius: 14,
                  padding: '24px 20px',
                  position: 'relative',
                }}
              >
                <span
                  style={{
                    position: 'absolute',
                    top: 14,
                    right: 16,
                    fontSize: 11,
                    fontWeight: 800,
                    color: '#475569',
                    letterSpacing: '0.08em',
                  }}
                >
                  {step}
                </span>
                <div style={{ fontSize: 36, marginBottom: 12 }}>{icon}</div>
                <div style={{ fontWeight: 700, fontSize: 16, color: '#f1f5f9', marginBottom: 8 }}>
                  {title}
                </div>
                <div style={{ fontSize: 14, color: '#94a3b8', lineHeight: 1.6 }}>{body}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Machine browser ───────────────────────────────────────────────── */}
      <div
        id="machines-section"
        style={{
          maxWidth: 900,
          margin: '0 auto',
          padding: '40px 20px',
        }}
      >
      {/* Machine browser header */}
      <div style={{ marginBottom: 28, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ fontSize: 22, fontWeight: 800, color: '#f8fafc', margin: 0 }}>
            Available Machines
          </h2>
          <p style={{ color: '#64748b', marginTop: 6, fontSize: 14 }}>
            Join the queue if a machine is busy — you'll be notified when it's your turn.
          </p>
        </div>
        {/* Credit balance — full variant for the play section */}
        <div style={{ minWidth: 200 }}>
          <CreditBalance variant="full" />
        </div>
      </div>

      {/* Machine grid */}
      {loadingMachines ? (
        <div style={{ color: '#9ca3af', fontSize: 15 }}>Loading machines…</div>
      ) : machinesError ? (
        <div style={{ color: '#dc2626', fontSize: 15 }}>{machinesError}</div>
      ) : machines.length === 0 ? (
        <div
          style={{
            textAlign: 'center',
            padding: '60px 20px',
            color: '#94a3b8',
            background: '#1e293b',
            borderRadius: 12,
            border: '1px dashed #334155',
          }}
        >
          <div style={{ fontSize: 32, marginBottom: 12 }}>😴</div>
          <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 6 }}>No machines online</div>
          <div style={{ fontSize: 14 }}>Check back soon — machines come online periodically.</div>
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: 20,
          }}
        >
          {machines.map((machine) => (
            <MachineCard
              key={machine.id}
              machine={machine}
              queueState={queueStates.get(machine.id) ?? null}
              onPlay={handlePlay}
              onJoinQueue={handleJoinQueue}
              onLeaveQueue={handleLeaveQueue}
              loading={actionLoading.has(machine.id)}
            />
          ))}
        </div>
      )}

      {/* Login nudge */}
      {!authenticated && machines.length > 0 && (
        <div
          style={{
            marginTop: 32,
            padding: '16px 20px',
            background: '#1e3a5f',
            border: '1px solid #1d4ed844',
            borderRadius: 10,
            fontSize: 14,
            color: '#93c5fd',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <span style={{ fontSize: 20 }}>🔐</span>
          <span>
            <strong>Sign in</strong> to start playing or join a queue.{' '}
            <button
              onClick={login}
              style={{
                background: 'none',
                border: 'none',
                color: '#60a5fa',
                fontWeight: 700,
                cursor: 'pointer',
                textDecoration: 'underline',
                padding: 0,
                fontSize: 'inherit',
              }}
            >
              Log in →
            </button>
          </span>
        </div>
      )}
      </div>
    </div>
  );
}
