'use client';

import { useEffect, useState, FormEvent, useCallback } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { VoiceCardGrid, getPersistedVoice, type VoiceId } from './voice-card-grid';
import { MeditationUpsellModal } from './meditation-upsell-modal';

interface Source {
  text: string;
  speaker: string;
  source: string;
  score: number;
}

interface MeditationResult {
  script: string;
  duration: string;
  sources: Source[];
}

const SUGGESTED_TOPICS = [
  'The nature of consciousness',
  'Letting go of thoughts',
  'Finding peace with uncertainty',
  'The illusion of the self',
];

function MeditationSkeleton() {
  return (
    <div className="space-y-3 max-w-2xl mx-auto" aria-label="Generating meditation…">
      <div className="flex flex-col items-center gap-3 py-8">
        <div
          className="w-10 h-10 rounded-full flex items-center justify-center"
          style={{ background: '#e8e0d5' }}
        >
          <svg
            aria-hidden="true"
            className="w-5 h-5"
            style={{ color: '#7d8c6e', animation: 'breathe 3s ease-in-out infinite' }}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 3v2.25m6.364.386-1.591 1.591M21 12h-2.25m-.386 6.364-1.591-1.591M12 18.75V21m-4.773-4.227-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z"
            />
          </svg>
        </div>
        <p className="text-sm font-medium" style={{ color: '#5c5248' }}>
          Composing your meditation…
        </p>
        <p className="text-xs" style={{ color: '#9c9080' }}>
          Drawing from the archive, this takes a moment
        </p>
      </div>
      {[85, 70, 90, 65, 75].map((w, i) => (
        <div
          key={i}
          className="h-3 rounded-full"
          style={{
            width: `${w}%`,
            background: '#e0d8cc',
            animation: `shimmer 1.6s ease-in-out ${i * 0.15}s infinite`,
          }}
        />
      ))}
      <style>{`
        @keyframes shimmer { 0%, 100% { opacity: 0.35; } 50% { opacity: 0.8; } }
        @keyframes breathe { 0%, 100% { opacity: 0.5; transform: scale(1); } 50% { opacity: 1; transform: scale(1.1); } }
      `}</style>
    </div>
  );
}

/** Static sources used across the corpus. */
const CORPUS_SOURCES = [
  { name: 'SuttaCentral', url: 'https://suttacentral.net', count: '4,816', desc: 'Pali Canon, early Buddhist texts' },
  { name: 'Lotsawa House', url: 'https://www.lotsawahouse.org', count: '2,224', desc: 'Tibetan Buddhist texts' },
  { name: 'Access to Insight', url: 'https://www.accesstoinsight.org', count: '1,621', desc: 'Theravada texts, Pali Canon + commentary' },
  { name: 'PMC (PubMed Central)', url: 'https://www.ncbi.nlm.nih.gov/pmc/', count: '585', desc: 'peer-reviewed papers on mindfulness and contemplative science' },
  { name: 'Project Gutenberg', url: 'https://www.gutenberg.org', count: '127', desc: 'classic contemplative texts' },
  { name: 'dhammatalks.org', url: 'https://www.dhammatalks.org', count: '90', desc: 'books (Thanissaro Bhikkhu)' },
  { name: 'Wikisource', url: 'https://en.wikisource.org', count: '13', desc: 'public domain contemplative texts' },
  { name: 'Dharma Seed', url: 'https://www.dharmaseed.org', count: '7', desc: 'talks (with explicit permission)' },
  { name: 'Internet Archive', url: 'https://archive.org', count: '5', desc: 'pre-1928 public domain texts' },
];

function SourceList() {
  const [open, setOpen] = useState(false);

  return (
    <div className="mt-4">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="source-list-panel"
        className="flex items-center gap-1.5 text-xs font-medium transition-colors"
        style={{ color: '#7d8c6e' }}
      >
        <svg
          aria-hidden="true"
          className="w-3.5 h-3.5 transition-transform"
          style={{ transform: open ? 'rotate(90deg)' : 'rotate(0deg)' }}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        View sources
      </button>
      {open && (
        <div id="source-list-panel" className="mt-2 space-y-2">
          <p className="text-xs leading-relaxed mb-1" style={{ color: '#7d8c6e' }}>
            Meditations are drawn from 9,500+ documents across nine curated sources.
          </p>
          {CORPUS_SOURCES.map((src) => (
            <div
              key={src.name}
              className="rounded-lg p-3 text-xs"
              style={{ background: '#f0ece3', borderLeft: '2px solid #b8ccb0' }}
            >
              <p className="font-semibold mb-0.5" style={{ color: '#5a6b52' }}>
                <a href={src.url} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'underline', textUnderlineOffset: '2px' }}>
                  {src.name}
                </a>
              </p>
              <p style={{ color: '#9c9080' }}>
                {src.count} documents — {src.desc}
              </p>
            </div>
          ))}
          <p className="text-xs pt-1" style={{ color: '#b0a898' }}>
            Detailed transcript references coming soon.
          </p>
        </div>
      )}
    </div>
  );
}

interface QuotaState {
  quotaUsed: number;
  quotaLimit: number;
  isPro: boolean;
  resetsAt: string;
}

interface QuotaExceededError {
  code: 'QUOTA_EXCEEDED';
  upgradeRequired: true;
  quotaUsed: number;
  quotaLimit: number;
  resetsAt: string;
}

export function MeditateInterface() {
  const { getAccessToken, authenticated } = usePrivy();

  const MAX_TOPIC_CHARS = 300;
  const [topic, setTopic] = useState('');
  const [voiceStyle, setVoiceStyle] = useState<VoiceId>('calm');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<MeditationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [quota, setQuota] = useState<QuotaState | null>(null);
  const [upsell, setUpsell] = useState<QuotaExceededError | null>(null);

  // Hydrate persisted voice preference after mount (avoids SSR mismatch)
  useEffect(() => {
    setVoiceStyle(getPersistedVoice('calm'));
  }, []);

  // Fetch quota when authenticated
  const refreshQuota = useCallback(async () => {
    try {
      const token = await getAccessToken();
      if (!token) return;
      const res = await fetch('/api/meditations/quota', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json() as QuotaState;
        setQuota(data);
      }
    } catch {
      // Non-fatal — quota badge is informational
    }
  }, [getAccessToken]);

  useEffect(() => {
    if (authenticated) refreshQuota();
  }, [authenticated, refreshQuota]);

  async function generate(topicValue: string) {
    const t = topicValue.trim();
    if (!t || loading) return;

    setLoading(true);
    setResult(null);
    setError(null);
    setTopic(t);

    try {
      let authHeaders: Record<string, string> = {};
      try {
        const token = await getAccessToken();
        if (token) authHeaders = { Authorization: `Bearer ${token}` };
      } catch {
        // Proceed without auth; will use anon rate limit
      }

      const res = await fetch('/api/meditate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ topic: t, voice_style: voiceStyle }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null) as { error?: Record<string, unknown> } | null;

        // Quota exceeded — show upsell modal
        if (res.status === 402 && data?.error?.code === 'QUOTA_EXCEEDED') {
          setUpsell(data.error as QuotaExceededError);
          return;
        }

        const msg = (data?.error?.message as string) ?? 'Something went wrong — please try again.';
        setError(msg);
        return;
      }

      const data: MeditationResult = await res.json();
      setResult(data);
      // Refresh quota badge after a successful generation
      refreshQuota();
    } catch {
      setError('Network error — please check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    generate(topic);
  }

  function handleReset() {
    setResult(null);
    setError(null);
    setTopic('');
  }

  const hasResult = result !== null;

  // Quota badge: show for authenticated free users only
  const showQuotaBadge = quota && !quota.isPro;
  const quotaRemaining = showQuotaBadge ? Math.max(0, quota.quotaLimit - quota.quotaUsed) : null;

  return (
    <>
    {upsell && (
      <MeditationUpsellModal
        quotaUsed={upsell.quotaUsed}
        quotaLimit={upsell.quotaLimit}
        resetsAt={upsell.resetsAt}
        onClose={() => setUpsell(null)}
        onSuccess={() => { setUpsell(null); refreshQuota(); }}
      />
    )}
    <div className="flex flex-col h-full" style={{ background: '#faf8f3' }}>
      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="max-w-2xl mx-auto">
          {/* Empty state / topic picker */}
          {!hasResult && !loading && (
            <div className="flex flex-col items-center text-center pt-8 pb-6">
              <div
                className="w-14 h-14 rounded-full flex items-center justify-center mb-4"
                style={{ background: '#e8e0d5' }}
              >
                <svg
                  aria-hidden="true"
                  className="w-7 h-7"
                  style={{ color: '#7d8c6e' }}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 3v2.25m6.364.386-1.591 1.591M21 12h-2.25m-.386 6.364-1.591-1.591M12 18.75V21m-4.773-4.227-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z"
                  />
                </svg>
              </div>
              <p className="font-medium text-sm mb-1" style={{ color: '#5c5248' }}>
                Generate a guided meditation
              </p>
              <p className="text-xs mb-3" style={{ color: '#9c9080' }}>
                Grounded in hundreds of hours of mindfulness teachings · 5-10 minutes
              </p>

              {/* Quota badge for free users */}
              {showQuotaBadge && (
                <div
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs mb-4"
                  style={{
                    background: quotaRemaining === 0 ? '#fff4f2' : '#f0ece3',
                    border: `1px solid ${quotaRemaining === 0 ? '#f5c6c0' : '#e0d8cc'}`,
                    color: quotaRemaining === 0 ? '#c0392b' : '#7d8c6e',
                  }}
                >
                  <svg aria-hidden="true" className="w-3 h-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                  </svg>
                  {quotaRemaining === 0
                    ? `Free limit reached — ${quota!.quotaUsed} of ${quota!.quotaLimit} used`
                    : `${quota!.quotaUsed} of ${quota!.quotaLimit} free meditations used this month`}
                </div>
              )}

              {error && (
                <div
                  className="w-full rounded-xl px-4 py-3 mb-5 text-sm text-left"
                  style={{ background: '#fff4f2', border: '1px solid #f5c6c0', color: '#c0392b' }}
                >
                  {error}
                </div>
              )}

              <div className="flex flex-wrap justify-center gap-2 max-w-md">
                {SUGGESTED_TOPICS.map((t) => (
                  <button
                    key={t}
                    onClick={() => { setTopic(t); generate(t); }}
                    className="rounded-full px-3 py-1.5 text-xs transition-colors"
                    style={{
                      background: '#f0ece3',
                      color: '#5c5248',
                      border: '1px solid #ddd5c8',
                    }}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Loading */}
          {loading && <MeditationSkeleton />}

          {/* Result */}
          {hasResult && result && (
            <div>
              <div className="flex items-center justify-between gap-3 mb-4">
                <div className="min-w-0">
                  <p className="font-semibold text-sm" style={{ color: '#3d4f38' }}>
                    {result.duration} guided meditation
                  </p>
                  <p className="text-xs mt-0.5 truncate" style={{ color: '#9c9080' }}>
                    Topic: {topic}
                  </p>
                </div>
                <button
                  onClick={handleReset}
                  className="flex-shrink-0 text-xs px-3 py-1.5 rounded-full border transition-colors"
                  style={{ borderColor: '#e0d8cc', color: '#7d8c6e' }}
                >
                  New meditation
                </button>
              </div>

              <div
                className="rounded-2xl px-4 sm:px-6 py-5"
                style={{ background: '#f0ece3' }}
              >
                <div
                  className="text-sm leading-loose whitespace-pre-wrap"
                  style={{ color: '#2c2c2c', fontFamily: 'var(--font-geist-sans)' }}
                >
                  {result.script}
                </div>
              </div>

              <SourceList />
            </div>
          )}
        </div>
      </div>

      {/* Input bar — hidden when showing a result */}
      {!hasResult && (
        <div
          className="border-t px-4 pt-4 pb-4"
          style={{ borderColor: '#e0d8cc', background: '#faf8f3' }}
        >
          <form onSubmit={handleSubmit} className="max-w-2xl mx-auto space-y-3">
            <VoiceCardGrid value={voiceStyle} onChange={setVoiceStyle} />
            <div
              className="flex items-center gap-2 rounded-2xl px-4 py-3"
              style={{
                background: '#fff',
                border: '1px solid #e0d8cc',
                boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
              }}
            >
              <input
                type="text"
                value={topic}
                onChange={(e) => setTopic(e.target.value.slice(0, MAX_TOPIC_CHARS))}
                placeholder="Enter a topic or theme…"
                disabled={loading}
                maxLength={MAX_TOPIC_CHARS}
                className="flex-1 bg-transparent text-sm leading-relaxed outline-none placeholder-zinc-400 disabled:opacity-50"
                style={{ color: '#2c2c2c' }}
              />
              <button
                type="submit"
                disabled={!topic.trim() || loading}
                aria-label="Generate meditation"
                className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center transition-opacity disabled:opacity-30"
                style={{ background: '#7d8c6e' }}
              >
                <svg
                  aria-hidden="true"
                  className="w-4 h-4 text-white"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 10.5 12 3m0 0 7.5 7.5M12 3v18" />
                </svg>
              </button>
            </div>
            {topic.length > 0 && (
              <div className="flex justify-end mt-1.5 px-1">
                <p
                  role="status"
                  aria-live="polite"
                  aria-atomic="true"
                  className="text-xs tabular-nums"
                  style={{ color: topic.length >= MAX_TOPIC_CHARS ? '#c0392b' : '#b0a898' }}
                >
                  {topic.length} / {MAX_TOPIC_CHARS}
                </p>
              </div>
            )}
          </form>
        </div>
      )}
    </div>
    </>
  );
}
