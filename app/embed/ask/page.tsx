'use client';

import { useState, useEffect, useRef, Suspense, type FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';

interface Source {
  text: string;
  speaker: string;
  source: string;
  score: number;
}

/**
 * Renders answer text with [N] citation badges that open the sources panel.
 */
function FormattedAnswer({
  text,
  onCitationClick,
}: {
  text: string;
  onCitationClick: (n: number) => void;
}) {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (paragraphs.length === 0) return <span>{text}</span>;

  return (
    <>
      {paragraphs.map((para, pIdx) => {
        const parts = para.split(/(\[\d+\])/);
        return (
          <p key={pIdx} style={{ marginTop: pIdx > 0 ? '0.65rem' : 0, marginBottom: 0 }}>
            {parts.map((part, j) => {
              const match = part.match(/^\[(\d+)\]$/);
              if (match) {
                const n = parseInt(match[1], 10);
                return (
                  <button
                    key={j}
                    onClick={() => onCitationClick(n)}
                    title={`View source ${n}`}
                    aria-label={`View source ${n}`}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      background: 'var(--citation-bg)',
                      color: 'var(--sage-mid)',
                      borderRadius: '3px',
                      padding: '0 4px',
                      fontSize: '0.6rem',
                      fontFamily: 'monospace',
                      verticalAlign: 'super',
                      lineHeight: '1.5',
                      margin: '0 1px',
                      cursor: 'pointer',
                      border: 'none',
                    }}
                  >
                    {n}
                  </button>
                );
              }
              return (
                <span key={j}>
                  {part.split('\n').map((line, k) => (
                    <span key={k}>
                      {k > 0 && <br />}
                      {line}
                    </span>
                  ))}
                </span>
              );
            })}
          </p>
        );
      })}
    </>
  );
}

function EmbedAsk() {
  const searchParams = useSearchParams();
  const siteId = searchParams.get('siteId') ?? '';
  const placeholder = searchParams.get('placeholder') ?? 'Ask anything about mindfulness…';
  const theme = searchParams.get('theme') ?? 'light';

  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [rateLimited, setRateLimited] = useState(false);
  const [resetTime, setResetTime] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);

  // Apply theme from URL param (overrides the root layout's localStorage-based theme)
  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [theme]);

  // Notify parent iframe of our current scroll height for auto-resize
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const send = () => {
      window.parent.postMessage({ type: 'poa-embed-resize', height: el.scrollHeight }, '*');
    };
    send();
    const ro = new ResizeObserver(send);
    ro.observe(el);
    return () => ro.disconnect();
  }, [answer, sources, sourcesOpen, rateLimited, errorMsg, loading]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const q = question.trim();
    if (!q || loading) return;

    setLoading(true);
    setAnswer('');
    setSources([]);
    setErrorMsg(null);
    setRateLimited(false);
    setSourcesOpen(false);

    try {
      const body: Record<string, string> = { question: q };
      if (siteId) body.siteId = siteId;

      const res = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (res.status === 429 || res.status === 402) {
        setRateLimited(true);
        const resetHeader = res.headers.get('X-RateLimit-Reset');
        if (resetHeader) {
          setResetTime(new Date(parseInt(resetHeader, 10) * 1000).toLocaleTimeString());
        }
        setLoading(false);
        return;
      }

      if (!res.ok) {
        setErrorMsg('Something went wrong — please try again.');
        setLoading(false);
        return;
      }

      const contentType = res.headers.get('content-type') ?? '';
      if (contentType.includes('text/event-stream') && res.body) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let accumulated = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split('\n\n');
          buffer = parts.pop() ?? '';

          for (const part of parts) {
            const line = part.trim();
            if (!line.startsWith('data: ')) continue;
            let event: Record<string, unknown>;
            try {
              event = JSON.parse(line.slice(6)) as Record<string, unknown>;
            } catch {
              continue;
            }

            if (typeof event.delta === 'string') {
              accumulated += event.delta;
              setAnswer(accumulated);
              setLoading(false);
            } else if (event.done === true) {
              if (Array.isArray(event.sources)) {
                setSources(event.sources as Source[]);
              }
            }
          }
        }
      }
    } catch {
      setErrorMsg('Failed to connect — please try again.');
    } finally {
      setLoading(false);
    }
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? '/';

  return (
    <div
      ref={containerRef}
      style={{
        padding: '1rem',
        background: 'var(--bg)',
        color: 'var(--text)',
        fontFamily: 'var(--font-geist-sans, system-ui, sans-serif)',
        fontSize: '0.9rem',
        lineHeight: '1.6',
        minHeight: '80px',
        boxSizing: 'border-box',
      }}
    >
      <form onSubmit={handleSubmit}>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <input
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder={placeholder}
            disabled={loading}
            maxLength={500}
            autoComplete="off"
            style={{
              flex: 1,
              padding: '0.5rem 0.75rem',
              borderRadius: '6px',
              border: '1px solid var(--border)',
              background: 'var(--bg-input)',
              color: 'var(--text)',
              fontSize: '0.875rem',
              outline: 'none',
              minWidth: 0,
            }}
            aria-label="Ask a question about mindfulness"
          />
          <button
            type="submit"
            disabled={loading || !question.trim()}
            style={{
              padding: '0.5rem 1rem',
              borderRadius: '6px',
              background:
                loading || !question.trim() ? 'var(--sage-pale)' : 'var(--sage)',
              color: '#fff',
              border: 'none',
              cursor: loading || !question.trim() ? 'default' : 'pointer',
              fontSize: '0.875rem',
              fontWeight: 500,
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >
            {loading ? '…' : 'Ask'}
          </button>
        </div>
      </form>

      {rateLimited && (
        <div
          style={{
            marginTop: '0.75rem',
            padding: '0.625rem 0.75rem',
            background: 'var(--warn-bg)',
            border: '1px solid var(--warn-border)',
            borderRadius: '6px',
            color: 'var(--warn-text)',
            fontSize: '0.8125rem',
          }}
        >
          You&rsquo;ve reached the limit of 3 questions per day.
          {resetTime && <> Resets at {resetTime}.</>}
        </div>
      )}

      {errorMsg && (
        <p
          style={{
            marginTop: '0.75rem',
            color: 'var(--error-text)',
            fontSize: '0.8125rem',
          }}
        >
          {errorMsg}
        </p>
      )}

      {loading && !answer && (
        <p
          style={{
            marginTop: '0.75rem',
            color: 'var(--text-muted)',
            fontSize: '0.8125rem',
          }}
        >
          Thinking&hellip;
        </p>
      )}

      {answer && (
        <div
          style={{
            marginTop: '1rem',
            fontSize: '0.875rem',
            color: 'var(--text)',
          }}
        >
          <FormattedAnswer text={answer} onCitationClick={() => setSourcesOpen(true)} />
        </div>
      )}

      {sources.length > 0 && (
        <div style={{ marginTop: '0.75rem' }}>
          <button
            onClick={() => setSourcesOpen((o) => !o)}
            aria-expanded={sourcesOpen}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--sage)',
              fontSize: '0.75rem',
              padding: 0,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            <span aria-hidden="true">{sourcesOpen ? '▾' : '▸'}</span>
            {sources.length} source{sources.length !== 1 ? 's' : ''}
          </button>

          {sourcesOpen && (
            <div
              style={{
                marginTop: '0.5rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.5rem',
              }}
            >
              {sources.map((s, i) => (
                <div
                  key={i}
                  style={{
                    padding: '0.5rem 0.75rem',
                    background: 'var(--source-bg)',
                    border: '1px solid var(--source-border)',
                    borderRadius: '6px',
                    fontSize: '0.75rem',
                    color: 'var(--text-warm)',
                  }}
                >
                  <div
                    style={{
                      color: 'var(--sage-mid)',
                      fontWeight: 600,
                      marginBottom: '0.25rem',
                    }}
                  >
                    [{i + 1}] {s.speaker || 'Teacher'}
                  </div>
                  <p style={{ margin: 0, lineHeight: '1.5' }}>
                    {s.text.length > 220 ? s.text.slice(0, 220) + '…' : s.text}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div
        style={{
          marginTop: '1rem',
          paddingTop: '0.625rem',
          borderTop: '1px solid var(--border)',
          textAlign: 'right',
          fontSize: '0.6875rem',
          color: 'var(--text-muted)',
        }}
      >
        Powered by{' '}
        <a
          href={appUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: 'var(--sage)' }}
        >
          Paradox of Acceptance
        </a>
      </div>
    </div>
  );
}

export default function EmbedAskPage() {
  return (
    <Suspense>
      <EmbedAsk />
    </Suspense>
  );
}
