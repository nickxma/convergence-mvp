'use client';

/**
 * PYUSDCheckoutModal
 *
 * Displays a PYUSD crypto payment checkout UI.
 *
 * Flow:
 *  1. Mounts → calls the appropriate API to create a session:
 *     - mode 'subscription': POST /api/payments/checkout  (tier: "pro" | "team")
 *     - mode 'credits':      POST /api/credits/purchase   (packageId: string)
 *  2. Shows QR code + payment address + PYUSD amount + countdown timer.
 *  3. Polls GET /api/payments/sessions/:id every 5 s.
 *     - "paid"    → success animation → onSuccess() → modal closes.
 *     - "expired" → expired state with retry CTA.
 *  4. MetaMask mobile deep-link (EIP-681 URI) rendered as a button when on mobile.
 *
 * Props:
 *   mode        — "subscription" (default) | "credits"
 *   tier        — "pro" | "team"  (subscription mode, default "pro")
 *   packageId   — credit package id (credits mode only, e.g. "pack_10")
 *   creditLabel — display label for the package (credits mode, e.g. "10 Play Credits")
 *   onClose     — called when user dismisses or on successful payment
 *   onSuccess   — called after confirmed payment (e.g. refresh state)
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import QRCode from 'qrcode';
import { track } from '@vercel/analytics';
import { useAuth } from '@/lib/use-auth';

// ── Constants ──────────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 5_000;
// PYUSD ERC-20 on Ethereum mainnet
const PYUSD_CONTRACT = '0x6c3ea9036406852006290770BEdFcAbA0e23A0e8';

// ── Types ──────────────────────────────────────────────────────────────────────

type ModalPhase = 'loading' | 'pending' | 'paid' | 'expired' | 'error';

interface Session {
  sessionId: string;
  paymentAddress: string;
  amountPYUSD: string;
  expiresAt: string;
  tier: string;
}

export interface PYUSDCheckoutModalProps {
  mode?: 'subscription' | 'credits';
  tier?: 'pro' | 'team';
  packageId?: string;
  creditLabel?: string;
  onClose: () => void;
  onSuccess?: () => void;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/** EIP-681 URI for the QR code + MetaMask link. */
function buildEIP681(paymentAddress: string, amountPYUSD: string): string {
  // PYUSD has 6 decimals
  const uint256 = Math.round(parseFloat(amountPYUSD) * 1_000_000).toString();
  return `ethereum:${PYUSD_CONTRACT}@1/transfer?address=${paymentAddress}&uint256=${uint256}`;
}

/** MetaMask mobile deep link (app.link variant works on iOS + Android). */
function buildMetaMaskLink(paymentAddress: string, amountPYUSD: string): string {
  const uint256 = Math.round(parseFloat(amountPYUSD) * 1_000_000).toString();
  return `https://metamask.app.link/send/${PYUSD_CONTRACT}@1/transfer?address=${paymentAddress}&uint256=${uint256}`;
}

function secondsUntil(isoString: string): number {
  return Math.max(0, Math.floor((new Date(isoString).getTime() - Date.now()) / 1000));
}

function formatCountdown(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// ── Component ──────────────────────────────────────────────────────────────────

export function PYUSDCheckoutModal({
  mode = 'subscription',
  tier = 'pro',
  packageId,
  creditLabel,
  onClose,
  onSuccess,
}: PYUSDCheckoutModalProps) {
  const { getAccessToken } = useAuth();
  const [phase, setPhase] = useState<ModalPhase>('loading');
  const [session, setSession] = useState<Session | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [countdown, setCountdown] = useState(0);
  const [copied, setCopied] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState(false);

  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Detect mobile on mount
  useEffect(() => {
    setIsMobile(/iPhone|iPad|iPod|Android/i.test(navigator.userAgent));
  }, []);

  // ── Session creation ──────────────────────────────────────────────────────────

  const createSession = useCallback(async () => {
    setPhase('loading');
    setErrorMsg(null);
    try {
      const token = await getAccessToken();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const isCredits = mode === 'credits';
      const endpoint = isCredits ? '/api/credits/purchase' : '/api/payments/checkout';
      const body = isCredits ? { packageId } : { tier };

      const res = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        setErrorMsg(body.error ?? 'Could not create payment session — try again.');
        setPhase('error');
        return;
      }

      const data = await res.json() as Session;
      setSession(data);
      setCountdown(secondsUntil(data.expiresAt));

      // Generate QR code from EIP-681 URI
      const eip681 = buildEIP681(data.paymentAddress, data.amountPYUSD);
      const dataUrl = await QRCode.toDataURL(eip681, {
        width: 200,
        margin: 2,
        errorCorrectionLevel: 'M',
        color: { dark: '#2c2c2c', light: '#faf8f3' },
      });
      setQrDataUrl(dataUrl);

      setPhase('pending');
      track('pyusd_checkout_opened', { mode, tier: mode === 'subscription' ? tier : undefined, packageId: mode === 'credits' ? packageId : undefined });
    } catch {
      setErrorMsg('Network error — check your connection and try again.');
      setPhase('error');
    }
  }, [getAccessToken, tier]);

  // Create session on mount
  useEffect(() => {
    createSession();
  }, [createSession]);

  // ── Polling ───────────────────────────────────────────────────────────────────

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null; }
  }, []);

  useEffect(() => {
    if (phase !== 'pending' || !session) return;

    // Countdown tick
    countdownRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          stopPolling();
          setPhase('expired');
          track('pyusd_checkout_expired', { mode });
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    // Status poll
    pollRef.current = setInterval(async () => {
      try {
        const token = await getAccessToken();
        const headers: Record<string, string> = {};
        if (token) headers['Authorization'] = `Bearer ${token}`;

        const res = await fetch(`/api/payments/sessions/${session.sessionId}`, { headers });
        if (!res.ok) return;

        const body = await res.json() as { status: string };
        if (body.status === 'paid') {
          stopPolling();
          setPhase('paid');
          track('pyusd_checkout_paid', { mode, tier: mode === 'subscription' ? tier : undefined });
          // Give the success animation 2.5 s, then close
          setTimeout(() => {
            onSuccess?.();
            onClose();
          }, 2500);
        } else if (body.status === 'expired') {
          stopPolling();
          setPhase('expired');
          track('pyusd_checkout_expired', { mode, tier: mode === 'subscription' ? tier : undefined });
        }
      } catch {
        // Swallow network hiccups; keep polling
      }
    }, POLL_INTERVAL_MS);

    return stopPolling;
  }, [phase, session, getAccessToken, tier, onSuccess, onClose, stopPolling]);

  // ── Keyboard / focus ──────────────────────────────────────────────────────────

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    closeButtonRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      prev?.focus();
    };
  }, [onClose]);

  const handleFocusTrap = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== 'Tab') return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusable = dialog.querySelectorAll<HTMLElement>(
      'button, a, [tabindex]:not([tabindex="-1"])',
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey) {
      if (document.activeElement === first) { e.preventDefault(); last.focus(); }
    } else {
      if (document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }, []);

  // ── Copy address ──────────────────────────────────────────────────────────────

  async function copyAddress() {
    if (!session) return;
    await navigator.clipboard.writeText(session.paymentAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    track('pyusd_address_copied');
  }

  // ── Countdown color ───────────────────────────────────────────────────────────

  const countdownColor =
    countdown > 120
      ? 'var(--sage)'
      : countdown > 60
        ? '#d97706'   // amber
        : '#c0392b';  // red

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.55)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="pyusd-modal-title"
        onKeyDown={handleFocusTrap}
        className="w-full max-w-sm rounded-2xl flex flex-col overflow-hidden"
        style={{ background: 'var(--bg)', boxShadow: '0 24px 64px rgba(0,0,0,0.2)' }}
      >
        {/* ── Header ──────────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <div className="flex items-center gap-2">
            {/* PYUSD logo mark */}
            <span
              className="text-[11px] font-bold px-2 py-0.5 rounded tracking-wide"
              style={{ background: '#0044ff', color: '#fff' }}
            >
              PYUSD
            </span>
            <h2
              id="pyusd-modal-title"
              className="text-sm font-semibold"
              style={{ color: 'var(--sage-dark)' }}
            >
              Pay with PYUSD
            </h2>
          </div>
          <button
            ref={closeButtonRef}
            onClick={onClose}
            className="p-1.5 rounded-lg"
            style={{ color: 'var(--text-muted)' }}
            aria-label="Close"
          >
            <svg aria-hidden="true" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* ── Loading ──────────────────────────────────────────────────────────── */}
        {phase === 'loading' && (
          <div className="flex flex-col items-center justify-center py-12 gap-3">
            <div
              className="w-8 h-8 rounded-full border-2 animate-spin"
              style={{ borderColor: 'var(--border)', borderTopColor: 'var(--sage)' }}
              aria-label="Loading…"
            />
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Creating payment session…</p>
          </div>
        )}

        {/* ── Error ────────────────────────────────────────────────────────────── */}
        {phase === 'error' && (
          <div className="px-5 pb-5 flex flex-col gap-3">
            <p
              className="text-xs px-3 py-2 rounded-lg"
              style={{ background: 'var(--error-bg)', color: 'var(--error-text)', border: '1px solid var(--error-border)' }}
            >
              {errorMsg}
            </p>
            <button
              onClick={createSession}
              className="w-full py-2.5 rounded-xl text-sm font-medium"
              style={{ background: 'var(--sage)', color: '#fff' }}
            >
              Try again
            </button>
          </div>
        )}

        {/* ── Pending (main payment view) ──────────────────────────────────────── */}
        {phase === 'pending' && session && (
          <>
            {/* Amount */}
            <div className="px-5 pb-3 text-center">
              <p className="text-3xl font-semibold tabular-nums" style={{ color: 'var(--sage-dark)' }}>
                {parseFloat(session.amountPYUSD).toFixed(2)}
                <span className="text-base font-normal ml-1.5" style={{ color: 'var(--text-muted)' }}>PYUSD</span>
              </p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                {mode === 'credits'
                  ? (creditLabel ?? 'Play Credits')
                  : tier === 'team'
                    ? 'Team plan — 30 days'
                    : 'Pro plan — 30 days'}
              </p>
            </div>

            {/* QR code */}
            <div className="flex justify-center px-5 pb-3">
              {qrDataUrl ? (
                <div
                  className="rounded-xl overflow-hidden"
                  style={{ border: '2px solid var(--border)', padding: 6 }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={qrDataUrl}
                    alt={`QR code — send ${session.amountPYUSD} PYUSD to ${session.paymentAddress}`}
                    width={180}
                    height={180}
                    style={{ display: 'block' }}
                  />
                </div>
              ) : (
                <div
                  className="w-[180px] h-[180px] rounded-xl"
                  style={{ background: 'var(--bg-surface)' }}
                />
              )}
            </div>

            {/* Payment address */}
            <div className="px-5 pb-3">
              <p className="text-[10px] font-medium mb-1" style={{ color: 'var(--text-muted)' }}>
                SEND TO
              </p>
              <div
                className="flex items-center gap-2 px-3 py-2 rounded-lg"
                style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}
              >
                <p
                  className="flex-1 text-[11px] font-mono truncate"
                  style={{ color: 'var(--text)' }}
                  title={session.paymentAddress}
                >
                  {session.paymentAddress}
                </p>
                <button
                  onClick={copyAddress}
                  className="flex-shrink-0 text-[10px] font-medium px-2 py-1 rounded-md transition-colors"
                  style={
                    copied
                      ? { background: 'var(--celebration-bg)', color: 'var(--celebration-text)' }
                      : { background: 'var(--bg-chip)', color: 'var(--sage-dark)' }
                  }
                  aria-label="Copy payment address"
                >
                  {copied ? 'Copied!' : 'Copy'}
                </button>
              </div>
              <p className="text-[10px] mt-1" style={{ color: 'var(--text-faint)' }}>
                Ethereum mainnet · ERC-20 PYUSD only
              </p>
            </div>

            {/* MetaMask deep link (mobile only) */}
            {isMobile && (
              <div className="px-5 pb-3">
                <a
                  href={buildMetaMaskLink(session.paymentAddress, session.amountPYUSD)}
                  className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl text-sm font-medium"
                  style={{
                    background: 'var(--bg-surface)',
                    color: 'var(--sage-dark)',
                    border: '1px solid var(--border)',
                    textDecoration: 'none',
                  }}
                  onClick={() => track('pyusd_metamask_deeplink_clicked')}
                >
                  {/* MetaMask fox-ish icon */}
                  <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 40 40" fill="none" aria-hidden="true">
                    <circle cx="20" cy="20" r="20" fill="#E8831D"/>
                    <text x="20" y="26" textAnchor="middle" fontSize="16" fill="white">🦊</text>
                  </svg>
                  Open in MetaMask
                </a>
              </div>
            )}

            {/* Countdown + status */}
            <div
              className="mx-5 mb-4 flex items-center justify-between px-3 py-2 rounded-lg"
              style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}
            >
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                Session expires in
              </span>
              <span
                className="text-sm font-semibold tabular-nums"
                style={{ color: countdownColor }}
                aria-live="polite"
                aria-label={`${formatCountdown(countdown)} remaining`}
              >
                {formatCountdown(countdown)}
              </span>
            </div>

            <p className="text-center text-[10px] pb-4" style={{ color: 'var(--text-faint)' }}>
              Waiting for payment · checking every 5 s
            </p>
          </>
        )}

        {/* ── Success ──────────────────────────────────────────────────────────── */}
        {phase === 'paid' && (
          <div className="flex flex-col items-center justify-center py-10 px-5 gap-3">
            <div
              className="w-14 h-14 rounded-full flex items-center justify-center"
              style={{ background: 'var(--celebration-bg)', border: '2px solid var(--celebration-border)' }}
              aria-hidden="true"
            >
              <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M4.5 12.75l6 6 9-13.5"
                  style={{ color: 'var(--celebration-text)' }}
                />
              </svg>
            </div>
            <div className="text-center">
              <p className="text-base font-semibold" style={{ color: 'var(--celebration-text)' }}>
                Payment confirmed!
              </p>
              <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                {mode === 'credits'
                  ? `${creditLabel ?? 'Credits'} added to your account.`
                  : `Your ${tier === 'team' ? 'Team' : 'Pro'} access is now active.`}
              </p>
            </div>
          </div>
        )}

        {/* ── Expired ──────────────────────────────────────────────────────────── */}
        {phase === 'expired' && (
          <div className="flex flex-col items-center px-5 pb-5 pt-2 gap-3">
            <div
              className="w-12 h-12 rounded-full flex items-center justify-center"
              style={{ background: 'var(--warn-bg)', border: '1px solid var(--warn-border)' }}
              aria-hidden="true"
            >
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" style={{ color: '#92400e' }}/>
              </svg>
            </div>
            <div className="text-center">
              <p className="text-sm font-semibold" style={{ color: 'var(--warn-text)' }}>
                Session expired
              </p>
              <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                The 30-minute window has passed. Start a new session to complete payment.
              </p>
            </div>
            <button
              onClick={createSession}
              className="w-full py-2.5 rounded-xl text-sm font-medium mt-1"
              style={{ background: 'var(--sage)', color: '#fff' }}
            >
              Start new session
            </button>
            <button
              onClick={onClose}
              className="w-full py-2 rounded-xl text-xs font-medium"
              style={{
                background: 'var(--bg-surface)',
                color: 'var(--text-muted)',
                border: '1px solid var(--border)',
              }}
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
