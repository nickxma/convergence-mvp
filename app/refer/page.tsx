'use client';

/**
 * /refer — OpenClaw referral page.
 *
 * Shows the authenticated user's unique referral link with:
 *   - Copy-to-clipboard button
 *   - Share to X (Twitter) and WhatsApp
 *   - Stats: signups pending conversion, converted, credits earned
 *   - Leaderboard of top referrers
 *
 * Unauthenticated users see a login prompt.
 *
 * If ?ref=CODE is present in the URL, ReferralCapture (in providers) will
 * already handle storing and registering it — this page does not need to.
 */

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/lib/use-auth';
import { usePrivy } from '@privy-io/react-auth';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ReferralStats {
  code: string;
  shareUrl: string;
  pending: number;
  converted: number;
  creditsEarned: number;
}

interface LeaderboardEntry {
  rank: number;
  userId: string;
  converted: number;
  pending: number;
  creditsEarned: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function hashHue(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) & 0xffffffff;
  }
  return Math.abs(h) % 360;
}

function Avatar({ userId }: { userId: string }) {
  const hue = hashHue(userId);
  const initials = userId.slice(-4).toUpperCase();
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 32,
        height: 32,
        borderRadius: '50%',
        background: `hsl(${hue} 45% 60%)`,
        color: '#fff',
        fontSize: 11,
        fontWeight: 600,
        flexShrink: 0,
        letterSpacing: '0.03em',
      }}
    >
      {initials}
    </span>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function ReferPage() {
  const { authenticated, getAccessToken } = useAuth();
  const { login } = usePrivy();

  const [stats, setStats] = useState<ReferralStats | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [loadingStats, setLoadingStats] = useState(false);
  const [copied, setCopied] = useState(false);

  // Load stats once authenticated
  useEffect(() => {
    if (!authenticated) return;
    let cancelled = false;

    async function load() {
      setLoadingStats(true);
      try {
        const token = await getAccessToken();
        const headers: Record<string, string> = {};
        if (token) headers['Authorization'] = `Bearer ${token}`;
        const res = await fetch('/api/users/me/referral', { headers });
        if (res.ok && !cancelled) {
          const data = await res.json() as ReferralStats;
          setStats(data);
        }
      } catch {
        // non-critical
      } finally {
        if (!cancelled) setLoadingStats(false);
      }
    }

    void load();
    return () => { cancelled = true; };
  }, [authenticated, getAccessToken]);

  // Load leaderboard (public — no auth)
  useEffect(() => {
    let cancelled = false;
    async function loadLeaderboard() {
      try {
        const res = await fetch('/api/referrals/leaderboard');
        if (res.ok && !cancelled) {
          const data = await res.json() as { items: LeaderboardEntry[] };
          setLeaderboard(data.items ?? []);
        }
      } catch {
        // non-critical
      }
    }
    void loadLeaderboard();
    return () => { cancelled = true; };
  }, []);

  const handleCopy = useCallback(() => {
    if (!stats?.shareUrl) return;
    navigator.clipboard.writeText(stats.shareUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {
      // Fallback for older browsers
      const el = document.createElement('textarea');
      el.value = stats.shareUrl;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [stats?.shareUrl]);

  const shareText = 'Play OpenClaw — control a real claw machine online and win prizes. Use my link to sign up:';

  const twitterUrl = stats
    ? `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText + ' ' + stats.shareUrl)}`
    : '#';

  const whatsappUrl = stats
    ? `https://wa.me/?text=${encodeURIComponent(shareText + ' ' + stats.shareUrl)}`
    : '#';

  // ── Styles ─────────────────────────────────────────────────────────────────

  const card: React.CSSProperties = {
    background: '#1e293b',
    border: '1px solid #334155',
    borderRadius: 16,
    padding: '28px 32px',
    width: '100%',
    maxWidth: 520,
  };

  const statBox: React.CSSProperties = {
    background: '#0f172a',
    borderRadius: 12,
    padding: '16px 20px',
    flex: 1,
    minWidth: 100,
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#0f172a',
        color: '#e2e8f0',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Nav */}
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '16px 24px',
          borderBottom: '1px solid #1e293b',
        }}
      >
        <a href="/" style={{ fontSize: 14, fontWeight: 600, color: '#7d8c6e', textDecoration: 'none' }}>
          Convergence
        </a>
        <a href="/openclaw" style={{ fontSize: 13, color: '#94a3b8', textDecoration: 'none' }}>
          ← Back to OpenClaw
        </a>
      </header>

      <main
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          padding: '48px 24px',
          gap: 32,
        }}
      >
        {/* Hero */}
        <div style={{ textAlign: 'center', maxWidth: 520 }}>
          <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0, color: '#f1f5f9' }}>
            Invite Friends, Earn Credits
          </h1>
          <p style={{ marginTop: 12, color: '#94a3b8', fontSize: 15, lineHeight: 1.6 }}>
            Share your link. When a friend signs up and plays their first session,
            you both win — you get <strong style={{ color: '#7d8c6e' }}>3 free credits</strong> automatically.
          </p>
        </div>

        {!authenticated ? (
          /* ── Login prompt ─────────────────────────────────────────────── */
          <div style={{ ...card, textAlign: 'center' }}>
            <p style={{ color: '#94a3b8', marginBottom: 20, fontSize: 14 }}>
              Sign in to get your personal referral link.
            </p>
            <button
              onClick={() => login()}
              style={{
                background: '#7d8c6e',
                color: '#fff',
                border: 'none',
                borderRadius: 10,
                padding: '12px 28px',
                fontSize: 14,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Sign in
            </button>
          </div>
        ) : loadingStats ? (
          <div style={{ ...card, textAlign: 'center', color: '#64748b', fontSize: 14 }}>
            Loading your referral link…
          </div>
        ) : stats ? (
          <>
            {/* ── Share card ───────────────────────────────────────────── */}
            <div style={card}>
              <p style={{ margin: '0 0 12px', fontSize: 13, color: '#94a3b8', fontWeight: 500 }}>
                Your referral link
              </p>

              {/* URL row */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  background: '#0f172a',
                  borderRadius: 10,
                  padding: '10px 14px',
                  border: '1px solid #334155',
                  marginBottom: 16,
                }}
              >
                <span
                  style={{
                    flex: 1,
                    fontSize: 13,
                    color: '#cbd5e1',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    fontFamily: 'monospace',
                  }}
                >
                  {stats.shareUrl}
                </span>
                <button
                  onClick={handleCopy}
                  style={{
                    background: copied ? '#22c55e22' : '#334155',
                    color: copied ? '#22c55e' : '#e2e8f0',
                    border: 'none',
                    borderRadius: 7,
                    padding: '6px 14px',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                    flexShrink: 0,
                    transition: 'all 0.15s',
                  }}
                >
                  {copied ? '✓ Copied' : 'Copy'}
                </button>
              </div>

              {/* Share buttons */}
              <div style={{ display: 'flex', gap: 10 }}>
                <a
                  href={twitterUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    flex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                    background: '#000',
                    color: '#fff',
                    borderRadius: 10,
                    padding: '10px',
                    fontSize: 13,
                    fontWeight: 600,
                    textDecoration: 'none',
                    border: '1px solid #334155',
                  }}
                >
                  {/* X logo */}
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.73-8.835L1.254 2.25H8.08l4.253 5.622L18.244 2.25zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77z" />
                  </svg>
                  Share on X
                </a>
                <a
                  href={whatsappUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    flex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                    background: '#25d366',
                    color: '#fff',
                    borderRadius: 10,
                    padding: '10px',
                    fontSize: 13,
                    fontWeight: 600,
                    textDecoration: 'none',
                  }}
                >
                  {/* WhatsApp logo */}
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                  </svg>
                  WhatsApp
                </a>
              </div>
            </div>

            {/* ── Stats ────────────────────────────────────────────────── */}
            <div style={{ display: 'flex', gap: 12, width: '100%', maxWidth: 520 }}>
              <div style={statBox}>
                <div style={{ fontSize: 24, fontWeight: 700, color: '#f1f5f9' }}>
                  {stats.pending}
                </div>
                <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>Signups pending</div>
              </div>
              <div style={statBox}>
                <div style={{ fontSize: 24, fontWeight: 700, color: '#22c55e' }}>
                  {stats.converted}
                </div>
                <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>Converted</div>
              </div>
              <div style={statBox}>
                <div style={{ fontSize: 24, fontWeight: 700, color: '#7d8c6e' }}>
                  {stats.creditsEarned}
                </div>
                <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>Credits earned</div>
              </div>
            </div>
          </>
        ) : null}

        {/* ── Leaderboard ───────────────────────────────────────────────── */}
        {leaderboard.length > 0 && (
          <div style={{ ...card, maxWidth: 520 }}>
            <h2 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 20px', color: '#e2e8f0' }}>
              Top Referrers
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {leaderboard.map((entry) => (
                <div
                  key={entry.userId}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '10px 14px',
                    background: stats?.code && entry.userId === stats.code ? '#1e293b' : '#0f172a',
                    borderRadius: 10,
                    border: '1px solid #1e293b',
                  }}
                >
                  <span
                    style={{
                      width: 24,
                      textAlign: 'center',
                      fontSize: 12,
                      fontWeight: 700,
                      color: entry.rank <= 3 ? '#f59e0b' : '#475569',
                      flexShrink: 0,
                    }}
                  >
                    {entry.rank <= 3 ? ['🥇', '🥈', '🥉'][entry.rank - 1] : `#${entry.rank}`}
                  </span>
                  <Avatar userId={entry.userId} />
                  <span style={{ flex: 1, fontSize: 13, color: '#cbd5e1', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {entry.userId.slice(0, 8)}…
                  </span>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#22c55e' }}>
                      {entry.converted} wins
                    </div>
                    <div style={{ fontSize: 11, color: '#64748b' }}>
                      {entry.creditsEarned} credits
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>

      <footer
        style={{
          padding: '20px 24px',
          borderTop: '1px solid #1e293b',
          textAlign: 'center',
          fontSize: 12,
          color: '#475569',
        }}
      >
        OpenClaw · Earn 3 free play credits per successful referral ·{' '}
        <a href="/privacy" style={{ color: '#64748b', textDecoration: 'underline' }}>
          Privacy
        </a>
      </footer>
    </div>
  );
}
