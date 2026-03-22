'use client';

import { useState, useRef, useEffect, FormEvent, KeyboardEvent } from 'react';
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

function SourceList({ sources }: { sources: Source[] }) {
  const [open, setOpen] = useState(false);

  if (sources.length === 0) return null;

  return (
    <div className="mt-3">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-xs font-medium text-sage-600 hover:text-sage-800 transition-colors"
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
        {sources.length} source{sources.length !== 1 ? 's' : ''}
      </button>

      {open && (
        <div className="mt-2 space-y-2">
          {sources.map((s, i) => (
            <div
              key={i}
              className="rounded-lg p-3 text-xs"
              style={{
                background: '#f0ece3',
                borderLeft: '2px solid #b8ccb0',
              }}
            >
              {s.speaker && (
                <p className="font-semibold mb-1" style={{ color: '#5a6b52' }}>
                  {s.speaker}
                </p>
              )}
              <p className="leading-relaxed" style={{ color: '#5c5248' }}>
                {s.text}
              </p>
              {s.source && (
                <p className="mt-1 opacity-60 font-mono" style={{ color: '#7d8c6e' }}>
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

  // When a different conversation is loaded from the sidebar, reset state
  useEffect(() => {
    if (initialConversation) {
      setMessages(initialConversation.messages);
      setConversationId(initialConversation.id);
    } else {
      setMessages([]);
      setConversationId(newConversationId());
    }
    setServerConversationId(null);
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

  async function submit() {
    const question = input.trim();
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
      submit();
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    submit();
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
                  <div className="max-w-xl">
                    <div
                      className="rounded-2xl rounded-tl-sm px-4 py-3 text-sm leading-relaxed"
                      style={{
                        background: msg.error ? '#fff4f2' : '#f0ece3',
                        color: msg.error ? '#c0392b' : '#2c2c2c',
                        border: msg.error ? '1px solid #f5c6c0' : 'none',
                      }}
                    >
                      {msg.content}
                    </div>
                    {msg.sources && msg.sources.length > 0 && (
                      <div className="px-2">
                        <SourceList sources={msg.sources} />
                      </div>
                    )}
                  </div>
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
