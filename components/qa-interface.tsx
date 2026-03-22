'use client';

import { useState, useRef, useEffect, useCallback, type RefObject, type MutableRefObject, FormEvent, KeyboardEvent } from 'react';
import { useAuth } from '@/lib/use-auth';
import {
  type Message,
  type Conversation,
  loadConversations,
  saveConversation,
  newConversationId,
  titleFromQuestion,
} from '@/lib/conversations';
import { addBookmark, removeBookmark, isBookmarked } from '@/lib/bookmarks';
import { exportConversation, exportSingleAnswer } from '@/lib/export';

export type { Message };

interface Source {
  text: string;
  speaker: string;
  source: string;
  score: number;
}

/**
 * Renders answer text with paragraph breaks and clickable [N] citation badges.
 * Double newlines → paragraph break; single newlines → <br>.
 * [N] markers become small superscript buttons that open the sources panel.
 */
function FormattedAnswer({
  text,
  onCitationClick,
}: {
  text: string;
  onCitationClick?: (n: number) => void;
}) {
  const paragraphs = text.split(/\n{2,}/).map((s) => s.trim()).filter(Boolean);
  if (paragraphs.length === 0) return <span>{text}</span>;

  return (
    <>
      {paragraphs.map((para, pIdx) => {
        const parts = para.split(/(\[\d+\])/);
        return (
          <p key={pIdx} style={{ marginTop: pIdx > 0 ? '0.65rem' : 0 }}>
            {parts.map((part, j) => {
              const match = part.match(/^\[(\d+)\]$/);
              if (match && onCitationClick) {
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
                    <span key={k}>{k > 0 && <br />}{line}</span>
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

/** Derive a human-readable label from a raw source filename/path. */
function sourceLabel(source: string): string {
  if (!source) return 'Transcript';
  const base = source.split('/').pop() ?? source;
  return base.replace(/\.[^.]+$/, '').replace(/[_-]/g, ' ');
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
}: {
  sources: Source[];
  open: boolean;
  onToggle: () => void;
  sourceRefs?: RefObject<(HTMLDivElement | null)[]>;
}) {
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
            >
              <div className="flex items-start gap-2">
                <span
                  className="font-mono flex-shrink-0 mt-0.5"
                  style={{ color: 'var(--text-muted)', fontSize: '0.65rem' }}
                >
                  [{i + 1}]
                </span>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold mb-0.5" style={{ color: 'var(--sage-mid)' }}>
                    {sourceLabel(s.source)}
                  </p>
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
  const sourceLabels = sources.slice(0, 3).map((s) => {
    const base = (s.source ?? '').split('/').pop() ?? s.source ?? '';
    return base.replace(/\.[^.]+$/, '').replace(/[_-]/g, ' ');
  });

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
            onClick={() => { exportSingleAnswer(question, answer, sourceLabels, 'markdown'); setOpen(false); }}
          >
            Export as Markdown
          </button>
          <button
            className="w-full text-left px-3 py-2 text-xs transition-colors"
            style={{ color: 'var(--text-warm)' }}
            onClick={() => { exportSingleAnswer(question, answer, sourceLabels, 'plaintext'); setOpen(false); }}
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
  const { getAccessToken } = useAuth();
  const [voted, setVoted] = useState<'up' | 'down' | null>(null);
  const [pending, setPending] = useState(false);

  const submitFeedback = useCallback(
    async (rating: 'up' | 'down') => {
      if (pending) return;
      // Optimistic update
      setVoted(rating);
      setPending(true);
      try {
        const token = await getAccessToken();
        if (!token) return;
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
    [answerId, getAccessToken, pending],
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


// ── Bookmark button ───────────────────────────────────────────────────────────

function BookmarkButton({
  answerId,
  question,
  answer,
}: {
  answerId: string;
  question: string;
  answer: string;
}) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [bookmarked, setBookmarked] = useState(() => {
    if (!userId || typeof window === 'undefined') return false;
    return isBookmarked(userId, answerId);
  });

  if (!userId) return null;

  function toggle() {
    if (!userId) return;
    if (bookmarked) {
      removeBookmark(userId, answerId);
      setBookmarked(false);
    } else {
      addBookmark(userId, {
        answerId,
        question,
        excerpt: answer.slice(0, 200),
        createdAt: Date.now(),
      });
      setBookmarked(true);
    }
  }

  return (
    <button
      onClick={toggle}
      title={bookmarked ? 'Remove bookmark' : 'Bookmark answer'}
      aria-label={bookmarked ? 'Remove bookmark' : 'Bookmark answer'}
      aria-pressed={bookmarked}
      className="flex items-center gap-1 text-xs transition-colors mt-2"
      style={{ color: bookmarked ? 'var(--sage)' : 'var(--text-faint)' }}
    >
      <svg
        className="w-3.5 h-3.5"
        fill={bookmarked ? 'currentColor' : 'none'}
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0Z"
        />
      </svg>
      {bookmarked ? 'Saved' : 'Save'}
    </button>
  );
}

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
}: {
  content: string;
  sources?: Source[];
  followUps?: string[];
  isError?: boolean;
  onFollowUp?: (q: string) => void;
  answerId?: string;
  question?: string;
  streaming?: boolean;
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
            {answerId && question && (
              <BookmarkButton answerId={answerId} question={question} answer={content} />
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

interface QAInterfaceProps {
  initialConversation?: Conversation | null;
  onConversationUpdate?: (conversation: Conversation) => void;
  onNewChat?: () => void;
  initialQuestion?: string;
  actionsRef?: MutableRefObject<QAInterfaceActions | null>;
}

export function QAInterface({ initialConversation, onConversationUpdate, onNewChat, initialQuestion, actionsRef }: QAInterfaceProps) {
  const { user, login } = useAuth();
  const walletAddress = user?.wallet?.address ?? null;
  const userId = user?.id ?? null;

  const MAX_CHARS = 500;
  const [messages, setMessages] = useState<Message[]>(initialConversation?.messages ?? []);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [conversationId, setConversationId] = useState<string>(
    initialConversation?.id ?? newConversationId()
  );
  // Server-generated UUID for Supabase session continuity across turns
  const [serverConversationId, setServerConversationId] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // null = not yet determined (avoids flash on mount)
  const [showOnboardingPanel, setShowOnboardingPanel] = useState<boolean | null>(null);
  const [showCelebration, setShowCelebration] = useState(false);
  const [rateLimit, setRateLimit] = useState<{ remaining: number; resetAt: string } | null>(null);
  const [guestQueriesRemaining, setGuestQueriesRemaining] = useState<number | null>(null);
  const [guestLimitReached, setGuestLimitReached] = useState(false);

  // Suggestion dropdown state
  interface Suggestion { question: string; count: number; }
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [suggestionIndex, setSuggestionIndex] = useState(-1);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const suggestDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Determine first-visit state from localStorage (client-only)
  useEffect(() => {
    setShowOnboardingPanel(!localStorage.getItem('wu_onboarding_seen'));
  }, []);

  // Auto-dismiss celebration banner after 6 seconds
  useEffect(() => {
    if (!showCelebration) return;
    const t = setTimeout(() => setShowCelebration(false), 6000);
    return () => clearTimeout(t);
  }, [showCelebration]);

  // Clear guest limit state when user signs in
  useEffect(() => {
    if (userId) {
      setGuestLimitReached(false);
      setGuestQueriesRemaining(null);
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

  async function submit(questionOverride?: string) {
    const question = (questionOverride ?? input).trim();
    if (!question || loading) return;

    // Capture before state changes — used to trigger first-answer celebration
    const wasFirstEver = messages.length === 0 && !localStorage.getItem('wu_onboarding_seen');

    setInput('');
    const newMessages: Message[] = [...messages, { role: 'user', content: question }];
    setMessages(newMessages);
    setLoading(true);

    try {
      const history = messages.map((m) => ({ role: m.role, content: m.content }));
      const res = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question,
          history,
          walletAddress,
          ...(serverConversationId ? { conversationId: serverConversationId } : {}),
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
          // Guest question limit reached — show CTA, preserve question for resubmission
          setMessages(newMessages); // keep user message visible
          setGuestLimitReached(true);
          setInput(question); // restore so user can resubmit after signing in
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
              }
              if (wasFirstEver) {
                localStorage.setItem('wu_onboarding_seen', '1');
                setShowOnboardingPanel(false);
                setShowCelebration(true);
              }
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
          },
        ];
        setMessages(finalMessages);
        persistConversation(finalMessages, conversationId, newServerConvId ?? serverConversationId);
        if (data.rateLimit && typeof data.rateLimit.remaining === 'number' && typeof data.rateLimit.resetAt === 'string') {
          setRateLimit({ remaining: data.rateLimit.remaining, resetAt: data.rateLimit.resetAt });
        }
        if (typeof data.guestQueriesRemaining === 'number') {
          setGuestQueriesRemaining(data.guestQueriesRemaining);
        }
        if (wasFirstEver) {
          localStorage.setItem('wu_onboarding_seen', '1');
          setShowOnboardingPanel(false);
          setShowCelebration(true);
        }
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
      void submit();
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setShowSuggestions(false);
    void submit();
  }

  function handleClear() {
    setMessages([]);
    setConversationId(newConversationId());
    setServerConversationId(null);
    setInput('');
    onNewChat?.();
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

  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--bg)' }}>
      {/* Thread header — only visible when conversation has content */}
      {!isEmpty && (
        <div
          className="flex items-center justify-between px-4 py-2 border-b flex-shrink-0"
          style={{ borderColor: 'var(--border)', background: 'var(--bg)' }}
        >
          <ExportConversationButton messages={messages} />
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

      {/* Guest mode banner */}
      {!userId && (
        <div
          className="flex items-center justify-between px-4 py-2 border-b flex-shrink-0"
          style={{ background: 'var(--bg-chip)', borderColor: 'var(--border)' }}
        >
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Guest mode —{' '}
            {guestQueriesRemaining !== null
              ? `${guestQueriesRemaining} question${guestQueriesRemaining !== 1 ? 's' : ''} remaining`
              : '3 free questions'
            }. Connect wallet to save history.
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

      {/* Conversation thread */}
      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="max-w-2xl mx-auto space-y-6">
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

          {loading && (
            <div className="flex justify-start">
              <ResponseSkeleton />
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
        <form onSubmit={handleSubmit} className="max-w-2xl mx-auto">
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
                disabled={!input.trim() || loading || rateLimit?.remaining === 0 || guestLimitReached}
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
        </form>
      </div>

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
  );
}
