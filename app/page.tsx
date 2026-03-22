'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { useSearchParams } from 'next/navigation';
import { QAInterface } from '@/components/qa-interface';
import { MeditateInterface } from '@/components/meditate-interface';
import { useTheme } from '@/lib/theme-context';
import {
  type Conversation,
  type Message,
  loadConversations,
  deleteConversation,
  newConversationId,
} from '@/lib/conversations';
import { countBookmarks } from '@/lib/bookmarks';

type Mode = 'ask' | 'meditate';

function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  return (
    <button
      onClick={toggleTheme}
      aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      className="flex items-center justify-center w-8 h-8 rounded-full border transition-colors flex-shrink-0"
      style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
    >
      {theme === 'dark' ? (
        /* Sun icon */
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386-1.591 1.591M21 12h-2.25m-.386 6.364-1.591-1.591M12 18.75V21m-4.773-4.227-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z" />
        </svg>
      ) : (
        /* Moon icon */
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21.752 15.002A9.72 9.72 0 0 1 18 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 0 0 3 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 0 0 9.002-5.998Z" />
        </svg>
      )}
    </button>
  );
}

function ConversationSidebar({
  userId,
  activeId,
  conversations,
  onSelect,
  onNew,
  onDelete,
  onClose,
}: {
  userId: string;
  activeId: string | null;
  conversations: Conversation[];
  onSelect: (c: Conversation) => void | Promise<void>;
  onNew: () => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  function formatDate(ts: number): string {
    const d = new Date(ts);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  return (
    <div
      className="flex flex-col h-full"
      style={{ background: 'var(--bg-sidebar)', borderRight: '1px solid var(--border)' }}
    >
      {/* Sidebar header */}
      <div
        className="flex items-center justify-between px-4 py-3 border-b flex-shrink-0"
        style={{ borderColor: 'var(--border)' }}
      >
        <span className="text-xs font-semibold tracking-wide uppercase" style={{ color: 'var(--sage)' }}>
          History
        </span>
        <button
          onClick={onClose}
          className="sm:hidden p-1 rounded"
          style={{ color: 'var(--text-muted)' }}
          aria-label="Close history"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* New chat button */}
      <div className="px-3 py-3 flex-shrink-0">
        <button
          onClick={onNew}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium transition-colors"
          style={{ background: 'var(--sage)', color: '#fff' }}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          New chat
        </button>
      </div>

      {/* Conversation list */}
      <div className="flex-1 overflow-y-auto px-2 pb-3 space-y-0.5">
        {conversations.length === 0 ? (
          <p className="text-xs text-center py-8" style={{ color: 'var(--text-faint)' }}>
            No past conversations yet
          </p>
        ) : (
          conversations.map((c) => (
            <div
              key={c.id}
              className="group relative flex items-start gap-1 rounded-lg px-3 py-2 cursor-pointer transition-colors"
              style={{
                background: activeId === c.id ? 'var(--bg-chip)' : 'transparent',
              }}
              onClick={() => onSelect(c)}
            >
              <div className="flex-1 min-w-0">
                <p
                  className="text-xs font-medium leading-snug truncate"
                  style={{ color: 'var(--sage-dark)' }}
                >
                  {c.title}
                </p>
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                  {formatDate(c.updatedAt)} · {c.messages.filter((m) => m.role === 'user').length}q
                </p>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(c.id);
                }}
                className="opacity-0 group-hover:opacity-100 flex-shrink-0 p-1 rounded transition-opacity"
                style={{ color: 'var(--text-muted)' }}
                aria-label="Delete conversation"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))
        )}
      </div>

      {/* Profile link */}
      <div
        className="flex-shrink-0 border-t px-3 py-3"
        style={{ borderColor: 'var(--border)' }}
      >
        <a
          href="/profile"
          className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs transition-colors"
          style={{ color: 'var(--sage)' }}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M17.982 18.725A7.488 7.488 0 0 0 12 15.75a7.488 7.488 0 0 0-5.982 2.975m11.963 0a9 9 0 1 0-11.963 0m11.963 0A8.966 8.966 0 0 1 12 21a8.966 8.966 0 0 1-5.982-2.275M15 9.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
          </svg>
          Profile &amp; wallet
        </a>
      </div>
    </div>
  );
}

function HomeInner() {
  const { ready, authenticated, logout, login, user, getAccessToken } = usePrivy();
  const searchParams = useSearchParams();
  const initialQuestion = searchParams?.get('q') ?? undefined;
  const userId = user?.id ?? null;

  const [mode, setMode] = useState<Mode>('ask');
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversation, setActiveConversation] = useState<Conversation | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [bookmarkCount, setBookmarkCount] = useState(0);

  // Load local conversations immediately, then merge with Supabase history for cross-device support
  useEffect(() => {
    if (!userId || !authenticated) return;

    const local = loadConversations(userId);
    setConversations(local);

    async function mergeRemote() {
      try {
        const token = await getAccessToken();
        const res = await fetch('/api/conversations', {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) return;
        const { conversations: remote } = (await res.json()) as {
          conversations: Array<{ id: string; title: string; turnCount: number; createdAt: string; updatedAt: string }>;
        };

        // Add Supabase conversations not already tracked in localStorage
        const localServerIds = new Set(local.map((c) => c.serverConversationId).filter(Boolean));
        const remoteOnly = remote.filter((r) => !localServerIds.has(r.id));
        if (remoteOnly.length === 0) return;

        const remoteConversations: Conversation[] = remoteOnly.map((r) => ({
          id: r.id,
          serverConversationId: r.id,
          userId: userId!,
          title: r.title,
          messages: [] as Message[],
          createdAt: new Date(r.createdAt).getTime(),
          updatedAt: new Date(r.updatedAt).getTime(),
        }));

        setConversations((prev) =>
          [...prev, ...remoteConversations].sort((a, b) => b.updatedAt - a.updatedAt)
        );
      } catch {
        // Network error — local-only mode, no action needed
      }
    }

    void mergeRemote();
  }, [userId, authenticated]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep bookmark badge in sync
  useEffect(() => {
    if (!userId) return;
    setBookmarkCount(countBookmarks(userId));
    const handler = () => setBookmarkCount(countBookmarks(userId));
    window.addEventListener('bookmark-change', handler);
    return () => window.removeEventListener('bookmark-change', handler);
  }, [userId]);

  const handleConversationUpdate = useCallback(
    (updated: Conversation) => {
      // Re-read from localStorage (source of truth — saveConversation was just called)
      // so the sidebar always reflects the persisted state on the first save.
      const fresh = loadConversations(updated.userId);
      if (fresh.length > 0) {
        // Preserve remote-only conversations not yet in localStorage
        setConversations((prev) => {
          const freshIds = new Set(fresh.map((c) => c.id));
          const remoteOnly = prev.filter((c) => !freshIds.has(c.id) && c.serverConversationId);
          return [...fresh, ...remoteOnly].sort((a, b) => b.updatedAt - a.updatedAt);
        });
      } else {
        // Fallback: apply optimistic in-memory update if localStorage read is empty
        setConversations((prev) => {
          const idx = prev.findIndex((c) => c.id === updated.id);
          if (idx >= 0) {
            const next = [...prev];
            next[idx] = updated;
            return next.sort((a, b) => b.updatedAt - a.updatedAt);
          }
          return [updated, ...prev];
        });
      }
      setActiveConversation(updated);
    },
    []
  );

  function handleNewChat() {
    setActiveConversation(null);
    setSidebarOpen(false);
  }

  async function handleSelectConversation(c: Conversation) {
    // Remote-only conversation (from another device): fetch full history before activating
    if (c.messages.length === 0 && c.serverConversationId) {
      try {
        const token = await getAccessToken();
        const res = await fetch(`/api/conversations/${c.serverConversationId}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (res.ok) {
          const data = (await res.json()) as {
            id: string; title: string;
            history: Array<{ role: string; content: string }>;
          };
          const messages: Message[] = data.history.map((m) => ({
            role: m.role as 'user' | 'assistant',
            content: m.content,
          }));
          c = { ...c, messages };
        }
      } catch {
        // Show conversation with empty messages — user can start a new turn
      }
    }
    setActiveConversation(c);
    setSidebarOpen(false);
  }

  function handleDeleteConversation(id: string) {
    if (!userId) return;
    deleteConversation(userId, id);
    setConversations((prev) => prev.filter((c) => c.id !== id));
    if (activeConversation?.id === id) {
      setActiveConversation(null);
    }
  }

  if (!ready) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading…</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--bg)' }}>
      {/* Header */}
      <header
        className="flex items-center justify-between px-5 py-3 border-b flex-shrink-0 z-10"
        style={{ borderColor: 'var(--border)', background: 'var(--bg)' }}
      >
        <div className="flex items-center gap-2 min-w-0">
          {/* History toggle (mobile) — only visible in ask mode for authenticated users */}
          {authenticated && mode === 'ask' && (
            <button
              onClick={() => setSidebarOpen((v) => !v)}
              className="sm:hidden p-1.5 rounded-lg mr-1"
              style={{ color: 'var(--sage)', background: sidebarOpen ? 'var(--bg-chip)' : 'transparent' }}
              aria-label="Toggle history"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25H12" />
              </svg>
            </button>
          )}
          <span className="text-sm font-semibold tracking-tight" style={{ color: 'var(--sage-dark)' }}>
            Convergence
          </span>
          <span
            className="text-xs px-1.5 py-0.5 rounded-full flex-shrink-0"
            style={{ background: 'var(--bg-chip)', color: 'var(--sage)' }}
          >
            beta
          </span>

          {/* Mode tabs */}
          <div
            className="ml-3 flex items-center rounded-full p-0.5 gap-0.5"
            style={{ background: 'var(--bg-chip)' }}
          >
            {(['ask', 'meditate'] as Mode[]).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className="text-xs px-3 py-1 rounded-full capitalize transition-colors"
                style={{
                  background: mode === m ? 'var(--bg-input)' : 'transparent',
                  color: mode === m ? 'var(--sage-dark)' : 'var(--sage)',
                  fontWeight: mode === m ? 500 : 400,
                  boxShadow: mode === m ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                }}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2 sm:gap-3 ml-4">
          {authenticated ? (
            <>
              <span className="hidden sm:block text-xs truncate max-w-[180px]" style={{ color: 'var(--text-muted)' }}>
                {user?.email?.address}
              </span>
              <ThemeToggle />
              <a
                href="/bookmarks"
                className="hidden sm:flex items-center gap-1 text-xs px-3 py-1.5 rounded-full border transition-colors flex-shrink-0 relative"
                style={{ borderColor: 'var(--border)', color: 'var(--sage)' }}
                aria-label={`Bookmarks${bookmarkCount > 0 ? ` (${bookmarkCount})` : ''}`}
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0Z" />
                </svg>
                Bookmarks
                {bookmarkCount > 0 && (
                  <span
                    className="ml-1 text-xs font-medium px-1 rounded-full"
                    style={{ background: 'var(--sage)', color: '#fff', fontSize: '0.6rem', lineHeight: '1.4' }}
                  >
                    {bookmarkCount > 9 ? '9+' : bookmarkCount}
                  </span>
                )}
              </a>
              <a
                href="/leaderboard"
                className="hidden sm:flex items-center gap-1 text-xs px-3 py-1.5 rounded-full border transition-colors flex-shrink-0"
                style={{ borderColor: 'var(--border)', color: 'var(--sage)' }}
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" />
                </svg>
                Leaderboard
              </a>
              <a
                href="/profile"
                className="hidden sm:flex items-center gap-1 text-xs px-3 py-1.5 rounded-full border transition-colors flex-shrink-0"
                style={{ borderColor: 'var(--border)', color: 'var(--sage)' }}
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17.982 18.725A7.488 7.488 0 0 0 12 15.75a7.488 7.488 0 0 0-5.982 2.975m11.963 0a9 9 0 1 0-11.963 0m11.963 0A8.966 8.966 0 0 1 12 21a8.966 8.966 0 0 1-5.982-2.275M15 9.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                </svg>
                Profile
              </a>
              <button
                onClick={logout}
                className="text-xs px-3 py-1.5 rounded-full border transition-colors flex-shrink-0"
                style={{ borderColor: 'var(--border)', color: 'var(--sage)' }}
              >
                Sign out
              </button>
            </>
          ) : (
            <>
              <ThemeToggle />
              <button
                onClick={login}
                className="text-xs px-4 py-1.5 rounded-full font-medium transition-colors flex-shrink-0"
                style={{ background: 'var(--sage)', color: '#fff' }}
              >
                Sign in
              </button>
            </>
          )}
        </div>
      </header>

      {/* Body: sidebar + main */}
      <div className="flex flex-1 overflow-hidden relative">
        {/* Sidebar — only for authenticated users in ask mode; desktop: always visible; mobile: overlay */}
        {authenticated && mode === 'ask' && (
          <>
            <div
              className={`
                flex-shrink-0 w-60
                sm:flex sm:flex-col
                ${sidebarOpen ? 'absolute inset-y-0 left-0 z-20 flex flex-col' : 'hidden'}
              `}
              style={{ width: '240px' }}
            >
              {userId && (
                <ConversationSidebar
                  userId={userId}
                  activeId={activeConversation?.id ?? null}
                  conversations={conversations}
                  onSelect={handleSelectConversation}
                  onNew={handleNewChat}
                  onDelete={handleDeleteConversation}
                  onClose={() => setSidebarOpen(false)}
                />
              )}
            </div>

            {/* Mobile overlay backdrop */}
            {sidebarOpen && (
              <div
                className="sm:hidden absolute inset-0 z-10"
                style={{ background: 'rgba(0,0,0,0.2)' }}
                onClick={() => setSidebarOpen(false)}
              />
            )}
          </>
        )}

        {/* Main area */}
        <div className="flex-1 overflow-hidden">
          {mode === 'ask' ? (
            <QAInterface
              initialConversation={activeConversation}
              onConversationUpdate={handleConversationUpdate}
              onNewChat={handleNewChat}
              initialQuestion={initialQuestion}
            />
          ) : (
            <MeditateInterface />
          )}
        </div>
      </div>

      {/* Footer */}
      <footer
        className="flex items-center justify-center px-5 py-2.5 border-t flex-shrink-0"
        style={{ borderColor: 'var(--border)', background: 'var(--bg)' }}
      >
        <span className="text-xs" style={{ color: 'var(--text-faint)' }}>
          Convergence · Paradox of Acceptance
        </span>
      </footer>
    </div>
  );
}

export default function Home() {
  return (
    <Suspense>
      <HomeInner />
    </Suspense>
  );
}
