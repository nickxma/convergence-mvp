'use client';

/**
 * /play/:sessionId — OpenClaw live play page.
 *
 * Layout:
 *   • HLS video player (top, full-width on mobile)
 *   • Session info bar: credit counter + countdown timer
 *   • On-screen D-pad: ▲ ▼ ◄ ► + DROP button
 *   • Win celebration: full-screen confetti + win card + address form + share
 *
 * Real-time updates via SSE (/api/machines/:id/events).
 * Commands sent via POST (/api/machines/:id/command).
 * Video loaded via HLS.js (/api/machines/:id/stream).
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { usePrivy } from '@privy-io/react-auth';
import { RecentWinsTicker } from '@/components/recent-wins-ticker';
import { HowToPlayModal, HOW_TO_PLAY_STORAGE_KEY } from '@/components/how-to-play-modal';

// ── Types ─────────────────────────────────────────────────────────────────────

interface SessionInfo {
  sessionId: string;
  machineId: string;
  creditsRemaining: number;
  expiresAt: string; // ISO string
}

type Direction = 'up' | 'down' | 'left' | 'right' | 'drop';

interface AddressForm {
  name: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  country: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const BUTTON_HOLD_MS = 150;

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatTimeLeft(ms: number): string {
  if (ms <= 0) return '0:00';
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatWonAt(iso: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

// ── Confetti ──────────────────────────────────────────────────────────────────

function ConfettiCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const COLORS = [
      '#f97316', '#8b5cf6', '#ec4899', '#22c55e',
      '#3b82f6', '#eab308', '#ef4444', '#14b8a6',
    ];

    const particles = Array.from({ length: 150 }, () => ({
      x: Math.random() * canvas.width,
      y: -20 - Math.random() * canvas.height * 0.5,
      w: 8 + Math.random() * 8,
      h: 4 + Math.random() * 6,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      vx: (Math.random() - 0.5) * 3,
      vy: 2 + Math.random() * 4,
      angle: Math.random() * Math.PI * 2,
      av: (Math.random() - 0.5) * 0.2,
    }));

    function draw() {
      if (!ctx || !canvas) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      let alive = false;
      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        p.angle += p.av;
        if (p.y < canvas.height + 20) alive = true;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.angle);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      }
      if (alive) {
        rafRef.current = requestAnimationFrame(draw);
      }
    }

    rafRef.current = requestAnimationFrame(draw);

    const onResize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    window.addEventListener('resize', onResize);

    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 200,
      }}
    />
  );
}

// ── Win celebration ───────────────────────────────────────────────────────────

function WinCelebration({
  winId,
  machineName,
  wonAt,
  onClose,
  getAccessToken,
}: {
  winId: string | null;
  machineName: string | null;
  wonAt: string | null;
  onClose: () => void;
  getAccessToken: () => Promise<string | null>;
}) {
  const [step, setStep] = useState<'card' | 'address' | 'done'>('card');
  const [form, setForm] = useState<AddressForm>({
    name: '',
    street: '',
    city: '',
    state: '',
    zip: '',
    country: 'US',
  });
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const shareUrl =
    winId && typeof window !== 'undefined'
      ? `${window.location.origin}/wins/${winId}`
      : null;

  const handleCopyLink = useCallback(async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  }, [shareUrl]);

  const handleAddressSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!winId) return;
      setSubmitting(true);
      setSubmitError(null);
      try {
        const token = await getAccessToken();
        const res = await fetch(`/api/wins/${winId}/address`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify(form),
        });
        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          setSubmitError((d as { error?: { message?: string } })?.error?.message ?? 'Failed to save address. Please try again.');
          return;
        }
        setStep('done');
      } catch {
        setSubmitError('Network error. Please try again.');
      } finally {
        setSubmitting(false);
      }
    },
    [winId, form, getAccessToken],
  );

  const inputStyle: React.CSSProperties = {
    width: '100%',
    background: 'rgba(255,255,255,0.08)',
    border: '1px solid rgba(255,255,255,0.15)',
    borderRadius: 8,
    padding: '10px 12px',
    fontSize: 14,
    color: '#f1f5f9',
    outline: 'none',
    boxSizing: 'border-box',
  };

  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: 12,
    color: '#94a3b8',
    marginBottom: 4,
    fontWeight: 500,
  };

  const twitterHref = shareUrl
    ? `https://twitter.com/intent/tweet?text=${encodeURIComponent('I just won a prize on OpenClaw! 🎉')}&url=${encodeURIComponent(shareUrl)}`
    : null;

  return (
    <>
      <ConfettiCanvas />

      {/* Overlay backdrop */}
      <div
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.75)',
          backdropFilter: 'blur(4px)',
          WebkitBackdropFilter: 'blur(4px)',
          zIndex: 150,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 20,
          overflowY: 'auto',
        }}
      >
        <div
          style={{
            background: 'linear-gradient(145deg, #1e1b4b, #0f172a)',
            border: '1px solid rgba(139,92,246,0.3)',
            borderRadius: 24,
            padding: '36px 28px',
            maxWidth: 400,
            width: '100%',
            boxShadow: '0 24px 80px rgba(0,0,0,0.5)',
            position: 'relative',
            zIndex: 151,
          }}
        >
          {/* Close */}
          <button
            onClick={onClose}
            style={{
              position: 'absolute',
              top: 14,
              right: 16,
              background: 'none',
              border: 'none',
              color: '#64748b',
              fontSize: 22,
              cursor: 'pointer',
              padding: 4,
              lineHeight: 1,
            }}
            aria-label="Close"
          >
            ×
          </button>

          {/* ── Step: card ── */}
          {step === 'card' && (
            <>
              <div style={{ textAlign: 'center', marginBottom: 20 }}>
                <div style={{ fontSize: 64, lineHeight: 1, marginBottom: 10 }}>🏆</div>
                <h2
                  style={{
                    fontSize: 28,
                    fontWeight: 800,
                    color: '#f8fafc',
                    margin: '0 0 8px',
                  }}
                >
                  You won!
                </h2>
                {machineName && (
                  <p style={{ fontSize: 14, color: '#94a3b8', margin: '0 0 4px' }}>
                    Machine: <strong style={{ color: '#e2e8f0' }}>{machineName}</strong>
                  </p>
                )}
                {wonAt && (
                  <p style={{ fontSize: 13, color: '#64748b', margin: 0 }}>
                    {formatWonAt(wonAt)}
                  </p>
                )}
              </div>

              {/* Share row */}
              {shareUrl && (
                <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                  {twitterHref && (
                    <a
                      href={twitterHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        flex: 1,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: '#000',
                        color: '#fff',
                        borderRadius: 10,
                        padding: '10px 0',
                        fontSize: 13,
                        fontWeight: 700,
                        textDecoration: 'none',
                        border: '1px solid rgba(255,255,255,0.1)',
                      }}
                    >
                      Share on X
                    </a>
                  )}
                  <button
                    onClick={handleCopyLink}
                    style={{
                      flex: 1,
                      background: copied ? 'rgba(34,197,94,0.2)' : 'rgba(255,255,255,0.08)',
                      color: copied ? '#4ade80' : '#cbd5e1',
                      border: `1px solid ${copied ? 'rgba(34,197,94,0.4)' : 'rgba(255,255,255,0.12)'}`,
                      borderRadius: 10,
                      padding: '10px 0',
                      fontSize: 13,
                      fontWeight: 700,
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                    }}
                  >
                    {copied ? '✓ Copied!' : 'Copy Link'}
                  </button>
                </div>
              )}

              <button
                onClick={() => setStep('address')}
                style={{
                  width: '100%',
                  background: 'linear-gradient(135deg, #7c3aed, #db2777)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 12,
                  padding: '13px 0',
                  fontSize: 16,
                  fontWeight: 700,
                  cursor: 'pointer',
                  marginBottom: 10,
                }}
              >
                Claim Your Prize →
              </button>

              <button
                onClick={onClose}
                style={{
                  width: '100%',
                  background: 'none',
                  border: 'none',
                  color: '#475569',
                  fontSize: 13,
                  cursor: 'pointer',
                  padding: '8px 0',
                }}
              >
                Skip for now
              </button>
            </>
          )}

          {/* ── Step: address ── */}
          {step === 'address' && (
            <>
              <h3
                style={{
                  fontSize: 20,
                  fontWeight: 700,
                  color: '#f8fafc',
                  marginTop: 0,
                  marginBottom: 4,
                  textAlign: 'center',
                }}
              >
                Where should we ship your prize?
              </h3>
              <p
                style={{
                  fontSize: 13,
                  color: '#64748b',
                  textAlign: 'center',
                  marginBottom: 20,
                  marginTop: 0,
                }}
              >
                Enter your shipping address below.
              </p>

              <form onSubmit={handleAddressSubmit}>
                <div style={{ marginBottom: 12 }}>
                  <label htmlFor="win-name" style={labelStyle}>Full name</label>
                  <input
                    id="win-name"
                    type="text"
                    placeholder="Jane Smith"
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    required
                    style={inputStyle}
                  />
                </div>

                <div style={{ marginBottom: 12 }}>
                  <label htmlFor="win-street" style={labelStyle}>Street address</label>
                  <input
                    id="win-street"
                    type="text"
                    placeholder="123 Main St, Apt 4"
                    value={form.street}
                    onChange={(e) => setForm((f) => ({ ...f, street: e.target.value }))}
                    required
                    style={inputStyle}
                  />
                </div>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '2fr 1fr',
                    gap: 8,
                    marginBottom: 12,
                  }}
                >
                  <div>
                    <label htmlFor="win-city" style={labelStyle}>City</label>
                    <input
                      id="win-city"
                      type="text"
                      placeholder="San Francisco"
                      value={form.city}
                      onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
                      required
                      style={inputStyle}
                    />
                  </div>
                  <div>
                    <label htmlFor="win-state" style={labelStyle}>State</label>
                    <input
                      id="win-state"
                      type="text"
                      placeholder="CA"
                      maxLength={3}
                      value={form.state}
                      onChange={(e) => setForm((f) => ({ ...f, state: e.target.value }))}
                      required
                      style={inputStyle}
                    />
                  </div>
                </div>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: 8,
                    marginBottom: 16,
                  }}
                >
                  <div>
                    <label htmlFor="win-zip" style={labelStyle}>ZIP code</label>
                    <input
                      id="win-zip"
                      type="text"
                      placeholder="94105"
                      value={form.zip}
                      onChange={(e) => setForm((f) => ({ ...f, zip: e.target.value }))}
                      required
                      style={inputStyle}
                    />
                  </div>
                  <div>
                    <label htmlFor="win-country" style={labelStyle}>Country</label>
                    <input
                      id="win-country"
                      type="text"
                      placeholder="US"
                      maxLength={2}
                      value={form.country}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, country: e.target.value.toUpperCase() }))
                      }
                      required
                      style={inputStyle}
                    />
                  </div>
                </div>

                {submitError && (
                  <p
                    style={{
                      color: '#f87171',
                      fontSize: 13,
                      marginBottom: 12,
                      marginTop: 0,
                      background: 'rgba(239,68,68,0.1)',
                      borderRadius: 8,
                      padding: '8px 12px',
                    }}
                  >
                    {submitError}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={submitting}
                  style={{
                    width: '100%',
                    background: submitting
                      ? 'rgba(124,58,237,0.4)'
                      : 'linear-gradient(135deg, #7c3aed, #db2777)',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 12,
                    padding: '13px 0',
                    fontSize: 15,
                    fontWeight: 700,
                    cursor: submitting ? 'wait' : 'pointer',
                    marginBottom: 10,
                  }}
                >
                  {submitting ? 'Saving…' : 'Submit Address'}
                </button>

                <button
                  type="button"
                  onClick={() => setStep('card')}
                  style={{
                    width: '100%',
                    background: 'none',
                    border: 'none',
                    color: '#475569',
                    fontSize: 13,
                    cursor: 'pointer',
                    padding: '8px 0',
                  }}
                >
                  ← Back
                </button>
              </form>
            </>
          )}

          {/* ── Step: done ── */}
          {step === 'done' && (
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 56, marginBottom: 12 }}>📦</div>
              <h3
                style={{
                  fontSize: 22,
                  fontWeight: 800,
                  color: '#f8fafc',
                  margin: '0 0 8px',
                }}
              >
                Your prize is on its way!
              </h3>
              <p style={{ fontSize: 14, color: '#94a3b8', marginBottom: 24 }}>
                We&apos;ll email you a tracking number once your prize ships.
              </p>

              {shareUrl && (
                <div style={{ marginBottom: 20 }}>
                  <p style={{ fontSize: 13, color: '#64748b', marginBottom: 10 }}>
                    Share your win:
                  </p>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {twitterHref && (
                      <a
                        href={twitterHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          flex: 1,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          background: '#000',
                          color: '#fff',
                          borderRadius: 10,
                          padding: '10px 0',
                          fontSize: 13,
                          fontWeight: 700,
                          textDecoration: 'none',
                          border: '1px solid rgba(255,255,255,0.1)',
                        }}
                      >
                        Share on X
                      </a>
                    )}
                    <button
                      onClick={handleCopyLink}
                      style={{
                        flex: 1,
                        background: copied ? 'rgba(34,197,94,0.2)' : 'rgba(255,255,255,0.08)',
                        color: copied ? '#4ade80' : '#cbd5e1',
                        border: `1px solid ${copied ? 'rgba(34,197,94,0.4)' : 'rgba(255,255,255,0.12)'}`,
                        borderRadius: 10,
                        padding: '10px 0',
                        fontSize: 13,
                        fontWeight: 700,
                        cursor: 'pointer',
                      }}
                    >
                      {copied ? '✓ Copied!' : 'Copy Link'}
                    </button>
                  </div>
                </div>
              )}

              <button
                onClick={onClose}
                style={{
                  width: '100%',
                  background: 'rgba(255,255,255,0.06)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  color: '#cbd5e1',
                  borderRadius: 12,
                  padding: '12px 0',
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Back to game
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function CreditBadge({ credits }: { credits: number }) {
  const low = credits <= 3;
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        background: low ? '#fee2e2' : '#f0fdf4',
        border: `1px solid ${low ? '#fca5a5' : '#86efac'}`,
        borderRadius: 99,
        padding: '4px 12px',
        fontSize: 15,
        fontWeight: 700,
        color: low ? '#dc2626' : '#16a34a',
        transition: 'background 0.3s, color 0.3s',
      }}
    >
      <span style={{ fontSize: 18 }}>🪙</span>
      {credits} credit{credits !== 1 ? 's' : ''}
    </div>
  );
}

function TimerBadge({ expiresAt }: { expiresAt: string }) {
  const [msLeft, setMsLeft] = useState(() => new Date(expiresAt).getTime() - Date.now());

  useEffect(() => {
    const id = setInterval(() => {
      setMsLeft(new Date(expiresAt).getTime() - Date.now());
    }, 500);
    return () => clearInterval(id);
  }, [expiresAt]);

  const urgent = msLeft < 30_000;
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        background: urgent ? '#fff7ed' : '#eff6ff',
        border: `1px solid ${urgent ? '#fdba74' : '#93c5fd'}`,
        borderRadius: 99,
        padding: '4px 12px',
        fontSize: 15,
        fontWeight: 700,
        color: urgent ? '#c2410c' : '#1d4ed8',
        transition: 'background 0.3s, color 0.3s',
      }}
    >
      <span style={{ fontSize: 18 }}>⏱</span>
      {formatTimeLeft(msLeft)}
    </div>
  );
}

function DPad({
  onCommand,
  disabled,
}: {
  onCommand: (dir: Direction) => void;
  disabled: boolean;
}) {
  const lastPress = useRef(0);

  const press = useCallback(
    (dir: Direction) => {
      if (disabled) return;
      const now = Date.now();
      if (now - lastPress.current < BUTTON_HOLD_MS) return;
      lastPress.current = now;
      onCommand(dir);
    },
    [disabled, onCommand],
  );

  useEffect(() => {
    const keyMap: Record<string, Direction> = {
      ArrowUp: 'up',
      ArrowDown: 'down',
      ArrowLeft: 'left',
      ArrowRight: 'right',
      ' ': 'drop',
      Enter: 'drop',
    };
    const onKey = (e: KeyboardEvent) => {
      const dir = keyMap[e.key];
      if (dir) {
        e.preventDefault();
        press(dir);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [press]);

  const btnStyle = (color: string): React.CSSProperties => ({
    width: 64,
    height: 64,
    borderRadius: 12,
    border: 'none',
    background: disabled ? '#d1d5db' : color,
    color: disabled ? '#9ca3af' : '#fff',
    fontSize: 26,
    fontWeight: 700,
    cursor: disabled ? 'not-allowed' : 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: disabled ? 'none' : '0 4px 0 rgba(0,0,0,0.25)',
    userSelect: 'none',
    WebkitUserSelect: 'none',
    touchAction: 'manipulation',
    transition: 'background 0.2s, box-shadow 0.1s',
    flexShrink: 0,
  });

  const dropStyle: React.CSSProperties = {
    ...btnStyle('#ef4444'),
    width: 72,
    height: 72,
    borderRadius: '50%',
    fontSize: 14,
    fontWeight: 800,
    letterSpacing: '0.05em',
    background: disabled ? '#d1d5db' : '#ef4444',
    boxShadow: disabled ? 'none' : '0 4px 0 #b91c1c',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0 }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '64px 64px 64px',
          gridTemplateRows: '64px 64px 64px',
          gap: 8,
        }}
      >
        <div />
        <button style={btnStyle('#3b82f6')} onPointerDown={() => press('up')} aria-label="Move up">▲</button>
        <div />

        <button style={btnStyle('#3b82f6')} onPointerDown={() => press('left')} aria-label="Move left">◄</button>
        <button style={dropStyle} onPointerDown={() => press('drop')} aria-label="Drop claw">DROP</button>
        <button style={btnStyle('#3b82f6')} onPointerDown={() => press('right')} aria-label="Move right">►</button>

        <div />
        <button style={btnStyle('#3b82f6')} onPointerDown={() => press('down')} aria-label="Move down">▼</button>
        <div />
      </div>
    </div>
  );
}

function EndedBanner({ reason }: { reason: string }) {
  const messages: Record<string, string> = {
    credits_exhausted: 'Out of credits — session ended.',
    expired: "Time's up — session expired.",
    manual: 'Session ended.',
  };
  return (
    <div
      style={{
        background: '#1f2937',
        color: '#f9fafb',
        borderRadius: 10,
        padding: '14px 20px',
        textAlign: 'center',
        fontSize: 15,
        fontWeight: 600,
      }}
    >
      {messages[reason] ?? 'Session ended.'}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function PlayPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const router = useRouter();
  const { ready, authenticated, getAccessToken } = usePrivy();

  const videoRef = useRef<HTMLVideoElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hlsRef = useRef<any>(null);

  const [sessionInfo, setSessionInfo] = useState<SessionInfo | null>(null);
  const [credits, setCredits] = useState(0);
  const [won, setWon] = useState(false);
  const [winId, setWinId] = useState<string | null>(null);
  const [wonAt, setWonAt] = useState<string | null>(null);
  const [ended, setEnded] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [howToPlayOpen, setHowToPlayOpen] = useState(false);

  // Auto-show how-to-play modal for first-time visitors
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const seen = localStorage.getItem(HOW_TO_PLAY_STORAGE_KEY);
      if (!seen) setHowToPlayOpen(true);
    }
  }, []);

  // ── Auth guard ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (ready && !authenticated) router.replace('/login');
  }, [ready, authenticated, router]);

  // ── SSE connection ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!sessionId || !authenticated) return;

    let es: EventSource | null = null;
    let retryCount = 0;

    async function connect() {
      const token = await getAccessToken().catch(() => null);
      if (!token || !sessionInfo?.machineId) return;

      const url = `/api/machines/${sessionInfo.machineId}/events?sessionId=${sessionId}&token=${encodeURIComponent(token)}`;
      es = new EventSource(url);

      es.addEventListener('connected', (e) => {
        const d = JSON.parse((e as MessageEvent).data);
        setCredits(d.creditsRemaining);
        retryCount = 0;
      });

      es.addEventListener('credit_update', (e) => {
        const d = JSON.parse((e as MessageEvent).data);
        setCredits(d.creditsRemaining);
      });

      es.addEventListener('prize_detected', (e) => {
        const d = JSON.parse((e as MessageEvent).data) as {
          prizeWonAt?: string;
          winId?: string;
        };
        setWon(true);
        setWonAt(d.prizeWonAt ?? new Date().toISOString());
        if (d.winId) setWinId(d.winId);
      });

      es.addEventListener('session_end', (e) => {
        const d = JSON.parse((e as MessageEvent).data);
        setEnded(d.reason ?? 'manual');
        es?.close();
      });

      es.onerror = () => {
        es?.close();
        if (retryCount < 5) {
          retryCount++;
          setTimeout(connect, Math.min(1000 * retryCount, 10_000));
        } else {
          setError('Lost connection to the machine. Please refresh.');
        }
      };
    }

    connect();
    return () => es?.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, authenticated, sessionInfo?.machineId]);

  // ── Load session metadata ───────────────────────────────────────────────────
  useEffect(() => {
    if (!sessionId || !authenticated) return;
    (async () => {
      try {
        const token = await getAccessToken();
        const res = await fetch(`/api/play/session/${sessionId}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) {
          setError('Session not found or already ended.');
          return;
        }
        const data: SessionInfo = await res.json();
        setSessionInfo(data);
        setCredits(data.creditsRemaining);
      } catch {
        setError('Failed to load session.');
      }
    })();
  }, [sessionId, authenticated, getAccessToken]);

  // ── HLS setup ───────────────────────────────────────────────────────────────
  const initHls = useCallback(async () => {
    if (!videoRef.current || !sessionInfo) return;
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    const streamUrl = `/api/machines/${sessionInfo.machineId}/stream?sessionId=${sessionId}`;

    const HlsModule = (await import('hls.js')).default;

    if (HlsModule.isSupported()) {
      const hls = new HlsModule({
        lowLatencyMode: true,
        maxLiveSyncPlaybackRate: 1.5,
        liveSyncDurationCount: 3,
        liveMaxLatencyDurationCount: 5,
        backBufferLength: 10,
      });
      hlsRef.current = hls;
      hls.loadSource(streamUrl);
      hls.attachMedia(videoRef.current);
      hls.on(HlsModule.Events.MANIFEST_PARSED, () => {
        videoRef.current?.play().catch(() => {});
      });
    } else if (videoRef.current.canPlayType('application/vnd.apple.mpegurl')) {
      videoRef.current.src = streamUrl;
      videoRef.current.addEventListener('loadedmetadata', () => {
        videoRef.current?.play().catch(() => {});
      });
    }
  }, [sessionInfo, sessionId]);

  useEffect(() => {
    if (sessionInfo) initHls();
    return () => {
      hlsRef.current?.destroy();
      hlsRef.current = null;
    };
  }, [sessionInfo, initHls]);

  // ── Send command ────────────────────────────────────────────────────────────
  const sendCommand = useCallback(
    async (direction: Direction) => {
      if (!sessionInfo) return;
      const token = await getAccessToken().catch(() => null);
      try {
        await fetch(`/api/machines/${sessionInfo.machineId}/command`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ sessionId, direction }),
        });
      } catch {
        // Non-fatal
      }
    },
    [sessionInfo, sessionId, getAccessToken],
  );

  // ── Loading / error states ──────────────────────────────────────────────────
  if (!ready || !authenticated) {
    return (
      <div
        style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      >
        <span style={{ color: '#6b7280' }}>Loading…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div
        style={{
          minHeight: '100dvh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          background: '#0f172a',
        }}
      >
        <div
          style={{
            background: '#1e293b',
            borderRadius: 16,
            padding: '32px 24px',
            maxWidth: 360,
            textAlign: 'center',
            color: '#f8fafc',
          }}
        >
          <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
          <p style={{ fontSize: 16, color: '#94a3b8' }}>{error}</p>
          <button
            onClick={() => router.back()}
            style={{
              marginTop: 20,
              background: '#3b82f6',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              padding: '10px 24px',
              fontSize: 14,
              cursor: 'pointer',
            }}
          >
            Go back
          </button>
        </div>
      </div>
    );
  }

  const controlsDisabled = ended !== null || credits <= 0;

  // Extract machine name from sessionInfo if present (extended by /api/play/session response)
  const machineName =
    (sessionInfo as (SessionInfo & { machineName?: string }) | null)?.machineName ?? null;

  return (
    <>
      <HowToPlayModal
        open={howToPlayOpen}
        onClose={() => setHowToPlayOpen(false)}
      />

      {won && (
        <WinCelebration
          winId={winId}
          machineName={machineName}
          wonAt={wonAt}
          onClose={() => setWon(false)}
          getAccessToken={getAccessToken}
        />
      )}

      {/* ── Recent wins ticker ─────────────────────────────────────── */}
      <RecentWinsTicker />

      <div
        style={{
          minHeight: '100dvh',
          background: '#0f172a',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          padding: '0 0 env(safe-area-inset-bottom)',
        }}
      >
        {/* ── Video ── */}
        <div
          style={{
            width: '100%',
            maxWidth: 640,
            aspectRatio: '16/9',
            background: '#111827',
            position: 'relative',
            flexShrink: 0,
          }}
        >
          <video
            ref={videoRef}
            muted
            playsInline
            autoPlay
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
          {!sessionInfo && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#94a3b8',
                fontSize: 14,
              }}
            >
              Connecting to camera…
            </div>
          )}
        </div>

        {/* ── Session info bar ── */}
        <div
          style={{
            width: '100%',
            maxWidth: 640,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '10px 16px',
            background: '#1e293b',
            borderBottom: '1px solid #334155',
            flexShrink: 0,
          }}
        >
          <CreditBadge credits={credits} />
          {sessionInfo && <TimerBadge expiresAt={sessionInfo.expiresAt} />}
          <button
            onClick={() => setHowToPlayOpen(true)}
            title="How to play"
            aria-label="How to play"
            style={{
              background: 'rgba(255,255,255,0.07)',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: 99,
              padding: '4px 12px',
              fontSize: 13,
              fontWeight: 600,
              color: '#94a3b8',
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            ? Help
          </button>
        </div>

        {/* ── Controls ── */}
        <div
          style={{
            flex: 1,
            width: '100%',
            maxWidth: 640,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '24px 16px',
            gap: 20,
          }}
        >
          {ended ? (
            <EndedBanner reason={ended} />
          ) : (
            <>
              <p
                style={{
                  color: '#94a3b8',
                  fontSize: 13,
                  textAlign: 'center',
                  margin: 0,
                }}
              >
                Use the D-pad to move the claw · Press{' '}
                <kbd
                  style={{
                    background: '#334155',
                    borderRadius: 4,
                    padding: '1px 5px',
                    fontSize: 12,
                    color: '#f1f5f9',
                  }}
                >
                  Space
                </kbd>{' '}
                or <strong style={{ color: '#f87171' }}>DROP</strong> to grab
              </p>
              <DPad onCommand={sendCommand} disabled={controlsDisabled} />
            </>
          )}
        </div>
      </div>
    </>
  );
}
