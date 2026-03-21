'use client';

import { useState, useRef, useEffect, FormEvent, KeyboardEvent } from 'react';

interface Source {
  text: string;
  speaker: string;
  source: string;
  score: number;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  sources?: Source[];
  error?: boolean;
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

function ThinkingDots() {
  return (
    <div className="flex items-center gap-1 py-1">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="inline-block w-1.5 h-1.5 rounded-full"
          style={{
            background: '#7d8c6e',
            animation: `pulse 1.2s ease-in-out ${i * 0.2}s infinite`,
          }}
        />
      ))}
    </div>
  );
}

export function QAInterface() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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

  async function submit() {
    const question = input.trim();
    if (!question || loading) return;

    setInput('');
    setMessages((prev) => [...prev, { role: 'user', content: question }]);
    setLoading(true);

    try {
      const history = messages.map((m) => ({ role: m.role, content: m.content }));
      const res = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, history }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Unknown error' }));
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: err.error ?? 'Something went wrong.', error: true },
        ]);
        return;
      }

      const data = await res.json();
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: data.answer ?? '',
          sources: data.sources ?? [],
        },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: 'Unable to reach the server. Please try again.',
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

  const isEmpty = messages.length === 0 && !loading;

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
                Ask anything about mindfulness
              </p>
              <p className="text-xs mt-1" style={{ color: '#9c9080' }}>
                Sourced from the Waking Up corpus
              </p>
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
              <div
                className="rounded-2xl rounded-tl-sm px-4 py-3"
                style={{ background: '#f0ece3' }}
              >
                <ThinkingDots />
              </div>
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
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask a question…"
              rows={1}
              disabled={loading}
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
          <p className="text-center text-xs mt-2" style={{ color: '#b0a898' }}>
            Press Enter to send · Shift+Enter for new line
          </p>
        </form>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 0.3; transform: scale(0.8); }
          50% { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  );
}
