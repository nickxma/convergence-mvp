'use client';

import { useState, useRef, useEffect, useCallback, type RefObject, FormEvent, KeyboardEvent } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import {
  type Message,
  type Conversation,
  saveConversation,
  newConversationId,
  titleFromQuestion,
} from '@/lib/conversations';

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
  const { getAccessToken } = usePrivy();
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

const STARTER_QUESTIONS = [
  'What is the self?',
  'How do I stop overthinking?',
  'What is the relationship between mindfulness and free will?',
  'How can mindfulness reduce suffering?',
  'What does it mean to be fully present?',
] as const;

interface QAInterfaceProps {
  initialConversation?: Conversation | null;
  onConversationUpdate?: (conversation: Conversation) => void;
  onNewChat?: () => void;
  initialQuestion?: string;
}

export function QAInterface({ initialConversation, onConversationUpdate, onNewChat, initialQuestion }: QAInterfaceProps) {
  const { user } = usePrivy();
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

  function persistConversation(msgs: Message[], cid: string) {
    if (!userId) return;
    const firstQuestion = msgs.find((m) => m.role === 'user')?.content ?? 'Untitled';
    const conversation: Conversation = {
      id: cid,
      userId,
      title: titleFromQuestion(firstQuestion),
      messages: msgs,
      createdAt: Date.now(),
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
        await res.json().catch(() => null);
        setMessages([...newMessages, { role: 'assistant', content: 'Something went wrong — try again.', error: true }]);
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
              persistConversation(finalMessages, conversationId);
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
              persistConversation(msgs, conversationId);
            }
            return msgs;
          });
        }
      } else {
        // ── Non-streaming JSON fallback ─────────────────────────────────
        const data = await res.json();
        if (data.conversationId && !serverConversationId) {
          setServerConversationId(data.conversationId);
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
        persistConversation(finalMessages, conversationId);
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
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    void submit();
  }

  function handleClear() {
    setMessages([]);
    setConversationId(newConversationId());
    setServerConversationId(null);
    setInput('');
    onNewChat?.();
  }

  const isEmpty = messages.length === 0 && !loading;

  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--bg)' }}>
      {/* Thread header — only visible when conversation has content */}
      {!isEmpty && (
        <div
          className="flex items-center justify-end px-4 py-2 border-b flex-shrink-0"
          style={{ borderColor: 'var(--border)', background: 'var(--bg)' }}
        >
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
        <form onSubmit={handleSubmit} className="max-w-2xl mx-auto">
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
              placeholder="Ask a question…"
              rows={1}
              disabled={loading}
              maxLength={MAX_CHARS}
              className="flex-1 resize-none bg-transparent text-sm leading-relaxed outline-none placeholder-zinc-400 disabled:opacity-50"
              style={{ color: 'var(--text)', minHeight: '24px' }}
            />
            <button
              type="submit"
              disabled={!input.trim() || loading}
              className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center transition-opacity disabled:opacity-30"
              style={{ background: 'var(--sage)' }}
            >
              <svg
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
          <div className="flex justify-between items-center mt-2 px-1">
            <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
              Press Enter to send · Shift+Enter for new line
            </p>
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
