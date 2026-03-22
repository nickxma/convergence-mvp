'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { useSearchParams } from 'next/navigation';
import { QAInterface } from '@/components/qa-interface';
import { MeditateInterface } from '@/components/meditate-interface';
import { LandingPage } from '@/components/landing-page';
import {
  type Conversation,
  loadConversations,
  deleteConversation,
  newConversationId,
} from '@/lib/conversations';

type Mode = 'ask' | 'meditate';

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
  onSelect: (c: Conversation) => void;
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
      style={{ background: '#f5f1e8', borderRight: '1px solid #e0d8cc' }}
    >
      {/* Sidebar header */}
      <div
        className="flex items-center justify-between px-4 py-3 border-b flex-shrink-0"
        style={{ borderColor: '#e0d8cc' }}
      >
        <span className="text-xs font-semibold tracking-wide uppercase" style={{ color: '#7d8c6e' }}>
          History
        </span>
        <button
          onClick={onClose}
          className="sm:hidden p-1 rounded"
          style={{ color: '#9c9080' }}
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
          style={{ background: '#7d8c6e', color: '#fff' }}
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
          <p className="text-xs text-center py-8" style={{ color: '#b0a898' }}>
            No past conversations yet
          </p>
        ) : (
          conversations.map((c) => (
            <div
              key={c.id}
              className="group relative flex items-start gap-1 rounded-lg px-3 py-2 cursor-pointer transition-colors"
              style={{
                background: activeId === c.id ? '#e8e0d5' : 'transparent',
              }}
              onClick={() => onSelect(c)}
            >
              <div className="flex-1 min-w-0">
                <p
                  className="text-xs font-medium leading-snug truncate"
                  style={{ color: '#3d4f38' }}
                >
                  {c.title}
                </p>
                <p className="text-xs mt-0.5" style={{ color: '#9c9080' }}>
                  {formatDate(c.updatedAt)} · {c.messages.filter((m) => m.role === 'user').length}q
                </p>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(c.id);
                }}
                className="opacity-0 group-hover:opacity-100 flex-shrink-0 p-1 rounded transition-opacity"
                style={{ color: '#9c9080' }}
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
        style={{ borderColor: '#e0d8cc' }}
      >
        <a
          href="/profile"
          className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs transition-colors"
          style={{ color: '#7d8c6e' }}
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
  const { ready, authenticated, logout, user } = usePrivy();
  const searchParams = useSearchParams();
  const initialQuestion = searchParams?.get('q') ?? undefined;
  const userId = user?.id ?? null;

  const [mode, setMode] = useState<Mode>('ask');
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversation, setActiveConversation] = useState<Conversation | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Load conversations when user is available
  useEffect(() => {
    if (userId) {
      setConversations(loadConversations(userId));
    }
  }, [userId]);

  const handleConversationUpdate = useCallback(
    (updated: Conversation) => {
      // Re-read from localStorage (source of truth — saveConversation was just called)
      // so the sidebar always reflects the persisted state on the first save.
      const fresh = loadConversations(updated.userId);
      if (fresh.length > 0) {
        setConversations(fresh);
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

  function handleSelectConversation(c: Conversation) {
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
        <div className="text-sm" style={{ color: '#9c9080' }}>Loading…</div>
      </div>
    );
  }

  if (!authenticated) {
    return <LandingPage />;
  }

  return (
    <div className="flex flex-col h-full" style={{ background: '#faf8f3' }}>
      {/* Header */}
      <header
        className="flex items-center justify-between px-5 py-3 border-b flex-shrink-0 z-10"
        style={{ borderColor: '#e0d8cc', background: '#faf8f3' }}
      >
        <div className="flex items-center gap-2 min-w-0">
          {/* History toggle (mobile) — only visible in ask mode */}
          {mode === 'ask' && (
            <button
              onClick={() => setSidebarOpen((v) => !v)}
              className="sm:hidden p-1.5 rounded-lg mr-1"
              style={{ color: '#7d8c6e', background: sidebarOpen ? '#e8e0d5' : 'transparent' }}
              aria-label="Toggle history"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25H12" />
              </svg>
            </button>
          )}
          <span className="text-sm font-semibold tracking-tight" style={{ color: '#3d4f38' }}>
            Convergence
          </span>
          <span
            className="text-xs px-1.5 py-0.5 rounded-full flex-shrink-0"
            style={{ background: '#e8e0d5', color: '#7d8c6e' }}
          >
            beta
          </span>

          {/* Mode tabs */}
          <div
            className="ml-3 flex items-center rounded-full p-0.5 gap-0.5"
            style={{ background: '#e8e0d5' }}
          >
            {(['ask', 'meditate'] as Mode[]).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className="text-xs px-3 py-1 rounded-full capitalize transition-colors"
                style={{
                  background: mode === m ? '#fff' : 'transparent',
                  color: mode === m ? '#3d4f38' : '#7d8c6e',
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
          <span className="hidden sm:block text-xs truncate max-w-[180px]" style={{ color: '#9c9080' }}>
            {user?.email?.address}
          </span>
          <a
            href="/leaderboard"
            className="hidden sm:flex items-center gap-1 text-xs px-3 py-1.5 rounded-full border transition-colors flex-shrink-0"
            style={{ borderColor: '#e0d8cc', color: '#7d8c6e' }}
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" />
            </svg>
            Leaderboard
          </a>
          <a
            href="/profile"
            className="hidden sm:flex items-center gap-1 text-xs px-3 py-1.5 rounded-full border transition-colors flex-shrink-0"
            style={{ borderColor: '#e0d8cc', color: '#7d8c6e' }}
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17.982 18.725A7.488 7.488 0 0 0 12 15.75a7.488 7.488 0 0 0-5.982 2.975m11.963 0a9 9 0 1 0-11.963 0m11.963 0A8.966 8.966 0 0 1 12 21a8.966 8.966 0 0 1-5.982-2.275M15 9.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
            </svg>
            Profile
          </a>
          <button
            onClick={logout}
            className="text-xs px-3 py-1.5 rounded-full border transition-colors flex-shrink-0"
            style={{ borderColor: '#e0d8cc', color: '#7d8c6e' }}
          >
            Sign out
          </button>
        </div>
      </header>

      {/* Body: sidebar + main */}
      <div className="flex flex-1 overflow-hidden relative">
        {/* Sidebar — only in ask mode; desktop: always visible; mobile: overlay */}
        {mode === 'ask' && (
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
        style={{ borderColor: '#e0d8cc', background: '#faf8f3' }}
      >
        <span className="text-xs" style={{ color: '#b0a898' }}>
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
