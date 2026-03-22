'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { track } from '@vercel/analytics';
import { useAuth } from '@/lib/use-auth';

export interface CancellationSurveyModalProps {
  subscriptionId: string | null;
  userId: string;
  onClose: () => void;
}

interface ReasonOption {
  value: string;
  label: string;
  apiReason: string;
  apiDetail?: string;
  hasTextInput?: boolean;
}

const REASONS: ReasonOption[] = [
  { value: 'price',           label: 'Too expensive',              apiReason: 'price' },
  { value: 'not_using',       label: 'Not using it enough',        apiReason: 'not_using' },
  { value: 'missing_feature', label: 'Missing a feature I need',   apiReason: 'missing_feature' },
  { value: 'switching',       label: 'Switching to something else', apiReason: 'switching' },
  { value: 'pausing',         label: 'Just pausing',               apiReason: 'other', apiDetail: 'pausing' },
  { value: 'other',           label: 'Other',                       apiReason: 'other', hasTextInput: true },
];

type LoadingAction = 'submit' | 'skip' | 'discount' | 'pause' | null;

export function CancellationSurveyModal({
  subscriptionId,
  userId,
  onClose,
}: CancellationSurveyModalProps) {
  const { getAccessToken } = useAuth();
  const [selectedReason, setSelectedReason] = useState<string | null>(null);
  const [otherText, setOtherText] = useState('');
  const [loading, setLoading] = useState<LoadingAction>(null);
  const [error, setError] = useState<string | null>(null);
  const [discountState, setDiscountState] = useState<
    'idle' | 'checking' | 'applied' | 'unavailable' | 'error'
  >('idle');
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    track('cancellation_survey_impression');
    closeButtonRef.current?.focus();
    const previouslyFocused = document.activeElement as HTMLElement | null;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previouslyFocused?.focus();
    };
  }, [onClose]);

  const handleFocusTrap = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== 'Tab') return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusable = dialog.querySelectorAll<HTMLElement>(
      'button, input, textarea, [tabindex]:not([tabindex="-1"])',
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey) {
      if (document.activeElement === first) { e.preventDefault(); last.focus(); }
    } else {
      if (document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }, []);

  async function authHeaders(): Promise<Record<string, string>> {
    const token = await getAccessToken();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return headers;
  }

  async function recordSurvey(reason: ReasonOption, detail?: string): Promise<boolean> {
    if (!subscriptionId) return true; // no subscription to record against — proceed anyway

    try {
      const res = await fetch('/api/subscriptions/cancel-survey', {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({
          userId,
          reason: reason.apiReason,
          reasonDetail: reason.apiDetail ?? detail ?? undefined,
          subscriptionId,
        }),
      });
      if (!res.ok) {
        console.warn('[cancellation-survey] survey record failed', res.status);
      }
    } catch {
      // Non-fatal — always proceed to cancellation
    }
    return true;
  }

  async function getPortalUrl(flow: 'cancel' | 'pause'): Promise<string | null> {
    try {
      const res = await fetch('/api/stripe/portal', {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({ flow }),
      });
      if (!res.ok) return null;
      const data = await res.json() as { url?: string };
      return data.url ?? null;
    } catch {
      return null;
    }
  }

  async function handleSubmit() {
    const reason = REASONS.find((r) => r.value === selectedReason);
    if (!reason) {
      setError('Please select a reason before submitting.');
      return;
    }
    const detail = reason.hasTextInput ? otherText.trim() || undefined : undefined;

    setLoading('submit');
    setError(null);
    track('cancellation_survey_submit', { reason: reason.value });

    await recordSurvey(reason, detail);

    const url = await getPortalUrl('cancel');
    if (url) {
      window.location.href = url;
    } else {
      setError('Could not open cancellation portal — try refreshing or contact support.');
      setLoading(null);
    }
  }

  async function handleSkip() {
    setLoading('skip');
    setError(null);
    track('cancellation_survey_skip');

    const url = await getPortalUrl('cancel');
    if (url) {
      window.location.href = url;
    } else {
      setError('Could not open cancellation portal — try refreshing or contact support.');
      setLoading(null);
    }
  }

  async function handleDiscount() {
    setDiscountState('checking');
    setLoading('discount');
    track('cancellation_survey_discount_click');

    try {
      const res = await fetch('/api/stripe/retention-discount', {
        method: 'POST',
        headers: await authHeaders(),
      });
      const data = await res.json() as {
        available?: boolean;
        applied?: boolean;
        message?: string;
        error?: string;
      };

      if (!data.available) {
        setDiscountState('unavailable');
      } else if (data.applied) {
        setDiscountState('applied');
        track('cancellation_survey_discount_applied');
      } else {
        setDiscountState('error');
      }
    } catch {
      setDiscountState('error');
    } finally {
      setLoading(null);
    }
  }

  async function handlePause() {
    setLoading('pause');
    setError(null);
    track('cancellation_survey_pause_click');

    const url = await getPortalUrl('pause');
    if (url) {
      window.location.href = url;
    } else {
      // Fall back to full portal if pause flow not available
      const fallback = await getPortalUrl('cancel');
      if (fallback) {
        window.location.href = fallback;
      } else {
        setError('Could not open portal — try refreshing or contact support.');
        setLoading(null);
      }
    }
  }

  const isLoading = loading !== null;
  const selectedReasonObj = REASONS.find((r) => r.value === selectedReason);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="cancel-survey-title"
        onKeyDown={handleFocusTrap}
        className="w-full max-w-md rounded-2xl flex flex-col"
        style={{ background: 'var(--bg)', boxShadow: '0 24px 64px rgba(0,0,0,0.18)' }}
      >
        {/* Header */}
        <div className="flex items-start justify-between px-5 pt-5 pb-4">
          <div>
            <h2
              id="cancel-survey-title"
              className="text-base font-semibold leading-snug"
              style={{ color: 'var(--sage-dark)' }}
            >
              Before you go…
            </h2>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
              Help us improve — takes 10 seconds.
            </p>
          </div>
          <button
            ref={closeButtonRef}
            onClick={onClose}
            className="p-1.5 rounded-lg -mt-0.5 -mr-0.5 flex-shrink-0"
            style={{ color: 'var(--text-muted)' }}
            aria-label="Dismiss"
          >
            <svg aria-hidden="true" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Survey question */}
        <div className="px-5 pb-2">
          <p className="text-sm font-medium mb-3" style={{ color: 'var(--text)' }}>
            Why are you cancelling?
          </p>
          <div className="space-y-2" role="radiogroup" aria-labelledby="cancel-survey-title">
            {REASONS.map((r) => (
              <label
                key={r.value}
                className="flex items-start gap-2.5 cursor-pointer select-none"
              >
                <input
                  type="radio"
                  name="cancel-reason"
                  value={r.value}
                  checked={selectedReason === r.value}
                  onChange={() => setSelectedReason(r.value)}
                  className="mt-0.5 flex-shrink-0 accent-[var(--sage)]"
                  style={{ accentColor: 'var(--sage)' }}
                />
                <span className="text-sm" style={{ color: 'var(--text)' }}>
                  {r.label}
                </span>
              </label>
            ))}
          </div>

          {/* "Other" text input */}
          {selectedReasonObj?.hasTextInput && (
            <textarea
              className="mt-2 w-full rounded-lg px-3 py-2 text-sm resize-none"
              style={{
                background: 'var(--bg-surface)',
                border: '1px solid var(--border)',
                color: 'var(--text)',
                outline: 'none',
              }}
              rows={2}
              placeholder="Tell us more (optional)"
              value={otherText}
              onChange={(e) => setOtherText(e.target.value)}
              maxLength={500}
              aria-label="Additional feedback"
            />
          )}
        </div>

        {/* Retention options */}
        <div
          className="mx-5 my-3 rounded-xl px-4 py-3 space-y-2"
          style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}
        >
          {/* Discount offer */}
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-medium" style={{ color: 'var(--text)' }}>
                💰 Would a discount help?
              </p>
              {discountState === 'applied' && (
                <p className="text-xs mt-0.5" style={{ color: '#15803d' }}>
                  Discount applied! Your next bill will reflect the new price.
                </p>
              )}
              {discountState === 'unavailable' && (
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                  No discount available right now.
                </p>
              )}
              {discountState === 'error' && (
                <p className="text-xs mt-0.5" style={{ color: 'var(--error-text)' }}>
                  Something went wrong — contact support.
                </p>
              )}
            </div>
            {discountState === 'idle' || discountState === 'checking' ? (
              <button
                onClick={handleDiscount}
                disabled={isLoading || discountState === 'checking'}
                className="flex-shrink-0 text-xs px-3 py-1.5 rounded-lg font-medium transition-opacity"
                style={{
                  background: '#7c3aed',
                  color: '#fff',
                  opacity: loading === 'discount' ? 0.7 : 1,
                }}
              >
                {loading === 'discount' ? 'Checking…' : 'Try it'}
              </button>
            ) : discountState === 'applied' ? (
              <span
                className="flex-shrink-0 text-xs px-2 py-1 rounded font-medium"
                style={{ background: '#dcfce7', color: '#15803d' }}
              >
                Applied ✓
              </span>
            ) : null}
          </div>

          {/* Divider */}
          <div style={{ borderTop: '1px solid var(--border)' }} />

          {/* Pause option */}
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-medium" style={{ color: 'var(--text)' }}>
                ⏸ Want to pause instead?
              </p>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                Keep your account, pick up where you left off.
              </p>
            </div>
            <button
              onClick={handlePause}
              disabled={isLoading}
              className="flex-shrink-0 text-xs px-3 py-1.5 rounded-lg font-medium transition-opacity"
              style={{
                background: 'var(--bg-chip)',
                color: 'var(--text)',
                border: '1px solid var(--border)',
                opacity: loading === 'pause' ? 0.7 : 1,
              }}
            >
              {loading === 'pause' ? 'Opening…' : 'Pause'}
            </button>
          </div>
        </div>

        {/* Error */}
        {error && (
          <p
            className="mx-5 mb-3 text-xs px-3 py-2 rounded-lg"
            style={{ background: 'var(--error-bg)', color: 'var(--error-text)', border: '1px solid var(--error-border)' }}
          >
            {error}
          </p>
        )}

        {/* CTAs */}
        <div className="px-5 pb-5 flex items-center gap-2">
          <button
            onClick={handleSkip}
            disabled={isLoading}
            className="py-2.5 px-4 rounded-xl text-sm transition-opacity"
            style={{
              background: 'var(--bg-surface)',
              color: 'var(--text-muted)',
              border: '1px solid var(--border)',
              opacity: isLoading ? 0.7 : 1,
            }}
          >
            {loading === 'skip' ? 'Opening…' : 'Skip'}
          </button>
          <button
            onClick={handleSubmit}
            disabled={isLoading || !selectedReason}
            className="flex-1 py-2.5 rounded-xl text-sm font-medium transition-opacity"
            style={{
              background: selectedReason ? '#dc2626' : 'var(--bg-chip)',
              color: selectedReason ? '#fff' : 'var(--text-muted)',
              opacity: isLoading ? 0.7 : 1,
            }}
          >
            {loading === 'submit' ? 'Opening…' : 'Cancel my subscription'}
          </button>
        </div>
      </div>
    </div>
  );
}
