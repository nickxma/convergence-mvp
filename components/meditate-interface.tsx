'use client';

import { useState, FormEvent, useRef, useCallback, useEffect } from 'react';
import { usePrivy } from '@privy-io/react-auth';

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

// ── Script parsing ──────────────────────────────────────────────────────────

function parseBlocks(script: string): string[] {
  return script
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean);
}

// Short paragraphs (instructions like "Close your eyes...") get centered, dimmed style
function isTransition(text: string): boolean {
  return text.replace(/\.\.\./g, '').trim().split(/\s+/).length <= 12;
}

// ── Sub-components ──────────────────────────────────────────────────────────

function MeditationSkeleton() {
  return (
    <div className="space-y-3 max-w-2xl mx-auto" aria-label="Generating meditation…">
      <div className="flex flex-col items-center gap-3 py-8">
        <div
          className="w-10 h-10 rounded-full flex items-center justify-center"
          style={{ background: 'var(--bg-chip)' }}
        >
          <svg aria-hidden="true"
            className="w-5 h-5"
            style={{ color: 'var(--sage)', animation: 'breathe 3s ease-in-out infinite' }}
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
        <p className="text-sm font-medium" style={{ color: 'var(--text-warm)' }}>
          Composing your meditation…
        </p>
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          Drawing from the archive, this takes a moment
        </p>
      </div>
      {[85, 70, 90, 65, 75].map((w, i) => (
        <div
          key={i}
          className="h-3 rounded-full"
          style={{
            width: `${w}%`,
            background: 'var(--border)',
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

function SourceList({ sources }: { sources: Source[] }) {
  const [open, setOpen] = useState(false);
  if (sources.length === 0) return null;

  return (
    <div className="mt-4">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-xs font-medium transition-colors"
        style={{ color: 'var(--sage)' }}
      >
        <svg aria-hidden="true"
          className="w-3.5 h-3.5 transition-transform"
          style={{ transform: open ? 'rotate(90deg)' : 'rotate(0deg)' }}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        {sources.length} source{sources.length !== 1 ? 's' : ''}
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          {sources.map((s, i) => (
            <div
              key={i}
              className="rounded-lg p-3 text-xs"
              style={{ background: 'var(--source-bg)', borderLeft: '2px solid var(--source-border)' }}
            >
              {s.speaker && (
                <p className="font-semibold mb-1" style={{ color: 'var(--sage-mid)' }}>
                  {s.speaker}
                </p>
              )}
              <p className="leading-relaxed" style={{ color: 'var(--text-warm)' }}>
                {s.text}
              </p>
              {s.source && (
                <p className="mt-1 opacity-60 font-mono" style={{ color: 'var(--sage)' }}>
                  {s.source}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Pause marker rendered inline for each ... ──────────────────────────────

function PauseDots() {
  return (
    <span
      aria-label="pause"
      style={{
        display: 'inline-block',
        margin: '0 0.25em',
        color: 'var(--pause-color)',
        letterSpacing: '0.15em',
        fontSize: '0.75em',
        verticalAlign: 'middle',
        userSelect: 'none',
      }}
    >
      · · ·
    </span>
  );
}

// ── Section break between major paragraphs ─────────────────────────────────

function SectionBreak() {
  return (
    <div
      aria-hidden="true"
      style={{ display: 'flex', justifyContent: 'center', margin: '0.5rem 0 1.5rem' }}
    >
      <svg width="32" height="12" viewBox="0 0 32 12" fill="none">
        <circle cx="4" cy="6" r="2.5" fill="var(--sage-ring)" />
        <circle cx="16" cy="6" r="2.5" fill="var(--sage-ring-mid)" />
        <circle cx="28" cy="6" r="2.5" fill="var(--sage-ring)" />
      </svg>
    </div>
  );
}

// ── Render a single paragraph block ───────────────────────────────────────

function ScriptBlock({
  text,
  dimmed,
  hidden,
  last,
}: {
  text: string;
  dimmed?: boolean;
  hidden?: boolean;
  last?: boolean;
}) {
  const transition = isTransition(text);
  const parts = text.split(/(\.\.\.)/g);

  return (
    <div
      style={{
        opacity: hidden ? 0 : dimmed ? 0.35 : 1,
        transition: 'opacity 0.5s ease',
        marginBottom: transition ? '1rem' : '1.5rem',
        textAlign: transition ? 'center' : 'left',
        pointerEvents: hidden ? 'none' : 'auto',
      }}
    >
      <p
        style={{
          color: transition ? 'var(--sage-dim)' : 'var(--text)',
          fontSize: transition ? '0.875rem' : '1rem',
          lineHeight: transition ? '1.6' : '1.85',
          fontStyle: transition ? 'italic' : 'normal',
          margin: 0,
        }}
      >
        {parts.map((part, i) =>
          part === '...' ? <PauseDots key={i} /> : <span key={i}>{part}</span>,
        )}
      </p>
      {/* Section break after paragraphs that end with ... (breathing points) */}
      {text.endsWith('...') && !last && <SectionBreak />}
    </div>
  );
}

// ── Meditation script display with play mode ───────────────────────────────

function MeditationScript({
  script,
  onReset,
  topic,
  duration,
  sources,
}: {
  script: string;
  onReset: () => void;
  topic: string;
  duration: string;
  sources: Source[];
}) {
  const blocks = parseBlocks(script);
  const [playMode, setPlayMode] = useState(false);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [speaking, setSpeaking] = useState(false);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  const hasTTS = typeof window !== 'undefined' && 'speechSynthesis' in window;

  const stopSpeech = useCallback(() => {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    setSpeaking(false);
    utteranceRef.current = null;
  }, []);

  // Stop speech when leaving play mode or resetting
  useEffect(() => {
    if (!playMode) stopSpeech();
  }, [playMode, stopSpeech]);

  const speakBlock = useCallback(
    (text: string) => {
      if (!hasTTS) return;
      stopSpeech();
      // Strip the ... from TTS — replace with actual pauses via SSML-free approach
      const cleaned = text.replace(/\.\.\./g, ', ');
      const utter = new SpeechSynthesisUtterance(cleaned);
      utter.rate = 0.82;
      utter.pitch = 0.95;
      utter.onend = () => setSpeaking(false);
      utter.onerror = () => setSpeaking(false);
      utteranceRef.current = utter;
      setSpeaking(true);
      window.speechSynthesis.speak(utter);
    },
    [hasTTS, stopSpeech],
  );

  function handleNext() {
    if (currentIdx < blocks.length - 1) {
      setCurrentIdx((i) => i + 1);
      stopSpeech();
    }
  }

  function handlePrev() {
    if (currentIdx > 0) {
      setCurrentIdx((i) => i - 1);
      stopSpeech();
    }
  }

  function handlePlayToggle() {
    if (playMode) {
      stopSpeech();
      setPlayMode(false);
      setCurrentIdx(0);
    } else {
      setPlayMode(true);
      setCurrentIdx(0);
    }
  }

  function handleListen() {
    if (speaking) {
      stopSpeech();
    } else if (playMode) {
      speakBlock(blocks[currentIdx]);
    } else {
      speakBlock(blocks.join(' '));
    }
  }

  const isLastBlock = currentIdx === blocks.length - 1;

  return (
    <div>
      {/* Header row */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <p className="font-semibold text-sm" style={{ color: 'var(--sage-dark)' }}>
            {duration} guided meditation
          </p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
            Topic: {topic}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {hasTTS && (
            <button
              onClick={handleListen}
              title={speaking ? 'Stop' : 'Listen aloud'}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border transition-colors"
              style={{
                borderColor: speaking ? 'var(--sage)' : 'var(--border)',
                color: 'var(--sage)',
                background: speaking ? 'var(--sage-bg)' : 'transparent',
              }}
            >
              {speaking ? (
                <>
                  <svg aria-hidden="true" className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                    <rect x="6" y="4" width="4" height="16" rx="1" />
                    <rect x="14" y="4" width="4" height="16" rx="1" />
                  </svg>
                  Stop
                </>
              ) : (
                <>
                  <svg aria-hidden="true"
                    className="w-3 h-3"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M19.114 5.636a9 9 0 0 1 0 12.728M16.463 8.288a5.25 5.25 0 0 1 0 7.424M6.75 8.25l4.72-4.72a.75.75 0 0 1 1.28.53v15.88a.75.75 0 0 1-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.009 9.009 0 0 1 2.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75Z"
                    />
                  </svg>
                  Listen
                </>
              )}
            </button>
          )}
          <button
            onClick={handlePlayToggle}
            title={playMode ? 'Exit play mode' : 'Play mode — read one step at a time'}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border transition-colors"
            style={{
              borderColor: playMode ? 'var(--sage)' : 'var(--border)',
              color: 'var(--sage)',
              background: playMode ? 'var(--sage-bg)' : 'transparent',
            }}
          >
            {playMode ? (
              <>
                <svg aria-hidden="true" className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                  <rect x="6" y="4" width="4" height="16" rx="1" />
                  <rect x="14" y="4" width="4" height="16" rx="1" />
                </svg>
                Exit
              </>
            ) : (
              <>
                <svg aria-hidden="true" className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5.14v14l11-7-11-7z" />
                </svg>
                Play
              </>
            )}
          </button>
          <button
            onClick={onReset}
            className="text-xs px-3 py-1.5 rounded-full border transition-colors"
            style={{ borderColor: 'var(--border)', color: 'var(--sage)' }}
          >
            New
          </button>
        </div>
      </div>

      {/* Script */}
      <div
        className="rounded-2xl px-6 py-6"
        style={{ background: 'var(--bg-surface)' }}
      >
        {playMode ? (
          // ── Play mode: one block at a time ──────────────────────────────
          <div>
            <div style={{ minHeight: '6rem' }}>
              <ScriptBlock
                text={blocks[currentIdx]}
                last={isLastBlock}
              />
            </div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginTop: '1.5rem',
                paddingTop: '1rem',
                borderTop: '1px solid var(--border)',
              }}
            >
              <button
                onClick={handlePrev}
                disabled={currentIdx === 0}
                className="text-xs px-3 py-1.5 rounded-full border transition-colors disabled:opacity-30"
                style={{ borderColor: 'var(--border-muted)', color: 'var(--sage)' }}
              >
                ← Back
              </button>
              <span className="text-xs tabular-nums" style={{ color: 'var(--text-muted)' }}>
                {currentIdx + 1} / {blocks.length}
              </span>
              {isLastBlock ? (
                <button
                  onClick={handlePlayToggle}
                  className="text-xs px-3 py-1.5 rounded-full transition-colors"
                  style={{ background: 'var(--sage)', color: '#fff' }}
                >
                  Complete
                </button>
              ) : (
                <button
                  onClick={handleNext}
                  className="text-xs px-3 py-1.5 rounded-full transition-colors"
                  style={{ background: 'var(--sage)', color: '#fff' }}
                >
                  Next →
                </button>
              )}
            </div>
          </div>
        ) : (
          // ── Full script view ────────────────────────────────────────────
          <div>
            {blocks.map((block, idx) => (
              <ScriptBlock
                key={idx}
                text={block}
                last={idx === blocks.length - 1}
              />
            ))}
          </div>
        )}
      </div>

      <SourceList sources={sources} />
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export function MeditateInterface() {
  const { getAccessToken } = usePrivy();

  const MAX_TOPIC_CHARS = 300;
  const [topic, setTopic] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<MeditationResult | null>(null);
  const [error, setError] = useState<string | null>(null);

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
        body: JSON.stringify({ topic: t }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        const msg = data?.error?.message ?? 'Something went wrong — please try again.';
        setError(msg);
        return;
      }

      const data: MeditationResult = await res.json();
      setResult(data);
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

  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--bg)' }}>
      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="max-w-2xl mx-auto">
          {/* Empty state / topic picker */}
          {!hasResult && !loading && (
            <div className="flex flex-col items-center text-center pt-8 pb-6">
              <div
                className="w-14 h-14 rounded-full flex items-center justify-center mb-4"
                style={{ background: 'var(--bg-chip)' }}
              >
                <svg aria-hidden="true"
                  className="w-7 h-7"
                  style={{ color: 'var(--sage)' }}
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
              <p className="font-medium text-sm mb-1" style={{ color: 'var(--text-warm)' }}>
                Generate a guided meditation
              </p>
              <p className="text-xs mb-6" style={{ color: 'var(--text-muted)' }}>
                Grounded in 760+ hours of mindfulness teachings · 5-10 minutes
              </p>

              {error && (
                <div
                  className="w-full rounded-xl px-4 py-3 mb-5 text-sm text-left"
                  style={{ background: 'var(--error-bg)', border: '1px solid var(--error-border)', color: 'var(--error-text)' }}
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
                      background: 'var(--bg-surface)',
                      color: 'var(--text-warm)',
                      border: '1px solid var(--border-subtle)',
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
            <MeditationScript
              script={result.script}
              topic={topic}
              duration={result.duration}
              sources={result.sources}
              onReset={handleReset}
            />
          )}
        </div>
      </div>

      {/* Input bar — hidden when showing a result */}
      {!hasResult && (
        <div
          className="border-t px-4 py-4"
          style={{ borderColor: 'var(--border)', background: 'var(--bg)' }}
        >
          <form onSubmit={handleSubmit} className="max-w-2xl mx-auto">
            <div
              className="flex items-center gap-2 rounded-2xl px-4 py-3"
              style={{
                background: 'var(--bg-input)',
                border: '1px solid var(--border)',
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
                style={{ color: 'var(--text)' }}
              />
              <button
                type="submit"
                disabled={!topic.trim() || loading}
                className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center transition-opacity disabled:opacity-30"
                style={{ background: 'var(--sage)' }}
              >
                <svg aria-hidden="true"
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
                  className="text-xs tabular-nums"
                  style={{ color: topic.length >= MAX_TOPIC_CHARS ? 'var(--error-text)' : 'var(--text-faint)' }}
                >
                  {topic.length} / {MAX_TOPIC_CHARS}
                </p>
              </div>
            )}
          </form>
        </div>
      )}
    </div>
  );
}
