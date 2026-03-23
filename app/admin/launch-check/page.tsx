'use client';

/**
 * /admin/launch-check
 *
 * Automated go/no-go readiness dashboard. Fetches GET /api/admin/launch-check
 * and renders per-check green/amber/red status cards with an overall readiness
 * banner and a one-click re-run button.
 *
 * Auth: Privy wallet — passes ADMIN_WALLET as the bearer token.
 */

import { useCallback, useEffect, useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { useRouter } from 'next/navigation';

// ── Types ──────────────────────────────────────────────────────────────────────

type CheckStatus = 'pass' | 'warn' | 'fail';
type Overall = 'pass' | 'warn' | 'fail';

interface Check {
  name: string;
  label: string;
  status: CheckStatus;
  detail?: string;
}

interface LaunchCheckResponse {
  overall: Overall;
  checks: Check[];
  checkedAt: string;
}

// ── Status helpers ─────────────────────────────────────────────────────────────

const COLORS: Record<CheckStatus, { bg: string; border: string; labelColor: string }> = {
  pass: { bg: '#f0f7ee', border: '#c6dfc0', labelColor: '#3d4f38' },
  warn: { bg: '#fef9ec', border: '#f0d98a', labelColor: '#6b4c00' },
  fail: { bg: '#fdf0f0', border: '#f5c6c6', labelColor: '#8b2020' },
};

const OVERALL_BANNER: Record<
  Overall,
  { bg: string; border: string; text: string; tagBg: string; tagColor: string; tagBorder: string }
> = {
  pass: {
    bg: '#f0f7ee',
    border: '#7d8c6e',
    text: 'All checks passed — system is ready to launch.',
    tagBg: '#c6dfc0',
    tagColor: '#3d4f38',
    tagBorder: '#7d8c6e',
  },
  warn: {
    bg: '#fef9ec',
    border: '#c9960a',
    text: 'Some warnings detected. Review amber items before going live.',
    tagBg: '#fef3cd',
    tagColor: '#6b4c00',
    tagBorder: '#c9960a',
  },
  fail: {
    bg: '#fdf0f0',
    border: '#c97070',
    text: 'Critical issues found. Resolve all red items before launch.',
    tagBg: '#fde8e8',
    tagColor: '#8b2020',
    tagBorder: '#c97070',
  },
};

// ── Sub-components ─────────────────────────────────────────────────────────────

function StatusIcon({ status, size = 16 }: { status: CheckStatus | 'loading'; size?: number }) {
  const s = size;
  if (status === 'loading') {
    return (
      <span
        style={{
          display: 'inline-block',
          width: s,
          height: s,
          borderRadius: '50%',
          border: '2px solid #b0a898',
          borderTopColor: 'transparent',
          flexShrink: 0,
          animation: 'spin 0.8s linear infinite',
        }}
      />
    );
  }
  if (status === 'pass') {
    return (
      <svg width={s} height={s} viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
        <circle cx="8" cy="8" r="7.5" fill="#c6dfc0" stroke="#7d8c6e" strokeWidth="1" />
        <path d="M4.5 8.5l2.5 2.5 4.5-5" stroke="#3d4f38" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (status === 'warn') {
    return (
      <svg width={s} height={s} viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
        <path d="M8 1.5L14.5 14H1.5L8 1.5z" fill="#fef3cd" stroke="#c9960a" strokeWidth="1" strokeLinejoin="round" />
        <path d="M8 6v3.5" stroke="#a07020" strokeWidth="1.5" strokeLinecap="round" />
        <circle cx="8" cy="11.5" r="0.75" fill="#a07020" />
      </svg>
    );
  }
  // fail
  return (
    <svg width={s} height={s} viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
      <circle cx="8" cy="8" r="7.5" fill="#fde8e8" stroke="#c97070" strokeWidth="1" />
      <path d="M5.5 5.5l5 5M10.5 5.5l-5 5" stroke="#b44" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function CheckCard({ check }: { check: Check }) {
  const colors = COLORS[check.status];
  return (
    <div
      style={{
        background: colors.bg,
        border: `1px solid ${colors.border}`,
        borderRadius: 10,
        padding: '12px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <StatusIcon status={check.status} />
        <span style={{ fontSize: 14, fontWeight: 500, color: colors.labelColor }}>
          {check.label}
        </span>
      </div>
      {check.detail && (
        <p style={{ fontSize: 12, color: check.status === 'fail' ? '#b44' : '#9c9080', margin: 0, paddingLeft: 26 }}>
          {check.detail}
        </p>
      )}
    </div>
  );
}

function CheckCardSkeleton() {
  return (
    <div
      style={{
        background: '#f5f1e8',
        border: '1px solid #e0d8cc',
        borderRadius: 10,
        padding: '12px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        height: 46,
      }}
    >
      <StatusIcon status="loading" />
      <div style={{ height: 14, width: 200, background: '#e8e0d4', borderRadius: 4 }} />
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function LaunchCheckPage() {
  const { ready, authenticated, user } = usePrivy();
  const router = useRouter();
  const walletAddress = user?.wallet?.address ?? null;

  const [result, setResult] = useState<LaunchCheckResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (wallet: string) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch('/api/admin/launch-check', {
          headers: { Authorization: `Bearer ${wallet}` },
          cache: 'no-store',
        });
        if (res.status === 401) {
          setError('Access denied — admin credentials required.');
          return;
        }
        if (!res.ok) {
          setError(`Check failed (HTTP ${res.status}).`);
          return;
        }
        setResult(await res.json());
      } catch {
        setError('Network error — could not reach launch-check endpoint.');
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (ready && !authenticated) router.replace('/');
  }, [ready, authenticated, router]);

  useEffect(() => {
    if (walletAddress) run(walletAddress);
  }, [walletAddress, run]);

  const overall = result?.overall;
  const banner = overall ? OVERALL_BANNER[overall] : null;

  if (!ready || !authenticated) {
    return (
      <div style={{ display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'center', background: '#faf8f3' }}>
        <p style={{ fontSize: 14, color: '#9c9080' }}>Loading…</p>
      </div>
    );
  }

  const passCount = result?.checks.filter((c) => c.status === 'pass').length ?? 0;
  const warnCount = result?.checks.filter((c) => c.status === 'warn').length ?? 0;
  const failCount = result?.checks.filter((c) => c.status === 'fail').length ?? 0;

  return (
    <>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100%', background: '#faf8f3' }}>
        {/* Header */}
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 20px',
            borderBottom: '1px solid #e0d8cc',
            background: '#faf8f3',
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <a
              href="/admin"
              style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#7d8c6e', textDecoration: 'none' }}
            >
              <svg width={14} height={14} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
              </svg>
              Admin
            </a>
            <span style={{ fontSize: 14, fontWeight: 600, color: '#3d4f38' }}>
              Launch Readiness
            </span>
            {overall && (
              <span
                style={{
                  fontSize: 12,
                  padding: '2px 10px',
                  borderRadius: 999,
                  fontWeight: 600,
                  background: OVERALL_BANNER[overall].tagBg,
                  color: OVERALL_BANNER[overall].tagColor,
                  border: `1px solid ${OVERALL_BANNER[overall].tagBorder}`,
                }}
              >
                {overall === 'pass' ? 'Go' : overall === 'warn' ? 'Review' : 'No-Go'}
              </span>
            )}
          </div>
          <button
            onClick={() => walletAddress && run(walletAddress)}
            disabled={loading}
            style={{
              fontSize: 12,
              padding: '6px 14px',
              borderRadius: 999,
              border: '1px solid #e0d8cc',
              color: '#7d8c6e',
              background: 'transparent',
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.5 : 1,
            }}
          >
            {loading ? 'Checking…' : 'Re-run checks'}
          </button>
        </header>

        <main style={{ flex: 1, padding: '32px 20px', maxWidth: 680, margin: '0 auto', width: '100%' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
            {/* Overall banner */}
            {banner && result && (
              <div
                style={{
                  background: banner.bg,
                  border: `1px solid ${banner.border}`,
                  borderRadius: 12,
                  padding: '16px 20px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 16,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <StatusIcon status={overall!} size={20} />
                  <span style={{ fontSize: 14, fontWeight: 500, color: banner.tagColor }}>
                    {banner.text}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                  {passCount > 0 && (
                    <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 999, background: '#c6dfc0', color: '#3d4f38', fontWeight: 600 }}>
                      {passCount} pass
                    </span>
                  )}
                  {warnCount > 0 && (
                    <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 999, background: '#fef3cd', color: '#6b4c00', fontWeight: 600 }}>
                      {warnCount} warn
                    </span>
                  )}
                  {failCount > 0 && (
                    <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 999, background: '#fde8e8', color: '#8b2020', fontWeight: 600 }}>
                      {failCount} fail
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Error state */}
            {error && (
              <div
                style={{
                  background: '#fdf0f0',
                  border: '1px solid #f5c6c6',
                  borderRadius: 12,
                  padding: '16px 20px',
                }}
              >
                <p style={{ fontSize: 14, color: '#b44', margin: 0 }}>{error}</p>
              </div>
            )}

            {/* Check cards */}
            <section>
              <h2
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  color: '#7d8c6e',
                  marginBottom: 12,
                  marginTop: 0,
                }}
              >
                Health Checks
              </h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {loading && !result
                  ? Array.from({ length: 8 }).map((_, i) => <CheckCardSkeleton key={i} />)
                  : (result?.checks ?? []).map((check) => (
                      <CheckCard key={check.name} check={check} />
                    ))}
              </div>
            </section>

            {/* Footer timestamp */}
            {result?.checkedAt && (
              <p style={{ fontSize: 12, color: '#b0a898', textAlign: 'center', margin: 0 }}>
                Last checked:{' '}
                {new Date(result.checkedAt).toLocaleString(undefined, {
                  dateStyle: 'medium',
                  timeStyle: 'medium',
                })}
              </p>
            )}
          </div>
        </main>

        <footer
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '10px 20px',
            borderTop: '1px solid #e0d8cc',
            background: '#faf8f3',
          }}
        >
          <span style={{ fontSize: 12, color: '#b0a898' }}>
            Convergence · Launch Readiness · Go/No-Go
          </span>
        </footer>
      </div>
    </>
  );
}
