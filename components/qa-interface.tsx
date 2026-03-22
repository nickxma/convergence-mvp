'use client';

import { useState, useRef, useEffect, type RefObject, FormEvent, KeyboardEvent } from 'react';
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
                      background: '#ddd5c8',
                      color: '#5a6b52',
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
        style={{ color: '#7d8c6e' }}
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
                background: '#f0ece3',
                borderLeft: '2px solid #b8ccb0',
              }}
            >
              <div className="flex items-start gap-2">
                <span
                  className="font-mono flex-shrink-0 mt-0.5"
                  style={{ color: '#9c9080', fontSize: '0.65rem' }}
                >
                  [{i + 1}]
                </span>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold mb-0.5" style={{ color: '#5a6b52' }}>
                    {sourceLabel(s.source)}
                  </p>
                  {s.speaker && (
                    <p className="mb-1 opacity-70" style={{ color: '#5a6b52' }}>
                      {s.speaker}
                    </p>
                  )}
                  <p className="leading-relaxed" style={{ color: '#5c5248' }}>
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
      style={{ color: copied ? '#7d8c6e' : '#b0a898' }}
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
      style={{ color: copied ? '#7d8c6e' : '#b0a898' }}
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
      style={{ color: '#b0a898' }}
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
          className="text-left text-xs rounded-xl px-3 py-2 transition-colors"
          style={{ background: '#f0ece3', color: '#5c5248', border: '1px solid #ddd5c8' }}
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
 */
function AssistantMessage({
  content,
  sources,
  followUps,
  isError,
  onFollowUp,
  answerId,
  question,
}: {
  content: string;
  sources?: Source[];
  followUps?: string[];
  isError?: boolean;
  onFollowUp?: (q: string) => void;
  answerId?: string;
  question?: string;
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
          background: isError ? '#fff4f2' : '#f0ece3',
          color: isError ? '#c0392b' : '#2c2c2c',
          border: isError ? '1px solid #f5c6c0' : 'none',
        }}
      >
        <FormattedAnswer
          text={content}
          onCitationClick={(sources?.length ?? 0) > 0 ? handleCitationClick : undefined}
        />
      </div>
      {!isError && (
        <div className="px-2">
          <div className="flex items-center gap-3">
            <CopyButton text={content} />
            {answerId && <ShareLinkButton answerId={answerId} />}
            {answerId && question && (
              <TwitterShareButton question={question} answer={content} answerId={answerId} />
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
      style={{ background: '#f0ece3' }}
      aria-label="Loading response"
    >
      <div className="space-y-2">
        <div
          className="h-3 rounded-full"
          style={{ width: '85%', background: '#ddd5c8', animation: 'shimmer 1.4s ease-in-out infinite' }}
        />
        <div
          className="h-3 rounded-full"
          style={{ width: '70%', background: '#ddd5c8', animation: 'shimmer 1.4s ease-in-out 0.15s infinite' }}
        />
        <div
          className="h-3 rounded-full"
          style={{ width: '55%', background: '#ddd5c8', animation: 'shimmer 1.4s ease-in-out 0.3s infinite' }}
        />
      </div>
    </div>
  );
}

interface QAInterfaceProps {
  initialConversation?: Conversation | null;
  onConversationUpdate?: (conversation: Conversation) => void;
  onNewChat?: () => void;
}

export function QAInterface({ initialConversation, onConversationUpdate, onNewChat }: QAInterfaceProps) {
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
        const errorMessages: Message[] = [
          ...newMessages,
          { role: 'assistant', content: 'Something went wrong — try again.', error: true },
        ];
        setMessages(errorMessages);
        return;
      }

      const data = await res.json();
      // Store the server's UUID so subsequent turns update the same Supabase session
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
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: 'Something went wrong — try again.',
          error: true,
        },
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
    <div className="flex flex-col h-full" style={{ background: '#faf8f3' }}>
      {/* Thread header — only visible when conversation has content */}
      {!isEmpty && (
        <div
          className="flex items-center justify-end px-4 py-2 border-b flex-shrink-0"
          style={{ borderColor: '#e0d8cc', background: '#faf8f3' }}
        >
          <button
            onClick={handleClear}
            disabled={loading}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border transition-colors disabled:opacity-40"
            style={{ borderColor: '#e0d8cc', color: '#9c9080' }}
            aria-label="Clear conversation"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
            </svg>
            New conversation
          </button>
        </div>
      )}
      {/* Conversation thread */}
      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="max-w-2xl mx-auto space-y-6">
          {isEmpty && (
            <div className="flex flex-col items-center justify-center h-64 text-center">
              <div
                className="w-12 h-12 rounded-full flex items-center justify-center mb-4"
                style={{ background: '#e8e0d5' }}
              >
                <svg
                  className="w-6 h-6"
                  style={{ color: '#7d8c6e' }}
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
              <p className="font-medium text-sm" style={{ color: '#5c5248' }}>
                Ask a question to explore mindfulness teachings
              </p>
              <p className="text-xs mt-1 mb-5" style={{ color: '#9c9080' }}>
                Sourced from 760+ hours of mindfulness content
              </p>
              <div className="flex flex-wrap justify-center gap-2 max-w-md">
                {[
                  'What is the nature of consciousness?',
                  'How do I start a meditation practice?',
                  'What is the relationship between mindfulness and free will?',
                  'How can mindfulness reduce suffering?',
                ].map((prompt) => (
                  <button
                    key={prompt}
                    onClick={() => setInput(prompt)}
                    className="rounded-full px-3 py-1.5 text-xs transition-colors"
                    style={{
                      background: '#f0ece3',
                      color: '#5c5248',
                      border: '1px solid #ddd5c8',
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
                      background: '#7d8c6e',
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
                    followUps={loading ? [] : msg.followUps}
                    isError={msg.error}
                    onFollowUp={submit}
                    answerId={msg.answerId}
                    question={messages[i - 1]?.role === 'user' ? messages[i - 1].content : undefined}
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
        style={{ borderColor: '#e0d8cc', background: '#faf8f3' }}
      >
        <form onSubmit={handleSubmit} className="max-w-2xl mx-auto">
          <div
            className="flex items-end gap-2 rounded-2xl px-4 py-3"
            style={{
              background: '#fff',
              border: '1px solid #e0d8cc',
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
              style={{ color: '#2c2c2c', minHeight: '24px' }}
            />
            <button
              type="submit"
              disabled={!input.trim() || loading}
              className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center transition-opacity disabled:opacity-30"
              style={{ background: '#7d8c6e' }}
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
            <p className="text-xs" style={{ color: '#b0a898' }}>
              Press Enter to send · Shift+Enter for new line
            </p>
            {input.length > 0 && (
              <p
                className="text-xs tabular-nums"
                style={{ color: input.length >= MAX_CHARS ? '#c0392b' : '#b0a898' }}
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
      `}</style>
    </div>
  );
}
