'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';

// ── Types ─────────────────────────────────────────────────────────────────────

type NotificationType =
  | 'proposal_created'
  | 'vote_closing'
  | 'content_approved'
  | 'content_rejected'
  | 'new_content';

interface Notification {
  id: string;
  type: NotificationType;
  message: string;
  link: string | null;
  read: boolean;
  createdAt: string;
}

interface Props {
  /** Privy access token for authenticated API calls */
  getAccessToken: () => Promise<string | null>;
}

// ── Icons per notification type ───────────────────────────────────────────────

function NotificationIcon({ type }: { type: NotificationType }) {
  const iconClass = 'w-4 h-4 flex-shrink-0 mt-0.5';

  if (type === 'proposal_created') {
    return (
      <svg aria-hidden="true" className={iconClass} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} style={{ color: '#7d8c6e' }}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
      </svg>
    );
  }
  if (type === 'vote_closing') {
    return (
      <svg aria-hidden="true" className={iconClass} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} style={{ color: '#a07020' }}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
      </svg>
    );
  }
  if (type === 'content_approved') {
    return (
      <svg aria-hidden="true" className={iconClass} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} style={{ color: '#3d6b30' }}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
      </svg>
    );
  }
  if (type === 'content_rejected') {
    return (
      <svg aria-hidden="true" className={iconClass} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} style={{ color: '#b44444' }}>
        <path strokeLinecap="round" strokeLinejoin="round" d="m9.75 9.75 4.5 4.5m0-4.5-4.5 4.5M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
      </svg>
    );
  }
  // new_content
  return (
    <svg aria-hidden="true" className={iconClass} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} style={{ color: '#6060a0' }}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 7.5h1.5m-1.5 3h1.5m-7.5 3h7.5m-7.5 3h7.5m3-9h3.375c.621 0 1.125.504 1.125 1.125V18a2.25 2.25 0 0 1-2.25 2.25M16.5 7.5V18a2.25 2.25 0 0 0 2.25 2.25M16.5 7.5V4.875c0-.621-.504-1.125-1.125-1.125H4.125C3.504 3.75 3 4.254 3 4.875V18a2.25 2.25 0 0 0 2.25 2.25h13.5M6 7.5h3v3H6v-3Z" />
    </svg>
  );
}

// ── Relative timestamp ────────────────────────────────────────────────────────

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ── Component ─────────────────────────────────────────────────────────────────

export function NotificationBell({ getAccessToken }: Props) {
  const router = useRouter();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // ── Fetch helpers ──────────────────────────────────────────────────────────

  const fetchUnreadCount = useCallback(async () => {
    const token = await getAccessToken();
    if (!token) return;
    try {
      const res = await fetch('/api/notifications?unread=true', {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
      if (res.ok) {
        const data = await res.json();
        setUnreadCount(data.unreadCount ?? 0);
      }
    } catch {
      // Silently ignore network errors for badge polling
    }
  }, [getAccessToken]);

  const fetchAll = useCallback(async () => {
    const token = await getAccessToken();
    if (!token) return;
    try {
      const res = await fetch('/api/notifications', {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
      if (res.ok) {
        const data = await res.json();
        setNotifications(data.notifications ?? []);
        setUnreadCount(data.unreadCount ?? 0);
      }
    } catch {
      // Silently ignore
    }
  }, [getAccessToken]);

  // ── Initial load + polling (60s) ──────────────────────────────────────────

  useEffect(() => {
    void fetchUnreadCount();
    const id = setInterval(() => void fetchUnreadCount(), 60_000);
    return () => clearInterval(id);
  }, [fetchUnreadCount]);

  // ── Click-outside and Escape to close ────────────────────────────────────

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  // ── Open panel: fetch full list ───────────────────────────────────────────

  const toggleOpen = useCallback(() => {
    if (!open) {
      void fetchAll();
    }
    setOpen((prev) => !prev);
  }, [open, fetchAll]);

  // ── Mark all read ─────────────────────────────────────────────────────────

  const markAllRead = useCallback(async () => {
    setMarkingAll(true);
    const token = await getAccessToken();
    if (!token) { setMarkingAll(false); return; }
    try {
      await fetch('/api/notifications/mark-read', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
      setUnreadCount(0);
    } finally {
      setMarkingAll(false);
    }
  }, [getAccessToken]);

  // ── Click individual notification ─────────────────────────────────────────

  const handleNotificationClick = useCallback(
    async (n: Notification) => {
      setOpen(false);

      // Mark read optimistically
      if (!n.read) {
        setNotifications((prev) => prev.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
        setUnreadCount((prev) => Math.max(0, prev - 1));

        const token = await getAccessToken();
        if (token) {
          fetch(`/api/notifications/${n.id}/mark-read`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
          }).catch(() => {/* best-effort */});
        }
      }

      if (n.link) router.push(n.link);
    },
    [getAccessToken, router],
  );

  // ── Render ────────────────────────────────────────────────────────────────

  const displayCount = Math.min(unreadCount, 99);

  return (
    <div className="relative">
      {/* Bell button */}
      <button
        ref={buttonRef}
        onClick={toggleOpen}
        className="relative flex items-center justify-center w-8 h-8 rounded-full transition-colors"
        style={{ color: open ? '#3d4f38' : '#7d8c6e' }}
        aria-label={`Notifications${unreadCount > 0 ? ` (${displayCount} unread)` : ''}`}
        aria-haspopup="true"
        aria-expanded={open}
      >
        <svg
          className="w-5 h-5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0"
          />
        </svg>

        {/* Unread badge */}
        {unreadCount > 0 && (
          <span
            className="absolute -top-0.5 -right-0.5 flex items-center justify-center rounded-full text-white font-semibold"
            style={{
              background: '#b44444',
              minWidth: '16px',
              height: '16px',
              fontSize: '0.6rem',
              padding: '0 3px',
              lineHeight: 1,
            }}
            aria-hidden="true"
          >
            {displayCount}
            {unreadCount > 99 ? '+' : ''}
          </span>
        )}
      </button>

      {/* Dropdown panel */}
      {open && (
        <div
          ref={dropdownRef}
          className="absolute right-0 mt-1 z-50 rounded-xl shadow-lg overflow-hidden"
          style={{
            width: '340px',
            background: '#faf8f3',
            border: '1px solid #e0d8cc',
            maxHeight: '480px',
            display: 'flex',
            flexDirection: 'column',
          }}
          role="dialog"
          aria-label="Notifications"
        >
          {/* Header */}
          <div
            className="flex items-center justify-between px-4 py-2.5 flex-shrink-0"
            style={{ borderBottom: '1px solid #e0d8cc', background: '#f5f1e8' }}
          >
            <span className="text-xs font-semibold" style={{ color: '#3d4f38' }}>
              Notifications
              {unreadCount > 0 && (
                <span
                  className="ml-1.5 px-1.5 py-0.5 rounded-full text-xs font-semibold"
                  style={{ background: '#b44444', color: '#fff', fontSize: '0.6rem' }}
                >
                  {displayCount}{unreadCount > 99 ? '+' : ''}
                </span>
              )}
            </span>
            {unreadCount > 0 && (
              <button
                onClick={markAllRead}
                disabled={markingAll}
                className="text-xs transition-opacity disabled:opacity-50"
                style={{ color: '#7d8c6e' }}
              >
                {markingAll ? 'Marking…' : 'Mark all read'}
              </button>
            )}
          </div>

          {/* List */}
          <div className="overflow-y-auto flex-1">
            {notifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 px-4 text-center">
                <svg
                  aria-hidden="true"
                  className="w-8 h-8 mb-2"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1}
                  style={{ color: '#c8c0b0' }}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0"
                  />
                </svg>
                <p className="text-sm font-medium" style={{ color: '#5c5248' }}>
                  You are all caught up.
                </p>
                <p className="text-xs mt-0.5" style={{ color: '#9c9080' }}>
                  No notifications yet.
                </p>
              </div>
            ) : (
              notifications.map((n, i) => (
                <button
                  key={n.id}
                  onClick={() => void handleNotificationClick(n)}
                  className="w-full flex items-start gap-3 px-4 py-3 text-left transition-colors"
                  style={{
                    background: n.read ? 'transparent' : '#eef3eb',
                    borderBottom: i < notifications.length - 1 ? '1px solid #ede8e0' : 'none',
                  }}
                >
                  <NotificationIcon type={n.type} />
                  <div className="flex-1 min-w-0">
                    <p
                      className="text-xs leading-snug"
                      style={{
                        color: n.read ? '#5c5248' : '#3d4f38',
                        fontWeight: n.read ? 400 : 500,
                      }}
                    >
                      {n.message}
                    </p>
                    <p className="text-xs mt-0.5" style={{ color: '#9c9080' }}>
                      {relativeTime(n.createdAt)}
                    </p>
                  </div>
                  {!n.read && (
                    <span
                      className="w-2 h-2 rounded-full flex-shrink-0 mt-1"
                      style={{ background: '#b44444' }}
                      aria-hidden="true"
                    />
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
