'use client';

import { useRef, useState, useEffect, useCallback } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { QAInterface, type QAInterfaceActions } from '@/components/qa-interface';
import { type Conversation, type Message, newConversationId } from '@/lib/conversations';

interface SessionItem {
  id: string;
  title: string;
  turnCount: number;
  updatedAt: string;
}

interface AskPageClientProps {
  essayContext: { title: string; courseSlug: string; sessionSlug: string } | null;
}

function formatRelativeTime(isoString: string): string {
  const now = Date.now();
  const then = new Date(isoString).getTime();
  const diffMs = now - then;
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(diffMs / 3_600_000);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(diffMs / 86_400_000);
  if (days < 7) return `${days}d ago`;
  return new Date(isoString).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function AskPageClient({ essayContext }: AskPageClientProps) {
  const actionsRef = useRef<QAInterfaceActions | null>(null);
  const { ready, authenticated, getAccessToken } = usePrivy();

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [selectedConvId, setSelectedConvId] = useState<string | null>(null);
  const [selectedConv, setSelectedConv] = useState<Conversation | null>(null);
  const [convLoadingId, setConvLoadingId] = useState<string | null>(null);

  const fetchSessions = useCallback(async () => {
    if (!ready || !authenticated) return;
    setSessionsLoading(true);
    try {
      const token = await getAccessToken();
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch('/api/qa-conversations', { headers });
      if (!res.ok) return;
      const data = await res.json() as { conversations: SessionItem[] };
      setSessions(data.conversations ?? []);
    } catch {
      // silently ignore
    } finally {
      setSessionsLoading(false);
    }
  }, [ready, authenticated, getAccessToken]);

  useEffect(() => {
    void fetchSessions();
  }, [fetchSessions]);

  const handleSelectSession = useCallback(async (id: string) => {
    if (id === selectedConvId) return;
    setConvLoadingId(id);
    try {
      const token = await getAccessToken();
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch(`/api/qa-conversations/${id}`, { headers });
      if (!res.ok) return;
      const data = await res.json() as {
        id: string;
        title: string;
        messages: Array<{ role: string; content: string }>;
        createdAt: string;
        updatedAt: string;
      };
      const messages: Message[] = data.messages
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));
      const conv: Conversation = {
        id: newConversationId(),
        serverConversationId: data.id,
        userId: '',
        title: data.title,
        messages,
        createdAt: new Date(data.createdAt).getTime(),
        updatedAt: new Date(data.updatedAt).getTime(),
      };
      setSelectedConv(conv);
      setSelectedConvId(id);
    } catch {
      // silently ignore
    } finally {
      setConvLoadingId(null);
    }
  }, [selectedConvId, getAccessToken]);

  function handleNewChat() {
    setSelectedConvId(null);
    setSelectedConv(null);
    void fetchSessions();
  }

  const showSidebar = ready && authenticated && sidebarOpen;

  return (
    <div className="flex flex-col h-screen" style={{ background: 'var(--bg)' }}>
      {/* Header */}
      <header
        className="flex items-center justify-between px-4 py-3 border-b flex-shrink-0"
        style={{ borderColor: 'var(--border)', background: 'var(--bg)' }}
      >
        <div className="flex items-center gap-2">
          {/* Sidebar toggle — only when authenticated */}
          {ready && authenticated && (
            <button
              type="button"
              onClick={() => setSidebarOpen((v) => !v)}
              aria-label={sidebarOpen ? 'Close history sidebar' : 'Open history sidebar'}
              className="flex items-center justify-center w-8 h-8 rounded-md transition-colors"
              style={{
                color: sidebarOpen ? 'var(--sage)' : 'var(--text-faint)',
                background: sidebarOpen ? 'var(--bg-chip)' : 'transparent',
              }}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5M3.75 17.25h16.5" />
              </svg>
            </button>
          )}
          <a
            href={
              essayContext
                ? `/courses/${encodeURIComponent(essayContext.courseSlug)}/sessions/${encodeURIComponent(essayContext.sessionSlug)}`
                : '/qa'
            }
            className="flex items-center gap-1 text-xs transition-colors"
            style={{ color: 'var(--text-muted)' }}
            aria-label="Back"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
            </svg>
            Back
          </a>
          <span className="text-xs" style={{ color: 'var(--text-faint)' }}>/</span>
          <span className="text-sm font-semibold tracking-tight" style={{ color: 'var(--sage-dark)' }}>
            Ask
          </span>
        </div>
        <div className="flex items-center gap-2">
          {selectedConvId && (
            <button
              type="button"
              onClick={handleNewChat}
              className="text-xs px-3 py-1.5 rounded-full border transition-colors"
              style={{ borderColor: 'var(--sage)', color: 'var(--sage)' }}
            >
              + New Chat
            </button>
          )}
          <a
            href="/qa"
            className="text-xs px-3 py-1.5 rounded-full border transition-colors"
            style={{ borderColor: 'var(--border)', color: 'var(--sage)' }}
          >
            Open Q&amp;A
          </a>
        </div>
      </header>

      {/* Body: sidebar + main */}
      <div className="flex flex-1 overflow-hidden">
        {/* Session history sidebar */}
        {showSidebar && (
          <aside
            className="flex flex-col border-r flex-shrink-0 overflow-hidden"
            style={{
              width: '240px',
              borderColor: 'var(--border)',
              background: 'var(--bg)',
            }}
          >
            {/* Sidebar header */}
            <div
              className="flex items-center justify-between px-3 py-2.5 border-b flex-shrink-0"
              style={{ borderColor: 'var(--border)' }}
            >
              <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
                History
              </span>
              <button
                type="button"
                onClick={handleNewChat}
                className="text-xs px-2.5 py-1 rounded-full border transition-colors"
                style={{ borderColor: 'var(--sage)', color: 'var(--sage)' }}
              >
                + New
              </button>
            </div>

            {/* Sessions list */}
            <div className="flex-1 overflow-y-auto">
              {sessionsLoading && sessions.length === 0 ? (
                <div className="px-3 py-4 space-y-2">
                  {[1, 2, 3, 4].map((n) => (
                    <div
                      key={n}
                      className="h-10 rounded-lg animate-pulse"
                      style={{ background: 'var(--bg-chip)' }}
                    />
                  ))}
                </div>
              ) : sessions.length === 0 ? (
                <p className="px-3 py-4 text-xs text-center" style={{ color: 'var(--text-faint)' }}>
                  No past sessions yet
                </p>
              ) : (
                <ul className="py-1">
                  {sessions.map((session) => {
                    const isSelected = session.id === selectedConvId;
                    const isLoading = session.id === convLoadingId;
                    return (
                      <li key={session.id}>
                        <button
                          type="button"
                          onClick={() => void handleSelectSession(session.id)}
                          disabled={isLoading}
                          className="w-full text-left px-3 py-2 transition-colors"
                          style={{
                            background: isSelected ? 'var(--bg-chip)' : 'transparent',
                            borderLeft: isSelected ? '2px solid var(--sage)' : '2px solid transparent',
                          }}
                        >
                          {isLoading ? (
                            <div
                              className="h-3.5 rounded animate-pulse"
                              style={{ background: 'var(--bg-chip)', width: '70%' }}
                            />
                          ) : (
                            <>
                              <p
                                className="text-xs leading-snug line-clamp-2"
                                style={{
                                  color: isSelected ? 'var(--sage-dark)' : 'var(--text)',
                                  fontWeight: isSelected ? 500 : 400,
                                }}
                              >
                                {session.title}
                              </p>
                              <p
                                className="text-xs mt-0.5"
                                style={{ color: 'var(--text-faint)' }}
                              >
                                {formatRelativeTime(session.updatedAt)}
                                {session.turnCount > 1 && (
                                  <span> · {session.turnCount} turns</span>
                                )}
                              </p>
                            </>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </aside>
        )}

        {/* Main Q&A area */}
        <div className="flex-1 overflow-hidden">
          <QAInterface
            key={selectedConvId ?? 'new'}
            initialConversation={selectedConv}
            essayContext={selectedConvId ? null : essayContext}
            actionsRef={actionsRef}
            readOnly={!!selectedConvId}
            onNewChat={handleNewChat}
          />
        </div>
      </div>
    </div>
  );
}
