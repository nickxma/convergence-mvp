'use client';

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type MutableRefObject } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, type UIMessage } from 'ai';
import { usePrivy } from '@privy-io/react-auth';
import {
  type Message as ConversationMessage,
  type Conversation,
  saveConversation,
  newConversationId,
  titleFromQuestion,
} from '@/lib/conversations';

export type { ConversationMessage as Message };

export interface QAInterfaceActions {
  focusInput: () => void;
  clear: () => void;
}

interface Source {
  text: string;
  speaker: string;
  source: string;
  score: number;
}

interface AskMetadata {
  sources?: Source[];
  conversationId?: string;
  detectedLanguage?: { code: string; name: string };
}

/** Extract plain text from a UIMessage's parts array. */
function getMessageText(msg: UIMessage): string {
  return msg.parts
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map((p) => p.text)
    .join('');
}

/** Extract sources from message metadata. */
function getMessageSources(msg: UIMessage): Source[] {
  const meta = msg.metadata as AskMetadata | undefined;
  return meta?.sources ?? [];
}

/** Extract detected language from message metadata. Returns null for English. */
function getMessageLanguage(msg: UIMessage): { code: string; name: string } | null {
  const meta = msg.metadata as AskMetadata | undefined;
  return meta?.detectedLanguage ?? null;
}

/** Format a teacher name for display. */
function teacherLabel(speaker: string): string {
  return speaker || 'Mindfulness Teacher';
}

/** Render answer text with clickable [N] citation markers referencing teachers. */
function CitationText({
  text,
  sourcesCount,
  onCitationClick,
}: {
  text: string;
  sourcesCount: number;
  onCitationClick: (index: number) => void;
}) {
  const parts = text.split(/(\[\d+\])/g);
  return (
    <>
      {parts.map((part, i) => {
        const match = part.match(/^\[(\d+)\]$/);
        if (match) {
          const num = parseInt(match[1], 10);
          if (num >= 1 && num <= sourcesCount) {
            return (
              <button
                key={i}
                onClick={() => onCitationClick(num - 1)}
                className="inline-flex items-center justify-center rounded align-middle transition-colors hover:opacity-80"
                style={{
                  background: '#b8ccb0',
                  color: '#3d5c3a',
                  fontSize: '10px',
                  fontWeight: 700,
                  lineHeight: 1,
                  padding: '1px 4px',
                  margin: '0 1px',
                  verticalAlign: 'middle',
                  minWidth: '16px',
                }}
                aria-label={`View teacher ${num}`}
              >
                {num}
              </button>
            );
          }
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

/** Static sources used across the corpus. */
const CORPUS_SOURCES = [
  { name: 'SuttaCentral', count: '4,816', desc: 'Pali Canon, early Buddhist texts' },
  { name: 'Lotsawa House', count: '2,224', desc: 'Tibetan Buddhist texts' },
  { name: 'Access to Insight', count: '1,621', desc: 'Theravada texts, Pali Canon + commentary' },
  { name: 'PMC (PubMed Central)', count: '585', desc: 'peer-reviewed papers on mindfulness and contemplative science' },
  { name: 'Project Gutenberg', count: '127', desc: 'classic contemplative texts' },
  { name: 'dhammatalks.org', count: '90', desc: 'books (Thanissaro Bhikkhu)' },
  { name: 'Wikisource', count: '13', desc: 'public domain contemplative texts' },
  { name: 'Dharma Seed', count: '7', desc: 'talks (with explicit permission)' },
  { name: 'Internet Archive', count: '5', desc: 'pre-1928 public domain texts' },
];

/** Slide-over panel showing corpus sources for an answer. */
function CitationPanel({
  onClose,
}: {
  sources: Source[];
  activeIndex: number;
  onClose: () => void;
  onNavigate: (index: number) => void;
}) {
  useEffect(() => {
    function handleKey(e: globalThis.KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40"
        style={{ background: 'rgba(0,0,0,0.15)' }}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Slide-over panel */}
      <div
        className="fixed right-0 top-0 h-full z-50 flex flex-col"
        style={{
          width: 'min(400px, 90vw)',
          background: '#faf8f3',
          borderLeft: '1px solid #e0d8cc',
          boxShadow: '-4px 0 24px rgba(0,0,0,0.08)',
        }}
        role="dialog"
        aria-label="Source corpus"
        aria-modal="true"
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4 border-b flex-shrink-0"
          style={{ borderColor: '#e0d8cc' }}
        >
          <h2 className="font-semibold text-sm" style={{ color: '#2c2c2c' }}>
            Sources
          </h2>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded flex items-center justify-center transition-colors hover:bg-[#f0ece3]"
            style={{ color: '#7d8c6e' }}
            aria-label="Close sources panel"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Source list */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
          <p className="text-xs leading-relaxed mb-3" style={{ color: '#7d8c6e' }}>
            Answers are drawn from 9,500+ documents across nine curated sources.
          </p>
          {CORPUS_SOURCES.map((src) => (
            <div
              key={src.name}
              className="rounded-xl p-3"
              style={{ background: '#f0ece3' }}
            >
              <p className="font-semibold text-xs" style={{ color: '#5a6b52' }}>
                {src.name}
              </p>
              <p className="text-xs mt-0.5" style={{ color: '#9c9080' }}>
                {src.count} documents — {src.desc}
              </p>
            </div>
          ))}
        </div>

        {/* Coming soon footer */}
        <div
          className="px-5 py-3 border-t flex-shrink-0 text-xs"
          style={{ borderColor: '#e0d8cc', color: '#b0a898' }}
        >
          Detailed transcript references coming soon. · Esc close
        </div>
      </div>
    </>
  );
}

function StreamingIndicator() {
  return (
    <div className="flex items-center gap-1.5 py-1">
      <div className="flex gap-1">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="w-1.5 h-1.5 rounded-full"
            style={{
              background: '#7d8c6e',
              animation: `pulse-dot 1.2s ease-in-out ${i * 0.2}s infinite`,
            }}
          />
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
  readOnly?: boolean;
  actionsRef?: MutableRefObject<QAInterfaceActions | null>;
  // Accepted but unused in this simplified version
  essayContext?: unknown;
  collaborativeSessionId?: string;
}

export function QAInterface({
  initialConversation,
  onConversationUpdate,
  onNewChat,
  initialQuestion,
  readOnly = false,
  actionsRef,
}: QAInterfaceProps) {
  const { user } = usePrivy();
  const walletAddress = user?.wallet?.address ?? null;
  const userId = user?.id ?? null;

  const MAX_CHARS = 500;
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [input, setInput] = useState('');
  const [conversationId, setConversationId] = useState<string>(
    initialConversation?.id ?? newConversationId()
  );

  // Citation panel: null = closed; otherwise tracks sources + which item is active
  const [citationPanel, setCitationPanel] = useState<{
    sources: Source[];
    activeIndex: number;
  } | null>(null);

  // Convert initial conversation messages to UIMessage format
  const initialMessages: UIMessage[] = (initialConversation?.messages ?? []).map((m, i) => ({
    id: `init-${i}`,
    role: m.role as 'user' | 'assistant',
    parts: [{ type: 'text' as const, text: m.content }],
    metadata: m.sources ? { sources: m.sources, conversationId } : undefined,
  }));

  const {
    messages,
    sendMessage,
    status,
    error,
    setMessages,
  } = useChat({
    transport: new DefaultChatTransport({
      api: '/api/ask',
      body: { walletAddress, conversationId },
    }),
    messages: initialMessages,
    onFinish: ({ messages: finalMessages }) => {
      if (!userId) return;
      const allMsgs: ConversationMessage[] = finalMessages.map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: getMessageText(m),
        sources: getMessageSources(m),
      }));
      const firstQuestion = allMsgs.find((m) => m.role === 'user')?.content ?? 'Untitled';
      const conversation: Conversation = {
        id: conversationId,
        userId,
        title: titleFromQuestion(firstQuestion),
        messages: allMsgs,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      saveConversation(userId, conversation);
      onConversationUpdate?.(conversation);
    },
  });

  const isLoading = status === 'streaming' || status === 'submitted';

  // Reset when a different conversation is loaded
  useEffect(() => {
    if (initialConversation) {
      const msgs: UIMessage[] = initialConversation.messages.map((m, i) => ({
        id: `init-${i}`,
        role: m.role as 'user' | 'assistant',
        parts: [{ type: 'text' as const, text: m.content }],
        metadata: m.sources ? { sources: m.sources, conversationId: initialConversation.id } : undefined,
      }));
      setMessages(msgs);
      setConversationId(initialConversation.id);
    } else {
      setMessages([]);
      setConversationId(newConversationId());
    }
    setCitationPanel(null);
  }, [initialConversation?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Expose imperative actions via ref
  useEffect(() => {
    if (!actionsRef) return;
    actionsRef.current = {
      focusInput: () => textareaRef.current?.focus(),
      clear: () => {
        setMessages([]);
        setConversationId(newConversationId());
        setCitationPanel(null);
        onNewChat?.();
      },
    };
    return () => { if (actionsRef) actionsRef.current = null; };
  }); // eslint-disable-line react-hooks/exhaustive-deps

  // Pre-fill input from initialQuestion
  useEffect(() => {
    if (initialQuestion) setInput(initialQuestion);
  }, [initialQuestion]);

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [input]);

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  function submit() {
    const text = input.trim();
    if (!text || isLoading || readOnly) return;
    setInput('');
    setCitationPanel(null);
    sendMessage({ text });
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    submit();
  }

  const isEmpty = messages.length === 0 && !isLoading;

  return (
    <div className="flex flex-col h-full" style={{ background: '#faf8f3' }}>
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
                Sourced from hundreds of hours from leading mindfulness teachers and practitioners
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

          {messages.map((msg) => {
            const text = getMessageText(msg);
            const sources = getMessageSources(msg);
            const detectedLanguage = msg.role === 'assistant' ? getMessageLanguage(msg) : null;

            if (msg.role === 'assistant' && !text && !isLoading) return null;

            return (
              <div key={msg.id}>
                {msg.role === 'user' ? (
                  <div className="flex justify-end">
                    <div
                      className="rounded-2xl rounded-tr-sm px-4 py-3 max-w-sm text-sm leading-relaxed"
                      style={{ background: '#7d8c6e', color: '#fff' }}
                    >
                      {text}
                    </div>
                  </div>
                ) : (
                  <div className="flex justify-start">
                    <div className="max-w-xl">
                      <div
                        className="rounded-2xl rounded-tl-sm px-4 py-3 text-sm leading-relaxed"
                        style={{
                          background: '#f0ece3',
                          color: '#2c2c2c',
                          whiteSpace: 'pre-wrap',
                        }}
                      >
                        {text ? (
                          text.replace(/\[\d+\]/g, '')
                        ) : (
                          <StreamingIndicator />
                        )}
                      </div>
                      {/* Sources pill — click to open panel at first source */}
                      {sources.length > 0 && (
                        <div className="px-2 mt-2">
                          <button
                            onClick={() => setCitationPanel({ sources, activeIndex: 0 })}
                            className="flex items-center gap-1.5 text-xs font-medium transition-colors hover:opacity-80"
                            style={{ color: '#7d8c6e' }}
                          >
                            <svg
                              className="w-3.5 h-3.5"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                              strokeWidth={2}
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z"
                              />
                            </svg>
                            View sources
                          </button>
                        </div>
                      )}
                      {/* Language badge — shown when response is in a non-English language */}
                      {detectedLanguage && (
                        <div className="px-2 mt-1.5">
                          <span
                            className="inline-flex items-center gap-1 text-xs font-medium rounded-full px-2 py-0.5"
                            style={{
                              background: '#e8e0d5',
                              color: '#7d6e5c',
                              border: '1px solid #d5cbbf',
                            }}
                          >
                            <svg
                              className="w-3 h-3"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                              strokeWidth={2}
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="m10.5 21 5.25-11.25L21 21m-9-3h7.5M3 5.621a48.474 48.474 0 0 1 6-.371m0 0c1.12 0 2.233.038 3.334.114M9 5.25V3m3.334 2.364C11.176 10.658 7.69 15.08 3 17.502m9.334-12.138c.896.061 1.785.147 2.666.257m-4.589 8.495a18.023 18.023 0 0 1-3.827-5.802"
                              />
                            </svg>
                            {detectedLanguage.name}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {isLoading && messages.length > 0 && messages[messages.length - 1]?.role === 'user' && (
            <div className="flex justify-start">
              <div
                className="rounded-2xl rounded-tl-sm px-4 py-3"
                style={{ background: '#f0ece3' }}
              >
                <StreamingIndicator />
              </div>
            </div>
          )}

          {error && (
            <div className="flex justify-start">
              <div
                className="rounded-2xl rounded-tl-sm px-4 py-3 max-w-xl text-sm"
                style={{ background: '#fff4f2', color: '#c0392b', border: '1px solid #f5c6c0' }}
              >
                Something went wrong — try again.
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </div>

      {/* Input bar */}
      <div className="border-t px-4 py-4" style={{ borderColor: '#e0d8cc', background: '#faf8f3' }}>
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
              disabled={isLoading || readOnly}
              maxLength={MAX_CHARS}
              className="flex-1 resize-none bg-transparent text-sm leading-relaxed outline-none placeholder-zinc-400 disabled:opacity-50"
              style={{ color: '#2c2c2c', minHeight: '24px' }}
            />
            <button
              type="submit"
              disabled={!input.trim() || isLoading || readOnly}
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

      {/* Citation slide-over panel */}
      {citationPanel && (
        <CitationPanel
          sources={citationPanel.sources}
          activeIndex={citationPanel.activeIndex}
          onClose={() => setCitationPanel(null)}
          onNavigate={(index) => setCitationPanel((prev) => prev ? { ...prev, activeIndex: index } : null)}
        />
      )}

      <style>{`
        @keyframes pulse-dot {
          0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); }
          40% { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  );
}
