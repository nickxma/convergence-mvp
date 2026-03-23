'use client';

import { useState, useRef, useEffect, useCallback, type RefObject, type MutableRefObject, FormEvent, KeyboardEvent } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';
import { useAuth } from '@/lib/use-auth';
import {
  type Message,
  type Conversation,
  type CompareColumn,
  loadConversations,
  saveConversation,
  newConversationId,
  titleFromQuestion,
} from '@/lib/conversations';
import { SaveToReadingListButton } from '@/components/save-to-reading-list-button';
import { exportConversation, exportSingleAnswer } from '@/lib/export';
import { track } from '@vercel/analytics';
import { UpgradePrompt } from '@/components/upgrade-prompt';

export type { Message };

interface Source {
  text: string;
  speaker: string;
  source: string;
  score: number;
}

const CITATION_BUTTON_STYLE: React.CSSProperties = {
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
};

/**
 * Renders answer text as markdown with clickable [N] citation badges.
 * Supports paragraph breaks, bullet lists, headers, bold/italic via react-markdown.
 * [N] markers are pre-processed to cite: links and rendered as superscript buttons.
 */
function FormattedAnswer({
  text,
  onCitationClick,
}: {
  text: string;
  onCitationClick?: (n: number) => void;
}) {
  // Pre-process [N] citation markers → [N](cite:N) so react-markdown treats them
  // as anchor elements that we can intercept with a custom renderer.
  const processedText = text.replace(/\[(\d+)\]/g, '[$1](cite:$1)');

  const components: Components = {
    p: ({ children }) => (
      <p style={{ marginBottom: '0.65rem' }} className="last:mb-0">{children}</p>
    ),
    ul: ({ children }) => (
      <ul style={{ listStyleType: 'disc', paddingLeft: '1.25rem', marginBottom: '0.65rem' }}>{children}</ul>
    ),
    ol: ({ children }) => (
      <ol style={{ listStyleType: 'decimal', paddingLeft: '1.25rem', marginBottom: '0.65rem' }}>{children}</ol>
    ),
    li: ({ children }) => (
      <li style={{ marginBottom: '0.2rem' }}>{children}</li>
    ),
    h1: ({ children }) => (
      <h1 style={{ fontWeight: 600, marginBottom: '0.4rem' }}>{children}</h1>
    ),
    h2: ({ children }) => (
      <h2 style={{ fontWeight: 600, marginBottom: '0.35rem' }}>{children}</h2>
    ),
    h3: ({ children }) => (
      <h3 style={{ fontWeight: 500, marginBottom: '0.3rem' }}>{children}</h3>
    ),
    a: ({ href, children }) => {
      if (href?.startsWith('cite:') && onCitationClick) {
        const n = parseInt(href.slice(5), 10);
        return (
          <button
            onClick={() => onCitationClick(n)}
            title={`View source ${n}`}
            aria-label={`View source ${n}`}
            style={CITATION_BUTTON_STYLE}
          >
            {n}
          </button>
        );
      }
      return <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>;
    },
  };

  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {processedText}
    </ReactMarkdown>
  );
}

/** Derive a human-readable label from a raw source filename/path. */
function sourceLabel(source: string): string {
  if (!source) return 'Transcript';
  const base = source.split('/').pop() ?? source;
  return base.replace(/\.[^.]+$/, '').replace(/[_-]/g, ' ');
}

/** Stable short hash for a chunk — used as chunkId in citation feedback. */
function chunkHash(s: Source): string {
  const raw = `${s.source}::${s.text.slice(0, 100)}`;
  let h = 0;
  for (let i = 0; i < raw.length; i++) {
    h = (Math.imul(31, h) + raw.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36);
}

/**
 * Thumbs-up / thumbs-down pair for a single citation.
 * Appears on hover; turns colored on selection. Fire-and-forget POST.
 */
function CitationFeedback({
  qaId,
  chunkId,
}: {
  qaId: string;
  chunkId: string;
}) {
  const [voted, setVoted] = useState<'helpful' | 'unhelpful' | null>(null);

  function submit(signal: 'helpful' | 'unhelpful') {
    if (voted) return;
    setVoted(signal);
    fetch('/api/ask/citation-feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ qaId, chunkId, signal }),
    }).catch(() => {});
  }

  return (
    <div className="flex items-center gap-0.5 ml-1 flex-shrink-0">
      <button
        onClick={() => submit('helpful')}
        disabled={!!voted}
        title="Helpful source"
        aria-label="Mark source as helpful"
        aria-pressed={voted === 'helpful'}
        style={{
          background: 'none',
          border: 'none',
          padding: '1px',
          cursor: voted ? 'default' : 'pointer',
          color: voted === 'helpful' ? 'var(--sage)' : 'var(--text-faint)',
          opacity: voted && voted !== 'helpful' ? 0.3 : 1,
          lineHeight: 1,
        }}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill={voted === 'helpful' ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6.633 10.25c.806 0 1.533-.446 2.031-1.08a9.041 9.041 0 0 1 2.861-2.4c.723-.384 1.35-.956 1.653-1.715a4.498 4.498 0 0 0 .322-1.672V2.75a.75.75 0 0 1 .75-.75 2.25 2.25 0 0 1 2.25 2.25c0 1.152-.26 2.243-.723 3.218-.266.558.107 1.282.725 1.282m0 0h3.126c1.026 0 1.945.694 2.054 1.715.045.422.068.85.068 1.285a11.95 11.95 0 0 1-2.649 7.521c-.388.482-.987.729-1.605.729H13.48c-.483 0-.964-.078-1.423-.23l-3.114-1.04a4.501 4.501 0 0 0-1.423-.23H5.909M14.25 9h2.25M5.909 18.006 7.5 18h2.586a4.5 4.5 0 0 0 1.423-.23l3.114-1.04a4.5 4.5 0 0 1 1.423-.23H14.25M5.909 18.006C5.574 18.124 5.216 18.19 4.845 18.19a2.659 2.659 0 0 1-2.659-2.56V10.25a2.25 2.25 0 0 1 2.25-2.25H6M5.909 18.006C5.574 17.886 5.216 17.82 4.845 17.82" />
        </svg>
      </button>
      <button
        onClick={() => submit('unhelpful')}
        disabled={!!voted}
        title="Not a helpful source"
        aria-label="Mark source as not helpful"
        aria-pressed={voted === 'unhelpful'}
        style={{
          background: 'none',
          border: 'none',
          padding: '1px',
          cursor: voted ? 'default' : 'pointer',
          color: voted === 'unhelpful' ? 'var(--error-text, #c0392b)' : 'var(--text-faint)',
          opacity: voted && voted !== 'unhelpful' ? 0.3 : 1,
          lineHeight: 1,
        }}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill={voted === 'unhelpful' ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M7.498 15.25H4.372c-1.026 0-1.945-.694-2.054-1.715a12.137 12.137 0 0 1-.068-1.285c0-2.848.992-5.464 2.649-7.521C5.287 4.247 5.886 4 6.504 4h4.016a4.5 4.5 0 0 1 1.423.23l3.114 1.04a4.5 4.5 0 0 0 1.423.23h1.294M7.498 15.25c.618 0 .991.724.725 1.282A7.471 7.471 0 0 0 7.5 19.75 2.25 2.25 0 0 0 9.75 22a.75.75 0 0 0 .75-.75v-.633c0-.573.11-1.14.322-1.672.304-.76.93-1.33 1.653-1.715a9.04 9.04 0 0 0 2.86-2.4c.498-.634 1.226-1.08 2.032-1.08h.384M7.498 15.25H9.75M14.25 4.75h2.25M9.75 15.25a2.25 2.25 0 0 1-2.25-2.25V9a2.25 2.25 0 0 1 2.25-2.25h.384" />
        </svg>
      </button>
    </div>
  );
}

/**
 * Numbered, collapsible citations panel. Shows top 3 sources.
 * `open` and `onToggle` are controlled externally so the parent can open
 * the panel when a citation badge is clicked.
 */
function SourceList({
  sources,
  open,
  onToggle,
  sourceRefs,
  qaId,
}: {
  sources: Source[];
  open: boolean;
  onToggle: () => void;
  sourceRefs?: RefObject<(HTMLDivElement | null)[]>;
  qaId?: string;
}) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const top3 = sources.slice(0, 3);
  if (top3.length === 0) return null;

  return (
    <div className="mt-3">
      <button
        onClick={onToggle}
        className="flex items-center gap-1.5 text-xs font-medium transition-colors"
        style={{ color: 'var(--sage)' }}
      >
        <svg
          className="w-3.5 h-3.5 transition-transform"
          style={{ transform: open ? 'rotate(90deg)' : 'rotate(0deg)' }}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        {top3.length} citation{top3.length !== 1 ? 's' : ''}
      </button>

      {open && (
        <div className="mt-2 space-y-2">
          {top3.map((s, i) => (
            <div
              key={i}
              ref={(el) => {
                if (sourceRefs?.current) sourceRefs.current[i] = el;
              }}
              className="rounded-lg p-3 text-xs"
              style={{
                background: 'var(--source-bg)',
                borderLeft: '2px solid var(--source-border)',
              }}
              onMouseEnter={() => setHoveredIndex(i)}
              onMouseLeave={() => setHoveredIndex(null)}
            >
              <div className="flex items-start gap-2">
                <span
                  className="font-mono flex-shrink-0 mt-0.5"
                  style={{ color: 'var(--text-muted)', fontSize: '0.65rem' }}
                >
                  [{i + 1}]
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1 mb-0.5">
                    <p className="font-semibold flex-1 min-w-0" style={{ color: 'var(--sage-mid)' }}>
                      {sourceLabel(s.source)}
                    </p>
                    {qaId && (
                      <div style={{ visibility: hoveredIndex === i ? 'visible' : 'hidden' }}>
                        <CitationFeedback qaId={qaId} chunkId={chunkHash(s)} />
                      </div>
                    )}
                  </div>
                  {s.speaker && (
                    <p className="mb-1 opacity-70" style={{ color: 'var(--sage-mid)' }}>
                      {s.speaker}
                    </p>
                  )}
                  <p className="leading-relaxed line-clamp-3" style={{ color: 'var(--text-warm)' }}>
                    {s.text}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Export conversation button ────────────────────────────────────────────────

function ExportConversationButton({ messages }: { messages: Message[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        title="Export conversation"
        aria-label="Export conversation"
        aria-expanded={open}
        className="flex items-center gap-1 text-xs px-2 min-h-[44px] rounded-lg border transition-colors"
        style={{ borderColor: 'var(--border)', color: 'var(--text-muted)', background: 'transparent' }}
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
        </svg>
        Export
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
        </svg>
      </button>
      {open && (
        <div
          className="absolute right-0 mt-1 rounded-xl py-1 shadow-lg z-20 min-w-[160px]"
          style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}
        >
          <button
            className="w-full text-left px-3 py-2 text-xs transition-colors"
            style={{ color: 'var(--text-warm)' }}
            onClick={() => { exportConversation(messages, 'markdown'); setOpen(false); }}
          >
            Export as Markdown
          </button>
          <button
            className="w-full text-left px-3 py-2 text-xs transition-colors"
            style={{ color: 'var(--text-warm)' }}
            onClick={() => { exportConversation(messages, 'plaintext'); setOpen(false); }}
          >
            Export as Plain Text
          </button>
        </div>
      )}
    </div>
  );
}

// ── Single-answer export button ───────────────────────────────────────────────

function ExportAnswerButton({
  question,
  answer,
  sources,
}: {
  question: string;
  answer: string;
  sources: Source[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        title="Export this answer"
        aria-label="Export this answer"
        aria-expanded={open}
        className="flex items-center gap-1 text-xs transition-colors mt-2"
        style={{ color: open ? 'var(--sage)' : 'var(--text-faint)' }}
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
        </svg>
        Export
      </button>
      {open && (
        <div
          className="absolute left-0 mt-1 rounded-xl py-1 shadow-lg z-20 min-w-[160px]"
          style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}
        >
          <button
            className="w-full text-left px-3 py-2 text-xs transition-colors"
            style={{ color: 'var(--text-warm)' }}
            onClick={() => { exportSingleAnswer(question, answer, sources.slice(0, 3), 'markdown'); setOpen(false); }}
          >
            Export as Markdown
          </button>
          <button
            className="w-full text-left px-3 py-2 text-xs transition-colors"
            style={{ color: 'var(--text-warm)' }}
            onClick={() => { exportSingleAnswer(question, answer, sources.slice(0, 3), 'plaintext'); setOpen(false); }}
          >
            Export as Plain Text
          </button>
        </div>
      )}
    </div>
  );
}

// ── Copy button ───────────────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable — silently skip
    }
  }

  return (
    <button
      onClick={handleCopy}
      title="Copy answer"
      className="flex items-center gap-1 text-xs transition-colors mt-2"
      style={{ color: copied ? 'var(--sage)' : 'var(--text-faint)' }}
    >
      {copied ? (
        <>
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
          </svg>
          Copied
        </>
      ) : (
        <>
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M15.666 3.888A2.25 2.25 0 0 0 13.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 0 1-.75.75H9a.75.75 0 0 1-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 0 1-2.25 2.25H6.75A2.25 2.25 0 0 1 4.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 0 1 1.927-.184"
            />
          </svg>
          Copy
        </>
      )}
    </button>
  );
}

// ── Feedback buttons ──────────────────────────────────────────────────────────

function FeedbackButtons({ answerId }: { answerId: string }) {
  const { getAccessToken, login } = useAuth();
  const [voted, setVoted] = useState<'up' | 'down' | null>(null);
  const [pending, setPending] = useState(false);

  const submitFeedback = useCallback(
    async (rating: 'up' | 'down') => {
      if (pending) return;
      // Guest users: prompt wallet connect
      const token = await getAccessToken();
      if (!token) {
        login();
        return;
      }
      // Optimistic update
      setVoted(rating);
      setPending(true);
      try {
        await fetch('/api/qa-feedback', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ answerId, rating }),
        });
      } catch {
        // Non-critical; keep the optimistic state
      } finally {
        setPending(false);
      }
    },
    [answerId, getAccessToken, login, pending],
  );

  const activeStyle = (which: 'up' | 'down') =>
    voted === which ? { color: 'var(--sage-mid)' } : { color: 'var(--text-faint)' };

  return (
    <div className="flex items-center gap-1 mt-2">
      <button
        onClick={() => { if (voted !== 'up') void submitFeedback('up'); }}
        disabled={pending}
        title="Helpful"
        aria-label="Mark as helpful"
        aria-pressed={voted === 'up'}
        className="flex items-center gap-1 text-xs transition-colors disabled:opacity-50"
        style={activeStyle('up')}
      >
        <svg
          className="w-3.5 h-3.5"
          fill={voted === 'up' ? 'currentColor' : 'none'}
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M6.633 10.25c.806 0 1.533-.446 2.031-1.08a9.041 9.041 0 0 1 2.861-2.4c.723-.384 1.35-.956 1.653-1.715a4.498 4.498 0 0 0 .322-1.672V2.75a.75.75 0 0 1 .75-.75 2.25 2.25 0 0 1 2.25 2.25c0 1.152-.26 2.243-.723 3.218-.266.558.107 1.282.725 1.282m0 0h3.126c1.026 0 1.945.694 2.054 1.715.045.422.068.85.068 1.285a11.95 11.95 0 0 1-2.649 7.521c-.388.482-.987.729-1.605.729H13.48c-.483 0-.964-.078-1.423-.23l-3.114-1.04a4.501 4.501 0 0 0-1.423-.23H5.909M14.25 9h2.25M5.909 18.006 7.5 18h2.586a4.5 4.5 0 0 0 1.423-.23l3.114-1.04a4.5 4.5 0 0 1 1.423-.23H14.25M5.909 18.006C5.574 18.124 5.216 18.19 4.845 18.19a2.659 2.659 0 0 1-2.659-2.56V10.25a2.25 2.25 0 0 1 2.25-2.25H6M5.909 18.006C5.574 17.886 5.216 17.82 4.845 17.82" />
        </svg>
      </button>
      <button
        onClick={() => { if (voted !== 'down') void submitFeedback('down'); }}
        disabled={pending}
        title="Not helpful"
        aria-label="Mark as not helpful"
        aria-pressed={voted === 'down'}
        className="flex items-center gap-1 text-xs transition-colors disabled:opacity-50"
        style={activeStyle('down')}
      >
        <svg
          className="w-3.5 h-3.5"
          fill={voted === 'down' ? 'currentColor' : 'none'}
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M7.498 15.25H4.372c-1.026 0-1.945-.694-2.054-1.715a12.137 12.137 0 0 1-.068-1.285c0-2.848.992-5.464 2.649-7.521C5.287 4.247 5.886 4 6.504 4h4.016a4.5 4.5 0 0 1 1.423.23l3.114 1.04a4.5 4.5 0 0 0 1.423.23h1.294M7.498 15.25c.618 0 .991.724.725 1.282A7.471 7.471 0 0 0 7.5 19.75 2.25 2.25 0 0 0 9.75 22a.75.75 0 0 0 .75-.75v-.633c0-.573.11-1.14.322-1.672.304-.76.93-1.33 1.653-1.715a9.04 9.04 0 0 0 2.86-2.4c.498-.634 1.226-1.08 2.032-1.08h.384M7.498 15.25H9.75M14.25 4.75h2.25M9.75 15.25a2.25 2.25 0 0 1-2.25-2.25V9a2.25 2.25 0 0 1 2.25-2.25h.384" />
        </svg>
      </button>
    </div>
  );
}


// ── Bookmark button (delegates to SaveToReadingListButton) ────────────────────

// ── Share link button ─────────────────────────────────────────────────────────

function ShareLinkButton({ answerId }: { answerId: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      const url = `${window.location.origin}/qa/${answerId}`;
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable — silently skip
    }
  }

  return (
    <button
      onClick={handleCopy}
      title="Copy link to this answer"
      className="flex items-center gap-1 text-xs transition-colors mt-2"
      style={{ color: copied ? 'var(--sage)' : 'var(--text-faint)' }}
    >
      {copied ? (
        <>
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
          </svg>
          Link copied!
        </>
      ) : (
        <>
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244" />
          </svg>
          Copy link
        </>
      )}
    </button>
  );
}

// ── Twitter share button ──────────────────────────────────────────────────────

function TwitterShareButton({ question, answer, answerId }: { question: string; answer: string; answerId: string }) {
  function handleShare() {
    const url = `${window.location.origin}/qa/${answerId}`;
    const excerpt = answer.replace(/\n+/g, ' ').trim().slice(0, 100);
    const text = `${question}\n\n"${excerpt}…"\n\n${url}`;
    const intentUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`;
    window.open(intentUrl, '_blank', 'noopener,noreferrer');
  }

  return (
    <button
      onClick={handleShare}
      title="Share on Twitter / X"
      className="flex items-center gap-1 text-xs transition-colors mt-2"
      style={{ color: 'var(--text-faint)' }}
    >
      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
      </svg>
      Share
    </button>
  );
}

// ── Follow-up chips ───────────────────────────────────────────────────────────

function FollowUpChips({
  questions,
  onSelect,
}: {
  questions: string[];
  onSelect: (q: string) => void;
}) {
  if (questions.length === 0) return null;
  return (
    <div className="mt-3 flex flex-col gap-1.5">
      {questions.map((q, i) => (
        <button
          key={i}
          onClick={() => onSelect(q)}
          className="text-left text-xs rounded-xl px-3 min-h-[44px] flex items-center transition-colors"
          style={{ background: 'var(--bg-surface)', color: 'var(--text-warm)', border: '1px solid var(--border-subtle)' }}
        >
          {q}
        </button>
      ))}
    </div>
  );
}

/**
 * Wrapper for an assistant message bubble.
 * Coordinates citation clicks → source panel open + scroll-to-source.
 * When `streaming` is true a blinking cursor is appended after the text.
 */
function AssistantMessage({
  content,
  sources,
  followUps,
  isError,
  onFollowUp,
  answerId,
  question,
  streaming,
  fromCache,
}: {
  content: string;
  sources?: Source[];
  followUps?: string[];
  isError?: boolean;
  onFollowUp?: (q: string) => void;
  answerId?: string;
  question?: string;
  streaming?: boolean;
  fromCache?: boolean;
}) {
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const sourceRefs = useRef<(HTMLDivElement | null)[]>([]);

  function handleCitationClick(n: number) {
    setSourcesOpen(true);
    // Scroll to the referenced source after the panel renders
    requestAnimationFrame(() => {
      sourceRefs.current[n - 1]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  }

  return (
    <div className="max-w-xl w-full">
      <div
        className="rounded-2xl rounded-tl-sm px-4 py-3 text-sm leading-relaxed"
        style={{
          background: isError ? 'var(--error-bg)' : 'var(--bg-surface)',
          color: isError ? 'var(--error-text)' : 'var(--text)',
          border: isError ? '1px solid var(--error-border)' : 'none',
        }}
      >
        {content ? (
          <FormattedAnswer
            text={content}
            onCitationClick={(sources?.length ?? 0) > 0 ? handleCitationClick : undefined}
          />
        ) : null}
        {streaming && (
          <span
            aria-label="Generating response"
            style={{
              display: 'inline-block',
              width: '2px',
              height: '1em',
              background: 'var(--sage)',
              marginLeft: content ? '1px' : 0,
              verticalAlign: 'text-bottom',
              animation: 'blink 1s step-end infinite',
            }}
          />
        )}
        {fromCache && !streaming && (
          <span
            aria-label="Served from cache"
            title="This answer was retrieved from cache"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              marginTop: '8px',
              padding: '2px 7px',
              borderRadius: '4px',
              fontSize: '0.65rem',
              fontWeight: 500,
              letterSpacing: '0.04em',
              background: 'var(--bg-chip)',
              color: 'var(--text-muted)',
              verticalAlign: 'middle',
              userSelect: 'none',
            }}
          >
            Cache
          </span>
        )}
      </div>
      {!isError && !streaming && (
        <div className="px-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <CopyButton text={content} />
            {answerId && <ShareLinkButton answerId={answerId} />}
            {answerId && question && (
              <TwitterShareButton question={question} answer={content} answerId={answerId} />
            )}
            {answerId && <FeedbackButtons answerId={answerId} />}
            {answerId && (
              <SaveToReadingListButton answerId={answerId} />
            )}
            {question && (
              <ExportAnswerButton question={question} answer={content} sources={sources ?? []} />
            )}
          </div>
          {sources && sources.length > 0 && (
            <SourceList
              sources={sources}
              open={sourcesOpen}
              onToggle={() => setSourcesOpen((v) => !v)}
              sourceRefs={sourceRefs}
              qaId={answerId}
            />
          )}
          {followUps && followUps.length > 0 && onFollowUp && (
            <FollowUpChips questions={followUps} onSelect={onFollowUp} />
          )}
        </div>
      )}
    </div>
  );
}

function ResponseSkeleton() {
  return (
    <div
      className="rounded-2xl rounded-tl-sm px-4 py-3 max-w-xl"
      style={{ background: 'var(--bg-surface)' }}
      aria-label="Loading response"
    >
      <div className="space-y-2">
        <div
          className="h-3 rounded-full"
          style={{ width: '85%', background: 'var(--border-subtle)', animation: 'shimmer 1.4s ease-in-out infinite' }}
        />
        <div
          className="h-3 rounded-full"
          style={{ width: '70%', background: 'var(--border-subtle)', animation: 'shimmer 1.4s ease-in-out 0.15s infinite' }}
        />
        <div
          className="h-3 rounded-full"
          style={{ width: '55%', background: 'var(--border-subtle)', animation: 'shimmer 1.4s ease-in-out 0.3s infinite' }}
        />
      </div>
    </div>
  );
}

// ── Related questions panel ───────────────────────────────────────────────────

interface RelatedQuestion { question: string; answer_snippet: string; similarity: number; }

function RelatedCardSkeleton() {
  return (
    <div
      className="rounded-xl px-4 py-3"
      style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}
      aria-hidden="true"
    >
      <div
        className="h-3 rounded-full mb-2"
        style={{ width: '75%', background: 'var(--border-subtle)', animation: 'shimmer 1.4s ease-in-out infinite' }}
      />
      <div
        className="h-2.5 rounded-full mb-1.5"
        style={{ width: '100%', background: 'var(--border-subtle)', animation: 'shimmer 1.4s ease-in-out 0.1s infinite' }}
      />
      <div
        className="h-2.5 rounded-full"
        style={{ width: '60%', background: 'var(--border-subtle)', animation: 'shimmer 1.4s ease-in-out 0.2s infinite' }}
      />
    </div>
  );
}

function RelatedQuestionsPanel({
  loading,
  questions,
  onSelect,
}: {
  loading: boolean;
  questions: RelatedQuestion[];
  onSelect: (q: RelatedQuestion) => void;
}) {
  return (
    <div className="px-4 py-5">
      <h3
        className="text-xs font-semibold uppercase tracking-wide mb-4"
        style={{ color: 'var(--sage)' }}
      >
        You might also wonder
      </h3>
      <div className="space-y-3">
        {loading
          ? [0, 1, 2].map((i) => <RelatedCardSkeleton key={i} />)
          : questions.map((q, i) => (
              <button
                key={i}
                onClick={() => onSelect(q)}
                className="w-full text-left rounded-xl px-4 py-3 transition-colors"
                style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}
              >
                <p
                  className="text-sm font-medium leading-snug mb-1"
                  style={{ color: 'var(--sage-dark)' }}
                >
                  {q.question}
                </p>
                <p
                  className="text-xs leading-relaxed"
                  style={{
                    color: 'var(--text-muted)',
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                  }}
                >
                  {q.answer_snippet.split(/(?<=[.!?])\s/)[0] ?? q.answer_snippet.slice(0, 120)}
                </p>
              </button>
            ))}
      </div>
    </div>
  );
}

/** Format an ISO date string to local time, e.g. "3:45 PM". */
function formatResetTime(isoString: string): string {
  try {
    return new Date(isoString).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  } catch {
    return 'soon';
  }
}

const STARTER_QUESTIONS = [
  'What is the self?',
  'How do I stop overthinking?',
  'What is the relationship between mindfulness and free will?',
  'How can mindfulness reduce suffering?',
  'What does it mean to be fully present?',
] as const;

export interface QAInterfaceActions {
  focusInput: () => void;
  clear: () => void;
}

/** Compact collapsible citations for a single compare column. */
function CompareSourceList({ sources }: { sources: Source[] }) {
  const [open, setOpen] = useState(false);
  const top3 = sources.slice(0, 3);
  if (top3.length === 0) return null;
  return (
    <div className="px-4 pb-3">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 text-xs font-medium transition-colors"
        style={{ color: 'var(--sage)' }}
      >
        <svg
          className="w-3 h-3 transition-transform"
          style={{ transform: open ? 'rotate(90deg)' : 'rotate(0deg)' }}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        {top3.length} citation{top3.length !== 1 ? 's' : ''}
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          {top3.map((s, i) => (
            <div
              key={i}
              className="rounded p-2 text-xs"
              style={{ background: 'var(--source-bg)', borderLeft: '2px solid var(--source-border)' }}
            >
              <p className="font-semibold" style={{ color: 'var(--sage-mid)' }}>{sourceLabel(s.source)}</p>
              <p className="mt-0.5 leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                {s.text.slice(0, 120)}{s.text.length > 120 ? '…' : ''}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Side-by-side (desktop) / stacked (mobile) teacher comparison columns. */
function CompareColumns({ columns }: { columns: CompareColumn[] }) {
  return (
    <div className="w-full">
      <div className="flex flex-col md:flex-row gap-3">
        {columns.map((col, i) => (
          <div
            key={i}
            className="flex-1 min-w-0 rounded-xl overflow-hidden"
            style={{ border: '1px solid var(--border-subtle)', background: 'var(--bg-surface)' }}
          >
            {/* Column header */}
            <div
              className="px-4 py-2 border-b"
              style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-chip)' }}
            >
              <span className="text-xs font-semibold" style={{ color: 'var(--sage-dark)' }}>
                {col.teacher}
              </span>
            </div>
            {/* Column content */}
            <div
              className="px-4 py-3 text-sm leading-relaxed"
              style={{ color: 'var(--text)', minHeight: '80px' }}
            >
              {col.content ? (
                <>
                  <FormattedAnswer text={col.content} />
                  {col.streaming && (
                    <span
                      style={{
                        display: 'inline-block',
                        marginLeft: '2px',
                        width: '2px',
                        height: '1em',
                        background: 'var(--sage)',
                        animation: 'blink 1s step-end infinite',
                        verticalAlign: 'text-bottom',
                      }}
                    />
                  )}
                </>
              ) : col.streaming ? (
                <div className="space-y-2 py-1" aria-label="Loading response">
                  <div className="h-3 rounded-full" style={{ width: '80%', background: 'var(--border-subtle)', animation: 'shimmer 1.4s ease-in-out infinite' }} />
                  <div className="h-3 rounded-full" style={{ width: '65%', background: 'var(--border-subtle)', animation: 'shimmer 1.4s ease-in-out 0.15s infinite' }} />
                  <div className="h-3 rounded-full" style={{ width: '50%', background: 'var(--border-subtle)', animation: 'shimmer 1.4s ease-in-out 0.3s infinite' }} />
                </div>
              ) : (
                <span style={{ color: 'var(--text-faint)' }}>No response</span>
              )}
            </div>
            {/* Sources */}
            {!col.streaming && col.sources.length > 0 && (
              <CompareSourceList sources={col.sources} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

interface QAInterfaceProps {
  initialConversation?: Conversation | null;
  onConversationUpdate?: (conversation: Conversation) => void;
  onNewChat?: () => void;
  initialQuestion?: string;
  actionsRef?: MutableRefObject<QAInterfaceActions | null>;
  essayContext?: { title: string; courseSlug: string; sessionSlug: string } | null;
}

const TEACHER_STORAGE_KEY = 'wu_teacher_filter';

export function QAInterface({ initialConversation, onConversationUpdate, onNewChat, initialQuestion, actionsRef, essayContext }: QAInterfaceProps) {
  const { user, login, getAccessToken } = useAuth();
  const walletAddress = user?.wallet?.address ?? null;
  const userId = user?.id ?? null;
  const adminWallet = process.env.NEXT_PUBLIC_ADMIN_WALLET;
  const isAdmin = !!(adminWallet && walletAddress?.toLowerCase() === adminWallet.toLowerCase());

  const MAX_CHARS = 500;
  const [messages, setMessages] = useState<Message[]>(initialConversation?.messages ?? []);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  // Teacher filter state — null means "All Teachers"
  const [selectedTeacher, setSelectedTeacher] = useState<string | null>(null);
  const [teachers, setTeachers] = useState<string[]>([]);
  const [conversationId, setConversationId] = useState<string>(
    initialConversation?.id ?? newConversationId()
  );
  // Server-generated UUID for Supabase session continuity across turns.
  // Pre-seeded from initialConversation.serverConversationId to support resume flow.
  const [serverConversationId, setServerConversationId] = useState<string | null>(
    initialConversation?.serverConversationId ?? null,
  );
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Key takeaways — generated async after session completion
  const [sessionTakeaways, setSessionTakeaways] = useState<string[] | null>(null);
  const [takeawaysState, setTakeawaysState] = useState<'loading' | 'ready' | 'timeout' | null>(null);
  const takeawaysPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const takeawaysSessionIdRef = useRef<string | null>(null);

  const [essayContextDismissed, setEssayContextDismissed] = useState(false);

  // null = not yet determined (avoids flash on mount)
  const [showOnboardingPanel, setShowOnboardingPanel] = useState<boolean | null>(null);
  const [showCelebration, setShowCelebration] = useState(false);
  const [rateLimit, setRateLimit] = useState<{ remaining: number; resetAt: string } | null>(null);
  const [guestQueriesRemaining, setGuestQueriesRemaining] = useState<number | null>(null);
  const [guestLimitReached, setGuestLimitReached] = useState(false);
  const [userQuestionsRemaining, setUserQuestionsRemaining] = useState<number | null>(null);
  const [freeTierLimitReached, setFreeTierLimitReached] = useState(false);
  const [upgradeFeature, setUpgradeFeature] = useState<string | null>(null);

  // Answer style preference — loaded from API for authenticated users, localStorage for others
  type AnswerStyle = 'brief' | 'detailed' | 'citations_first';
  const ANSWER_STYLE_KEY = 'wu_answer_style';
  const [answerStyle, setAnswerStyleState] = useState<AnswerStyle>('detailed');

  // Compare mode — side-by-side answers from multiple teachers
  const [compareMode, setCompareMode] = useState(false);
  const [compareTeachers, setCompareTeachers] = useState<string[]>([]);
  const [userTier, setUserTier] = useState<'free' | 'pro' | 'team'>('free');

  // Load answer style on mount/auth change
  useEffect(() => {
    if (userId) {
      fetch('/api/user/preferences')
        .then((r) => r.ok ? r.json() : null)
        .then((data) => {
          if (data?.answer_style) setAnswerStyleState(data.answer_style as AnswerStyle);
        })
        .catch(() => {});
    } else {
      const stored = localStorage.getItem(ANSWER_STYLE_KEY) as AnswerStyle | null;
      if (stored && ['brief', 'detailed', 'citations_first'].includes(stored)) {
        setAnswerStyleState(stored);
      }
    }
  }, [userId]);

  function setAnswerStyle(style: AnswerStyle) {
    setAnswerStyleState(style);
    if (userId) {
      fetch('/api/user/preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answer_style: style }),
      }).catch(() => {});
    } else {
      localStorage.setItem(ANSWER_STYLE_KEY, style);
    }
  }

  // Fetch user subscription tier for Pro feature gating (compare 3+ teachers)
  useEffect(() => {
    if (!userId) return;
    fetch('/api/subscriptions/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (data?.tier) setUserTier(data.tier as 'free' | 'pro' | 'team'); })
      .catch(() => {});
  }, [userId]);

  // Suggestion dropdown state
  interface Suggestion { question: string; count: number; }
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [suggestionIndex, setSuggestionIndex] = useState(-1);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const suggestDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Similar-question dedup panel state
  interface SimilarQuestion { question: string; answer_snippet: string; similarity: number; }
  const [similarQuestions, setSimilarQuestions] = useState<SimilarQuestion[]>([]);
  const [showSimilarPanel, setShowSimilarPanel] = useState(false);
  const similarDismissedInput = useRef<string | null>(null);
  const similarDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Related questions panel (post-answer desktop sidebar + mobile inline)
  const [relatedQuestions, setRelatedQuestions] = useState<RelatedQuestion[]>([]);
  const [relatedLoading, setRelatedLoading] = useState(false);
  // Navigation history: stack of message arrays so user can go back after clicking a related Q
  const [historyStack, setHistoryStack] = useState<Message[][]>([]);

  // Determine first-visit state from localStorage (client-only)
  useEffect(() => {
    setShowOnboardingPanel(!localStorage.getItem('wu_onboarding_seen'));
    // Restore persisted teacher filter
    const stored = localStorage.getItem(TEACHER_STORAGE_KEY);
    if (stored) setSelectedTeacher(stored);
  }, []);

  // Fetch available teachers
  useEffect(() => {
    fetch('/api/teachers')
      .then((r) => (r.ok ? r.json() : Promise.resolve({ teachers: [] })))
      .then((data: { teachers: string[] }) => { if (data.teachers.length > 0) setTeachers(data.teachers); })
      .catch(() => {});
  }, []);

  // Auto-dismiss celebration banner after 6 seconds
  useEffect(() => {
    if (!showCelebration) return;
    const t = setTimeout(() => setShowCelebration(false), 6000);
    return () => clearTimeout(t);
  }, [showCelebration]);

  // Clear guest limit state when user signs in; clear free-tier state on sign-out
  useEffect(() => {
    if (userId) {
      setGuestLimitReached(false);
      setGuestQueriesRemaining(null);
    } else {
      setFreeTierLimitReached(false);
      setUserQuestionsRemaining(null);
    }
  }, [userId]);

  // Track current conversationId in a ref so the effect below can read it without
  // adding it to its dependency array (which would cause spurious resets).
  const conversationIdRef = useRef(conversationId);
  conversationIdRef.current = conversationId;

  // When a different conversation is loaded from the sidebar, reset state.
  // Do NOT reset serverConversationId when the effect fires because
  // handleConversationUpdate updated activeConversation to the same conversation
  // that is already open — that would break multi-turn Supabase session continuity.
  useEffect(() => {
    if (initialConversation) {
      setMessages(initialConversation.messages);
      setConversationId(initialConversation.id);
      if (initialConversation.id !== conversationIdRef.current) {
        setServerConversationId(null);
      }
    } else {
      setMessages([]);
      setConversationId(newConversationId());
      setServerConversationId(null);
    }
    setGuestLimitReached(false);
    setSuggestions([]);
    setShowSuggestions(false);
    setSimilarQuestions([]);
    setShowSimilarPanel(false);
    similarDismissedInput.current = null;
    setRelatedQuestions([]);
    setRelatedLoading(false);
    setHistoryStack([]);
  }, [initialConversation?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pre-fill input from leaderboard "Ask this" link (?q=...)
  useEffect(() => {
    if (initialQuestion) {
      setInput(initialQuestion);
      textareaRef.current?.focus();
    }
  }, [initialQuestion]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [input]);

  // Debounced suggestion fetch
  useEffect(() => {
    if (suggestDebounceRef.current) clearTimeout(suggestDebounceRef.current);
    if (input.length < 3) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    suggestDebounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/questions/suggest?q=${encodeURIComponent(input)}`);
        if (!res.ok) return;
        const json = await res.json();
        setSuggestions(json.suggestions ?? []);
        setShowSuggestions((json.suggestions ?? []).length > 0);
        setSuggestionIndex(-1);
      } catch {
        // silently ignore network errors for suggestions
      }
    }, 300);
    return () => { if (suggestDebounceRef.current) clearTimeout(suggestDebounceRef.current); };
  }, [input]);

  // Debounced similar-question detection (500ms, threshold 0.92 on backend)
  useEffect(() => {
    if (similarDebounceRef.current) clearTimeout(similarDebounceRef.current);
    // Respect dismissal: don't re-show for the exact input that was dismissed
    if (similarDismissedInput.current !== null && input === similarDismissedInput.current) return;
    // New input — reset dismissal so panel can reappear
    if (similarDismissedInput.current !== null && input !== similarDismissedInput.current) {
      similarDismissedInput.current = null;
    }
    if (input.length < 10) {
      setSimilarQuestions([]);
      setShowSimilarPanel(false);
      return;
    }
    similarDebounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/qa/similar?q=${encodeURIComponent(input)}`);
        if (!res.ok) return;
        const json = await res.json();
        const qs: SimilarQuestion[] = json.similar ?? [];
        setSimilarQuestions(qs);
        setShowSimilarPanel(qs.length > 0);
      } catch {
        // silently ignore network errors
      }
    }, 500);
    return () => { if (similarDebounceRef.current) clearTimeout(similarDebounceRef.current); };
  }, [input]); // eslint-disable-line react-hooks/exhaustive-deps

  function persistConversation(msgs: Message[], cid: string, serverConvId?: string | null) {
    if (!userId) return;
    const firstQuestion = msgs.find((m) => m.role === 'user')?.content ?? 'Untitled';
    const existing = loadConversations(userId).find((c) => c.id === cid);
    const conversation: Conversation = {
      id: cid,
      ...(serverConvId ? { serverConversationId: serverConvId } : (existing?.serverConversationId ? { serverConversationId: existing.serverConversationId } : {})),
      userId,
      title: titleFromQuestion(firstQuestion),
      messages: msgs,
      createdAt: existing?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
    };
    saveConversation(userId, conversation);
    onConversationUpdate?.(conversation);
  }

  function fetchRelated(question: string) {
    setRelatedLoading(true);
    setRelatedQuestions([]);
    fetch('/api/qa/related', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question }),
    })
      .then((r) => (r.ok ? r.json() : Promise.resolve({ related: [] })))
      .then((data: { related?: RelatedQuestion[] }) => { setRelatedQuestions(data.related ?? []); })
      .catch(() => { setRelatedQuestions([]); })
      .finally(() => { setRelatedLoading(false); });
  }

  async function submit(questionOverride?: string, historyOverride?: Message[]) {
    const question = (questionOverride ?? input).trim();
    if (!question || loading) return;

    const baseMessages = historyOverride ?? messages;

    // Capture before state changes — used to trigger first-answer celebration
    const wasFirstEver = baseMessages.length === 0 && !localStorage.getItem('wu_onboarding_seen');

    track('question_asked');
    if (baseMessages.length === 0) track('conversation_started');

    // Dismiss takeaways card when a new conversation begins
    if (takeawaysState !== null) {
      if (takeawaysPollRef.current) {
        clearInterval(takeawaysPollRef.current);
        takeawaysPollRef.current = null;
      }
      setTakeawaysState(null);
      setSessionTakeaways(null);
      takeawaysSessionIdRef.current = null;
    }

    setInput('');
    setShowSimilarPanel(false);
    setSimilarQuestions([]);
    similarDismissedInput.current = null;
    setRelatedQuestions([]);
    setRelatedLoading(false);
    const newMessages: Message[] = [...baseMessages, { role: 'user', content: question }];
    setMessages(newMessages);
    setLoading(true);

    try {
      const history = baseMessages.map((m) => ({ role: m.role, content: m.content }));
      const res = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question,
          history,
          walletAddress,
          ...(serverConversationId ? { conversationId: serverConversationId } : {}),
          ...(selectedTeacher ? { teacher: selectedTeacher } : {}),
          ...(answerStyle !== 'detailed' ? { answerStyle } : {}),
          ...(!essayContextDismissed && essayContext
            ? { essaySlug: essayContext.sessionSlug, courseSlug: essayContext.courseSlug }
            : {}),
        }),
      });

      if (!res.ok) {
        if (res.status === 429) {
          const resetHeader = res.headers.get('X-RateLimit-Reset');
          const resetAt = resetHeader
            ? new Date(parseInt(resetHeader, 10) * 1000).toISOString()
            : new Date(Date.now() + 3600000).toISOString();
          setRateLimit({ remaining: 0, resetAt });
          setMessages(messages); // revert user message since no answer is coming
        } else if (res.status === 402) {
          setMessages(newMessages); // keep user message visible
          setInput(question); // restore so user can resubmit after upgrading/signing in
          if (userId) {
            // Authenticated free-tier user hit daily limit
            setFreeTierLimitReached(true);
          } else {
            // Unauthenticated guest hit IP-based limit
            setGuestLimitReached(true);
          }
        } else {
          await res.json().catch(() => null);
          setMessages([...newMessages, { role: 'assistant', content: 'Something went wrong — try again.', error: true }]);
        }
        return;
      }

      const contentType = res.headers.get('content-type') ?? '';

      if (contentType.includes('text/event-stream') && res.body) {
        // ── Streaming SSE path ──────────────────────────────────────────
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let streamingStarted = false;
        let accumulatedContent = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // Parse complete SSE events separated by double newline
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
              accumulatedContent += event.delta;
              if (!streamingStarted) {
                streamingStarted = true;
                setLoading(false);
                setMessages([...newMessages, { role: 'assistant', content: accumulatedContent, streaming: true }]);
              } else {
                setMessages((prev) => {
                  const msgs = [...prev];
                  const last = msgs[msgs.length - 1];
                  if (last?.role === 'assistant' && last.streaming) {
                    msgs[msgs.length - 1] = { ...last, content: accumulatedContent };
                  }
                  return msgs;
                });
              }
            } else if (event.done === true) {
              const convId = typeof event.conversationId === 'string' ? event.conversationId : null;
              if (convId && !serverConversationId) setServerConversationId(convId);

              const finalMessages: Message[] = [
                ...newMessages,
                {
                  role: 'assistant',
                  content: accumulatedContent,
                  sources: Array.isArray(event.sources) ? (event.sources as Source[]) : [],
                  followUps: Array.isArray(event.followUps) ? (event.followUps as string[]) : [],
                  answerId: typeof event.answerId === 'string' ? event.answerId : undefined,
                  fromCache: event.cached === true,
                },
              ];
              setMessages(finalMessages);
              persistConversation(finalMessages, conversationId, convId ?? serverConversationId);
              if (event.rateLimit && typeof event.rateLimit === 'object') {
                const rl = event.rateLimit as { remaining?: unknown; resetAt?: unknown };
                if (typeof rl.remaining === 'number' && typeof rl.resetAt === 'string') {
                  setRateLimit({ remaining: rl.remaining, resetAt: rl.resetAt });
                }
              }
              if (typeof event.guestQueriesRemaining === 'number') {
                setGuestQueriesRemaining(event.guestQueriesRemaining);
                if (event.guestQueriesRemaining === 0) setGuestLimitReached(true);
              }
              if (typeof event.userQuestionsRemaining === 'number') {
                setUserQuestionsRemaining(event.userQuestionsRemaining);
                if (event.userQuestionsRemaining === 0) setFreeTierLimitReached(true);
              }
              if (wasFirstEver) {
                localStorage.setItem('wu_onboarding_seen', '1');
                setShowOnboardingPanel(false);
                setShowCelebration(true);
              }
              fetchRelated(question);
            } else if (typeof event.error === 'string') {
              setMessages([...newMessages, { role: 'assistant', content: event.error, error: true }]);
            }
          }
        }

        // If stream ended with no done event (unexpected close), finalize with what we have
        if (streamingStarted && accumulatedContent) {
          setMessages((prev) => {
            const msgs = [...prev];
            const last = msgs[msgs.length - 1];
            if (last?.role === 'assistant' && last.streaming) {
              msgs[msgs.length - 1] = { ...last, streaming: undefined };
              persistConversation(msgs, conversationId, serverConversationId);
            }
            return msgs;
          });
        }
      } else {
        // ── Non-streaming JSON fallback ─────────────────────────────────
        const data = await res.json();
        const newServerConvId = data.conversationId ?? null;
        if (newServerConvId && !serverConversationId) {
          setServerConversationId(newServerConvId);
        }
        const finalMessages: Message[] = [
          ...newMessages,
          {
            role: 'assistant',
            content: data.answer ?? '',
            sources: data.sources ?? [],
            followUps: data.followUps ?? [],
            answerId: data.answerId ?? undefined,
            fromCache: data.cached === true,
          },
        ];
        setMessages(finalMessages);
        persistConversation(finalMessages, conversationId, newServerConvId ?? serverConversationId);
        if (data.rateLimit && typeof data.rateLimit.remaining === 'number' && typeof data.rateLimit.resetAt === 'string') {
          setRateLimit({ remaining: data.rateLimit.remaining, resetAt: data.rateLimit.resetAt });
        }
        if (typeof data.guestQueriesRemaining === 'number') {
          setGuestQueriesRemaining(data.guestQueriesRemaining);
          if (data.guestQueriesRemaining === 0) setGuestLimitReached(true);
        }
        if (typeof data.userQuestionsRemaining === 'number') {
          setUserQuestionsRemaining(data.userQuestionsRemaining);
          if (data.userQuestionsRemaining === 0) setFreeTierLimitReached(true);
        }
        if (wasFirstEver) {
          localStorage.setItem('wu_onboarding_seen', '1');
          setShowOnboardingPanel(false);
          setShowCelebration(true);
        }
        fetchRelated(question);
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: 'Something went wrong — try again.', error: true },
      ]);
    } finally {
      setLoading(false);
    }
  }

  /**
   * submitCompare — fires parallel /api/ask requests for each selected teacher
   * and streams the responses into side-by-side columns.
   */
  async function submitCompare(questionOverride?: string) {
    const question = (questionOverride ?? input).trim();
    if (!question || loading || compareTeachers.length < 2) return;

    const baseMessages = messages;
    track('question_asked');
    track('compare_mode_used');

    setInput('');
    setRelatedQuestions([]);
    setRelatedLoading(false);

    const newMessages: Message[] = [
      ...baseMessages,
      { role: 'user', content: question },
    ];

    // Initial compare message with empty, streaming columns
    const initialCompare: Message = {
      role: 'assistant',
      content: '',
      compareColumns: compareTeachers.map((t) => ({
        teacher: t,
        content: '',
        sources: [],
        streaming: true,
        followUps: [],
      })),
    };
    setMessages([...newMessages, initialCompare]);
    setLoading(true);

    const history = baseMessages.map((m) => ({ role: m.role, content: m.content }));

    await Promise.all(
      compareTeachers.map(async (teacher, colIdx) => {
        try {
          const res = await fetch('/api/ask', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              question,
              history,
              walletAddress,
              teacher,
              ...(answerStyle !== 'detailed' ? { answerStyle } : {}),
            }),
          });

          if (!res.ok) {
            if (res.status === 402) {
              if (userId) setFreeTierLimitReached(true);
              else setGuestLimitReached(true);
            }
            const errText = res.status === 402 ? 'Daily limit reached — upgrade to Pro for unlimited access.' : 'Something went wrong — try again.';
            setMessages((prev) => {
              const msgs = [...prev];
              const last = msgs[msgs.length - 1];
              if (last?.compareColumns) {
                const cols = [...last.compareColumns];
                cols[colIdx] = { ...cols[colIdx], content: errText, streaming: false };
                msgs[msgs.length - 1] = { ...last, compareColumns: cols };
              }
              return msgs;
            });
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
                  const content = accumulated;
                  setMessages((prev) => {
                    const msgs = [...prev];
                    const last = msgs[msgs.length - 1];
                    if (last?.compareColumns) {
                      const cols = [...last.compareColumns];
                      cols[colIdx] = { ...cols[colIdx], content, streaming: true };
                      msgs[msgs.length - 1] = { ...last, compareColumns: cols };
                    }
                    return msgs;
                  });
                } else if (event.done === true) {
                  const sources = Array.isArray(event.sources) ? (event.sources as Source[]) : [];
                  const followUps = Array.isArray(event.followUps) ? (event.followUps as string[]) : [];
                  const finalContent = accumulated;

                  // Update global rate limit / quota from the first column's done event
                  if (colIdx === 0) {
                    if (event.rateLimit && typeof event.rateLimit === 'object') {
                      const rl = event.rateLimit as { remaining?: unknown; resetAt?: unknown };
                      if (typeof rl.remaining === 'number' && typeof rl.resetAt === 'string') {
                        setRateLimit({ remaining: rl.remaining, resetAt: rl.resetAt });
                      }
                    }
                    if (typeof event.guestQueriesRemaining === 'number') {
                      setGuestQueriesRemaining(event.guestQueriesRemaining);
                      if (event.guestQueriesRemaining === 0) setGuestLimitReached(true);
                    }
                    if (typeof event.userQuestionsRemaining === 'number') {
                      setUserQuestionsRemaining(event.userQuestionsRemaining);
                      if (event.userQuestionsRemaining === 0) setFreeTierLimitReached(true);
                    }
                  }

                  setMessages((prev) => {
                    const msgs = [...prev];
                    const last = msgs[msgs.length - 1];
                    if (last?.compareColumns) {
                      const cols = [...last.compareColumns];
                      cols[colIdx] = { ...cols[colIdx], content: finalContent, sources, followUps, streaming: false };
                      msgs[msgs.length - 1] = { ...last, compareColumns: cols };
                    }
                    return msgs;
                  });
                } else if (typeof event.error === 'string') {
                  setMessages((prev) => {
                    const msgs = [...prev];
                    const last = msgs[msgs.length - 1];
                    if (last?.compareColumns) {
                      const cols = [...last.compareColumns];
                      cols[colIdx] = { ...cols[colIdx], content: event.error as string, streaming: false };
                      msgs[msgs.length - 1] = { ...last, compareColumns: cols };
                    }
                    return msgs;
                  });
                }
              }
            }

            // Finalize if stream ended without a done event
            setMessages((prev) => {
              const msgs = [...prev];
              const last = msgs[msgs.length - 1];
              if (last?.compareColumns && last.compareColumns[colIdx]?.streaming) {
                const cols = [...last.compareColumns];
                cols[colIdx] = { ...cols[colIdx], streaming: false };
                msgs[msgs.length - 1] = { ...last, compareColumns: cols };
              }
              return msgs;
            });
          } else {
            // Non-streaming fallback
            const data = await res.json();
            setMessages((prev) => {
              const msgs = [...prev];
              const last = msgs[msgs.length - 1];
              if (last?.compareColumns) {
                const cols = [...last.compareColumns];
                cols[colIdx] = {
                  ...cols[colIdx],
                  content: data.answer ?? '',
                  sources: data.sources ?? [],
                  followUps: data.followUps ?? [],
                  streaming: false,
                };
                msgs[msgs.length - 1] = { ...last, compareColumns: cols };
              }
              return msgs;
            });
          }
        } catch {
          setMessages((prev) => {
            const msgs = [...prev];
            const last = msgs[msgs.length - 1];
            if (last?.compareColumns) {
              const cols = [...last.compareColumns];
              cols[colIdx] = { ...cols[colIdx], content: 'Something went wrong — try again.', streaming: false };
              msgs[msgs.length - 1] = { ...last, compareColumns: cols };
            }
            return msgs;
          });
        }
      })
    );

    setLoading(false);

    // Persist the final compare message
    setMessages((prev) => {
      persistConversation(prev, conversationId, serverConversationId);
      return prev;
    });
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (showSuggestions && suggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSuggestionIndex((i) => Math.min(i + 1, suggestions.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSuggestionIndex((i) => Math.max(i - 1, -1));
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setShowSuggestions(false);
        setSuggestionIndex(-1);
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey && suggestionIndex >= 0) {
        e.preventDefault();
        const selected = suggestions[suggestionIndex];
        setInput(selected.question);
        setShowSuggestions(false);
        setSuggestionIndex(-1);
        void submit(selected.question);
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (compareMode && compareTeachers.length >= 2) {
        void submitCompare();
      } else {
        void submit();
      }
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setShowSuggestions(false);
    if (compareMode && compareTeachers.length >= 2) {
      void submitCompare();
    } else {
      void submit();
    }
  }

  function handleRelatedClick(rq: RelatedQuestion) {
    // Push current messages onto the history stack, then start a fresh Q&A
    const currentMessages = messages;
    setHistoryStack((prev) => [...prev, currentMessages]);
    setRelatedQuestions([]);
    setRelatedLoading(false);
    void submit(rq.question, []);
  }

  function handleBack() {
    setHistoryStack((prev) => {
      const next = [...prev];
      const previous = next.pop();
      if (previous !== undefined) {
        setMessages(previous);
        setRelatedQuestions([]);
        setRelatedLoading(false);
      }
      return next;
    });
  }

  async function handleClear() {
    // Capture session context before clearing
    const completedSessionId = serverConversationId;
    const hasEnoughTurns = messages.length >= 4; // 2 Q&A pairs minimum

    // Clear conversation UI immediately
    setMessages([]);
    setConversationId(newConversationId());
    setServerConversationId(null);
    setInput('');
    setSimilarQuestions([]);
    setShowSimilarPanel(false);
    similarDismissedInput.current = null;
    setRelatedQuestions([]);
    setRelatedLoading(false);
    setHistoryStack([]);
    onNewChat?.();

    // Trigger async takeaways generation if session had meaningful content
    if (completedSessionId && hasEnoughTurns && userId) {
      // Clear any prior takeaways poll
      if (takeawaysPollRef.current) {
        clearInterval(takeawaysPollRef.current);
        takeawaysPollRef.current = null;
      }
      setSessionTakeaways(null);
      setTakeawaysState('loading');
      takeawaysSessionIdRef.current = completedSessionId;

      // Fire POST — fire-and-forget (server uses `after()` for the OpenAI call)
      const token = await getAccessToken();
      void fetch(`/api/conversations/${completedSessionId}/takeaways`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      }).catch(() => {});

      // Poll for takeaways every 3s, give up after 30s
      const startTime = Date.now();
      takeawaysPollRef.current = setInterval(async () => {
        if (takeawaysSessionIdRef.current !== completedSessionId) {
          // Session changed — stop polling
          clearInterval(takeawaysPollRef.current!);
          takeawaysPollRef.current = null;
          return;
        }
        if (Date.now() - startTime >= 30_000) {
          clearInterval(takeawaysPollRef.current!);
          takeawaysPollRef.current = null;
          setTakeawaysState('timeout');
          return;
        }
        try {
          const pollToken = await getAccessToken();
          const res = await fetch(`/api/conversations/${completedSessionId}/takeaways`, {
            headers: pollToken ? { Authorization: `Bearer ${pollToken}` } : {},
          });
          if (res.ok) {
            const data = await res.json() as { takeaways: string[] };
            if (Array.isArray(data.takeaways) && data.takeaways.length > 0) {
              setSessionTakeaways(data.takeaways);
              setTakeawaysState('ready');
              clearInterval(takeawaysPollRef.current!);
              takeawaysPollRef.current = null;
            }
          }
          // 404 = not yet generated, keep polling
        } catch {
          // network error — keep trying
        }
      }, 3_000);
    }
  }

  // Expose imperative actions to parent (for keyboard shortcuts)
  useEffect(() => {
    if (!actionsRef) return;
    actionsRef.current = {
      focusInput: () => textareaRef.current?.focus(),
      clear: handleClear,
    };
    return () => { actionsRef.current = null; };
  }); // intentionally no dep array — always sync latest handleClear

  const isEmpty = messages.length === 0 && !loading;
  const showRelatedPanel = relatedLoading || relatedQuestions.length > 0;

  return (
    <>
    {upgradeFeature && (
      <UpgradePrompt
        feature={upgradeFeature}
        onClose={() => setUpgradeFeature(null)}
      />
    )}
    <div className="flex flex-col h-full" style={{ background: 'var(--bg)' }}>
      {/* Thread header — only visible when conversation has content */}
      {!isEmpty && (
        <div
          className="flex items-center justify-between px-4 py-2 border-b flex-shrink-0"
          style={{ borderColor: 'var(--border)', background: 'var(--bg)' }}
        >
          <div className="flex items-center gap-2">
            {historyStack.length > 0 && (
              <button
                onClick={handleBack}
                className="flex items-center gap-1.5 text-xs px-3 min-h-[44px] rounded-full border transition-colors"
                style={{ borderColor: 'var(--border)', color: 'var(--sage)' }}
                aria-label="Back to previous question"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
                </svg>
                Back
              </button>
            )}
            <ExportConversationButton messages={messages} />
          </div>
          <button
            onClick={handleClear}
            disabled={loading}
            className="flex items-center gap-1.5 text-xs px-3 min-h-[44px] rounded-full border transition-colors disabled:opacity-40"
            style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
            aria-label="Clear conversation"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
            </svg>
            New conversation
          </button>
        </div>
      )}

      {/* Guest mode banner — shown only after first question */}
      {!userId && guestQueriesRemaining !== null && (
        <div
          className="flex items-center justify-between px-4 py-2 border-b flex-shrink-0"
          style={{ background: 'var(--bg-chip)', borderColor: 'var(--border)' }}
        >
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {guestQueriesRemaining > 0
              ? `${guestQueriesRemaining} free question${guestQueriesRemaining !== 1 ? 's' : ''} remaining — sign in to get 5/day`
              : 'Sign in to get 5 free questions/day and save your history'
            }
          </span>
          <button
            onClick={login}
            className="text-xs px-3 py-1 rounded-full flex-shrink-0 ml-3"
            style={{ background: 'var(--sage)', color: '#fff' }}
          >
            Sign in
          </button>
        </div>
      )}

      {/* First-answer celebration banner */}
      {showCelebration && (
        <div
          className="flex items-center justify-between px-4 py-2.5 flex-shrink-0 text-sm"
          style={{ background: 'var(--celebration-bg)', borderBottom: '1px solid var(--celebration-border)' }}
        >
          <span style={{ color: 'var(--celebration-text)' }}>
            Nice! Your conversation is saved.{' '}
            <a href="/community" style={{ textDecoration: 'underline', color: 'var(--celebration-link)' }}>
              Explore the Community
            </a>{' '}
            or ask a follow-up.
          </span>
          <button
            onClick={() => setShowCelebration(false)}
            aria-label="Dismiss"
            style={{ color: 'var(--celebration-close)', marginLeft: '12px', flexShrink: 0 }}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Two-pane layout: left = Q&A + input; right = related questions (desktop only) */}
      <div className="flex-1 overflow-hidden flex flex-col lg:flex-row">
        {/* Left pane */}
        <div className="flex flex-col flex-1 min-w-0 overflow-hidden">

      {/* Conversation thread */}
      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="max-w-2xl mx-auto space-y-6">
          {/* Key Takeaways card — shown after session completion while polling or when ready */}
          {isEmpty && takeawaysState !== null && (
            <div
              className="rounded-2xl p-5 mb-2"
              style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}
            >
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold" style={{ color: 'var(--sage-dark)' }}>
                  Key Takeaways
                </h3>
                {takeawaysState === 'loading' && (
                  <span className="text-xs" style={{ color: 'var(--text-faint)' }}>Generating…</span>
                )}
                {isAdmin && takeawaysState === 'ready' && takeawaysSessionIdRef.current && (
                  <button
                    className="text-xs underline"
                    style={{ color: 'var(--text-faint)' }}
                    onClick={async () => {
                      const sid = takeawaysSessionIdRef.current;
                      if (!sid) return;
                      setTakeawaysState('loading');
                      setSessionTakeaways(null);
                      const token = await getAccessToken();
                      void fetch(`/api/conversations/${sid}/takeaways`, {
                        method: 'POST',
                        headers: token ? { Authorization: `Bearer ${token}` } : {},
                      }).catch(() => {});
                      const start = Date.now();
                      const regen = setInterval(async () => {
                        if (Date.now() - start >= 30_000) {
                          clearInterval(regen);
                          setTakeawaysState('timeout');
                          return;
                        }
                        try {
                          const t = await getAccessToken();
                          const res = await fetch(`/api/conversations/${sid}/takeaways`, {
                            headers: t ? { Authorization: `Bearer ${t}` } : {},
                          });
                          if (res.ok) {
                            const d = await res.json() as { takeaways: string[] };
                            if (Array.isArray(d.takeaways) && d.takeaways.length > 0) {
                              setSessionTakeaways(d.takeaways);
                              setTakeawaysState('ready');
                              clearInterval(regen);
                            }
                          }
                        } catch { /* keep trying */ }
                      }, 3_000);
                    }}
                  >
                    Regenerate
                  </button>
                )}
              </div>

              {takeawaysState === 'loading' && (
                <div className="space-y-2">
                  {[1, 2, 3].map((n) => (
                    <div
                      key={n}
                      className="h-4 rounded animate-pulse"
                      style={{ background: 'var(--bg-chip)', width: n === 3 ? '60%' : '100%' }}
                    />
                  ))}
                </div>
              )}

              {takeawaysState === 'ready' && sessionTakeaways && (
                <ol className="space-y-2">
                  {sessionTakeaways.map((t, i) => (
                    <li key={i} className="flex gap-2.5 text-sm" style={{ color: 'var(--text-warm)' }}>
                      <span
                        className="flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-xs font-semibold"
                        style={{ background: 'var(--bg-chip)', color: 'var(--sage)' }}
                      >
                        {i + 1}
                      </span>
                      <span className="leading-relaxed">{t}</span>
                    </li>
                  ))}
                </ol>
              )}

              {takeawaysState === 'timeout' && (
                <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
                  Could not generate takeaways — the session may have timed out.
                </p>
              )}
            </div>
          )}

          {isEmpty && showOnboardingPanel === true && (
            /* First-time user: full onboarding welcome panel */
            <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
              <div
                className="w-14 h-14 rounded-full flex items-center justify-center mb-5"
                style={{ background: 'var(--bg-chip)' }}
              >
                <svg
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
                    d="M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 1 1 6 0v8.25a3 3 0 0 1-3 3Z"
                  />
                </svg>
              </div>
              <h2 className="font-semibold text-base mb-1" style={{ color: 'var(--sage-dark)' }}>
                Ask anything about mindfulness
              </h2>
              <p className="text-xs mb-4 max-w-xs" style={{ color: 'var(--text-muted)' }}>
                Answers drawn from 760+ hours of Waking Up content — talks, guided meditations, and conversations.
              </p>
              {!walletAddress && (
                <p
                  className="text-xs mb-5 px-3 py-2 rounded-lg max-w-xs"
                  style={{ background: 'var(--bg-surface)', color: 'var(--sage)' }}
                >
                  Connect a wallet in your{' '}
                  <a href="/profile" style={{ textDecoration: 'underline' }}>
                    profile
                  </a>{' '}
                  to save your conversation history.
                </p>
              )}
              <div className="flex flex-col gap-2 w-full max-w-sm">
                {STARTER_QUESTIONS.map((prompt) => (
                  <button
                    key={prompt}
                    onClick={() => setInput(prompt)}
                    className="text-left rounded-xl px-4 py-3 text-sm transition-colors"
                    style={{
                      background: 'var(--bg-surface)',
                      color: 'var(--text-warm)',
                      border: '1px solid var(--border-subtle)',
                    }}
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          )}

          {isEmpty && showOnboardingPanel === false && (
            /* Returning user: minimal empty state */
            <div className="flex flex-col items-center justify-center h-64 text-center">
              <p className="text-sm font-medium" style={{ color: 'var(--text-warm)' }}>
                Ask a question to explore mindfulness teachings
              </p>
              <p className="text-xs mt-1 mb-5" style={{ color: 'var(--text-muted)' }}>
                Sourced from 760+ hours of mindfulness content
              </p>
              <div className="flex flex-wrap justify-center gap-2 max-w-md">
                {STARTER_QUESTIONS.map((prompt) => (
                  <button
                    key={prompt}
                    onClick={() => setInput(prompt)}
                    className="rounded-full px-3 py-1.5 text-xs transition-colors"
                    style={{
                      background: 'var(--bg-surface)',
                      color: 'var(--text-warm)',
                      border: '1px solid var(--border-subtle)',
                    }}
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg, i) => (
            <div key={i}>
              {msg.role === 'user' ? (
                <div className="flex justify-end">
                  <div
                    className="rounded-2xl rounded-tr-sm px-4 py-3 max-w-sm text-sm leading-relaxed"
                    style={{
                      background: 'var(--sage)',
                      color: '#fff',
                    }}
                  >
                    {msg.content}
                  </div>
                </div>
              ) : msg.compareColumns ? (
                <CompareColumns columns={msg.compareColumns} />
              ) : (
                <div className="flex justify-start">
                  <AssistantMessage
                    content={msg.content}
                    sources={msg.sources}
                    followUps={loading || msg.streaming ? [] : msg.followUps}
                    isError={msg.error}
                    onFollowUp={submit}
                    answerId={msg.answerId}
                    question={messages[i - 1]?.role === 'user' ? messages[i - 1].content : undefined}
                    streaming={msg.streaming}
                    fromCache={msg.fromCache}
                  />
                </div>
              )}
            </div>
          ))}

          {guestLimitReached && (
            <div className="flex justify-start">
              <div
                className="max-w-xl w-full rounded-2xl rounded-tl-sm px-4 py-4"
                style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}
              >
                <p className="text-sm font-medium mb-1" style={{ color: 'var(--sage-dark)' }}>
                  You&apos;ve used all 3 free questions
                </p>
                <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>
                  Connect your wallet for unlimited questions and to save your history.
                </p>
                <button
                  onClick={login}
                  className="text-xs px-4 py-2 rounded-full font-medium"
                  style={{ background: 'var(--sage)', color: '#fff' }}
                >
                  Connect wallet →
                </button>
              </div>
            </div>
          )}

          {freeTierLimitReached && (
            <div className="flex justify-start">
              <div
                className="max-w-xl w-full rounded-2xl rounded-tl-sm px-4 py-4"
                style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}
              >
                <p className="text-sm font-medium mb-1" style={{ color: 'var(--sage-dark)' }}>
                  You&apos;ve used all 5 free questions today
                </p>
                <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>
                  Upgrade to Pro for unlimited access. Your question counter resets at midnight UTC.
                </p>
                <button
                  onClick={() => setUpgradeFeature('unlimited_qa')}
                  className="text-xs px-4 py-2 rounded-full font-medium"
                  style={{ background: 'var(--sage)', color: '#fff' }}
                >
                  Upgrade to Pro →
                </button>
              </div>
            </div>
          )}

          {loading && !compareMode && (
            <div className="flex justify-start">
              <ResponseSkeleton />
            </div>
          )}

          {/* Mobile only: related questions inline below last answer */}
          {!loading && showRelatedPanel && (
            <div className="lg:hidden mt-2">
              <RelatedQuestionsPanel
                loading={relatedLoading}
                questions={relatedQuestions}
                onSelect={handleRelatedClick}
              />
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </div>

      {/* Input bar */}
      <div
        className="border-t px-4 py-4"
        style={{ borderColor: 'var(--border)', background: 'var(--bg)' }}
      >
        {rateLimit?.remaining === 0 && (
          <div
            className="max-w-2xl mx-auto mb-3 rounded-xl px-4 py-2.5 text-sm"
            style={{
              background: 'var(--error-bg)',
              border: '1px solid var(--error-border)',
              color: 'var(--error-text)',
            }}
          >
            You&apos;ve used all 20 questions for this hour. Resets at {formatResetTime(rateLimit.resetAt)}.
          </div>
        )}
        {/* Essay context chip — dismissable */}
        {essayContext && !essayContextDismissed && (
          <div className="max-w-2xl mx-auto mb-3 flex items-center gap-2">
            <div
              className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-full flex-shrink min-w-0"
              style={{ background: 'var(--bg-chip)', color: 'var(--sage)' }}
            >
              <svg className="w-3 h-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25" />
              </svg>
              <span className="truncate">Reading: {essayContext.title}</span>
            </div>
            <button
              type="button"
              onClick={() => setEssayContextDismissed(true)}
              aria-label="Dismiss essay context"
              className="flex-shrink-0 p-0.5 rounded"
              style={{ color: 'var(--text-faint)' }}
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}

        {/* Teacher filter / compare selector */}
        {teachers.length > 0 && (
          <div className="max-w-2xl mx-auto mb-3">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs flex-shrink-0" style={{ color: 'var(--text-faint)' }}>
                Teacher:
              </span>

              {!compareMode ? (
                <>
                  <button
                    type="button"
                    onClick={() => { setSelectedTeacher(null); localStorage.removeItem(TEACHER_STORAGE_KEY); }}
                    className="text-xs px-2.5 py-1 rounded-full transition-colors flex-shrink-0"
                    style={{
                      background: selectedTeacher === null ? 'var(--sage)' : 'var(--bg-chip)',
                      color: selectedTeacher === null ? '#fff' : 'var(--text-muted)',
                      border: '1px solid transparent',
                    }}
                  >
                    All
                  </button>
                  {teachers.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => { setSelectedTeacher(t); localStorage.setItem(TEACHER_STORAGE_KEY, t); }}
                      className="text-xs px-2.5 py-1 rounded-full transition-colors flex-shrink-0"
                      style={{
                        background: selectedTeacher === t ? 'var(--sage)' : 'var(--bg-chip)',
                        color: selectedTeacher === t ? '#fff' : 'var(--text-muted)',
                        border: '1px solid transparent',
                      }}
                    >
                      {t}
                    </button>
                  ))}
                </>
              ) : (
                <>
                  {teachers.map((t) => {
                    const isSelected = compareTeachers.includes(t);
                    const wouldBeThird = compareTeachers.length >= 2 && !isSelected;
                    const needsPro = wouldBeThird && userTier === 'free';
                    return (
                      <button
                        key={t}
                        type="button"
                        onClick={() => {
                          if (isSelected) {
                            setCompareTeachers(compareTeachers.filter((x) => x !== t));
                          } else if (compareTeachers.length >= 3) {
                            // Already at max — no-op
                          } else if (needsPro) {
                            setUpgradeFeature('compare_teachers');
                          } else {
                            setCompareTeachers([...compareTeachers, t]);
                          }
                        }}
                        className="text-xs px-2.5 py-1 rounded-full transition-colors flex-shrink-0"
                        style={{
                          background: isSelected ? 'var(--sage)' : 'var(--bg-chip)',
                          color: isSelected ? '#fff' : needsPro ? 'var(--text-faint)' : 'var(--text-muted)',
                          border: isSelected ? '1px solid transparent' : '1px solid var(--border-subtle)',
                          opacity: needsPro ? 0.6 : 1,
                        }}
                        title={needsPro ? 'Requires Pro' : undefined}
                      >
                        {isSelected ? '✓ ' : ''}{t}{needsPro ? ' ★' : ''}
                      </button>
                    );
                  })}
                </>
              )}

              {/* Compare toggle button */}
              <button
                type="button"
                onClick={() => { setCompareMode(!compareMode); setCompareTeachers([]); }}
                className="text-xs px-2.5 py-1 rounded-full transition-colors flex-shrink-0"
                style={
                  compareMode
                    ? { background: 'var(--sage)', color: '#fff', border: '1px solid transparent' }
                    : { background: 'transparent', color: 'var(--sage)', border: '1px solid var(--sage)' }
                }
              >
                {compareMode ? 'Exit compare' : 'Compare'}
              </button>
            </div>

            {/* Compare mode status line */}
            {compareMode && (
              <p className="text-xs mt-1.5 px-0.5" style={{ color: 'var(--text-faint)' }}>
                {compareTeachers.length < 2
                  ? 'Select 2–3 teachers to compare'
                  : `Compare uses ${compareTeachers.length} of your daily questions per submit`}
              </p>
            )}
          </div>
        )}
        <form onSubmit={handleSubmit} className="max-w-2xl mx-auto">
          {/* Similar-question dedup panel */}
          {showSimilarPanel && similarQuestions.length > 0 && (
            <div
              className="mb-3 rounded-xl px-3 py-2.5"
              style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
                  Others have asked something similar
                </span>
                <button
                  type="button"
                  onClick={() => {
                    similarDismissedInput.current = input;
                    setShowSimilarPanel(false);
                  }}
                  aria-label="Dismiss similar questions"
                  className="text-xs leading-none"
                  style={{ color: 'var(--text-faint)' }}
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {similarQuestions.map((sq, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      setShowSimilarPanel(false);
                      setSimilarQuestions([]);
                      void submit(sq.question);
                    }}
                    className="text-xs rounded-full px-3 py-1.5 text-left transition-colors"
                    style={{
                      background: 'var(--bg-chip)',
                      color: 'var(--sage-dark)',
                      border: '1px solid var(--border-subtle)',
                      maxWidth: '100%',
                    }}
                    title={sq.answer_snippet}
                  >
                    {sq.question}
                  </button>
                ))}
              </div>
            </div>
          )}
          {/* Answer style segmented control */}
          <div className="flex items-center gap-1 mb-2 px-1">
            <span className="text-xs mr-1" style={{ color: 'var(--text-faint)' }}>Style:</span>
            {([
              { value: 'brief', label: 'Brief' },
              { value: 'detailed', label: 'Detailed' },
              { value: 'citations_first', label: 'Sources first' },
            ] as { value: AnswerStyle; label: string }[]).map(({ value, label }) => (
              <button
                key={value}
                type="button"
                onClick={() => setAnswerStyle(value)}
                className="text-xs px-2.5 py-1 rounded-full transition-colors"
                style={
                  answerStyle === value
                    ? { background: 'var(--sage)', color: '#fff', border: '1px solid transparent' }
                    : { background: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--border-subtle)' }
                }
              >
                {label}
              </button>
            ))}
          </div>

          <div style={{ position: 'relative' }}>
            <div
              className="flex items-end gap-2 rounded-2xl px-4 py-3"
              style={{
                background: 'var(--bg-input)',
                border: '1px solid var(--border)',
                boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
              }}
            >
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value.slice(0, MAX_CHARS))}
                onKeyDown={handleKeyDown}
                onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                onFocus={() => { if (suggestions.length > 0 && input.length >= 3) setShowSuggestions(true); }}
                placeholder="Ask a question…"
                rows={1}
                disabled={loading || rateLimit?.remaining === 0}
                maxLength={MAX_CHARS}
                aria-label="Ask a question"
                aria-controls={showSuggestions && suggestions.length > 0 ? 'suggestions-listbox' : undefined}
                aria-activedescendant={suggestionIndex >= 0 ? `suggestion-${suggestionIndex}` : undefined}
                aria-autocomplete="list"
                aria-expanded={showSuggestions && suggestions.length > 0}
                className="flex-1 resize-none bg-transparent text-sm leading-relaxed outline-none placeholder-zinc-400 disabled:opacity-50"
                style={{ color: 'var(--text)', minHeight: '24px' }}
              />
              <button
                type="submit"
                title="Submit (Enter or Ctrl+Enter)"
                aria-label="Submit question"
                disabled={!input.trim() || loading || rateLimit?.remaining === 0 || guestLimitReached || freeTierLimitReached || (compareMode && compareTeachers.length < 2)}
                className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center transition-opacity disabled:opacity-30"
                style={{ background: 'var(--sage)' }}
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

            {/* Suggestion dropdown */}
            {showSuggestions && suggestions.length > 0 && (
              <div
                id="suggestions-listbox"
                role="listbox"
                aria-label="Popular questions"
                className="absolute left-0 right-0 rounded-xl py-1 shadow-lg z-30"
                style={{
                  top: 'calc(100% + 4px)',
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border)',
                }}
              >
                {suggestions.map((s, i) => (
                  <button
                    key={i}
                    id={`suggestion-${i}`}
                    type="button"
                    role="option"
                    aria-selected={i === suggestionIndex}
                    onMouseDown={(e) => {
                      e.preventDefault(); // prevent blur from firing before click
                      setInput(s.question);
                      setShowSuggestions(false);
                      setSuggestionIndex(-1);
                      void submit(s.question);
                    }}
                    onMouseEnter={() => setSuggestionIndex(i)}
                    className="w-full text-left px-4 py-2.5 text-sm flex items-center justify-between gap-3 transition-colors"
                    style={{
                      color: 'var(--text)',
                      background: i === suggestionIndex ? 'var(--bg-chip)' : 'transparent',
                    }}
                  >
                    <span className="truncate">{s.question}</span>
                    <span className="flex-shrink-0 text-xs" style={{ color: 'var(--text-muted)' }}>
                      asked {s.count}×
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="flex justify-between items-center mt-2 px-1">
            {rateLimit !== null && rateLimit.remaining <= 5 && rateLimit.remaining > 0 ? (
              <p className="text-xs" style={{ color: 'var(--warn-text)' }}>
                {rateLimit.remaining} question{rateLimit.remaining !== 1 ? 's' : ''} left — resets at {formatResetTime(rateLimit.resetAt)}
              </p>
            ) : rateLimit !== null && rateLimit.remaining <= 15 && rateLimit.remaining > 0 ? (
              <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
                {rateLimit.remaining} questions remaining this hour
              </p>
            ) : (
              <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
                Press Enter to send · Shift+Enter for new line
              </p>
            )}
            {input.length > 0 && (
              <p
                className="text-xs tabular-nums"
                style={{ color: input.length >= MAX_CHARS ? 'var(--error-text)' : 'var(--text-faint)' }}
              >
                {input.length} / {MAX_CHARS}
              </p>
            )}
          </div>

          {/* Daily usage pill — free-tier authenticated users */}
          {userId && userQuestionsRemaining !== null && userQuestionsRemaining > 0 && (
            <div className="flex items-center gap-2 mt-1.5 px-1">
              <span
                className="text-xs px-2 py-0.5 rounded-full"
                style={
                  userQuestionsRemaining === 1
                    ? { background: 'var(--warn-bg)', color: 'var(--warn-text)', border: '1px solid var(--warn-border)' }
                    : { background: 'var(--bg-chip)', color: 'var(--text-faint)' }
                }
              >
                {userQuestionsRemaining} of 5 remaining today
              </span>
              {userQuestionsRemaining === 1 && (
                <button
                  type="button"
                  onClick={() => setUpgradeFeature('unlimited_qa')}
                  className="text-xs font-medium"
                  style={{ color: 'var(--sage)' }}
                >
                  Upgrade for unlimited →
                </button>
              )}
            </div>
          )}
        </form>
      </div>

        </div>{/* end left pane */}

        {/* Right pane: related questions (desktop only, collapses when empty) */}
        {showRelatedPanel && (
          <div
            className="hidden lg:flex lg:flex-col border-l overflow-y-auto flex-shrink-0"
            style={{ width: '35%', borderColor: 'var(--border)' }}
          >
            <RelatedQuestionsPanel
              loading={relatedLoading}
              questions={relatedQuestions}
              onSelect={handleRelatedClick}
            />
          </div>
        )}
      </div>{/* end two-pane layout */}

      <style>{`
        @keyframes shimmer {
          0%, 100% { opacity: 0.4; }
          50% { opacity: 1; }
        }
        @keyframes blink {
          0%, 49% { opacity: 1; }
          50%, 100% { opacity: 0; }
        }
      `}</style>
    </div>
    </>
  );
}
