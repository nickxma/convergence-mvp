'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { QAInterface, type QAInterfaceActions } from '@/components/qa-interface';
import { type Conversation, newConversationId } from '@/lib/conversations';
import type { Participant } from '@/hooks/use-collaborative-session';

interface JoinSessionClientProps {
  token: string;
}

type JoinState =
  | { status: 'loading' }
  | { status: 'requires_auth' }
  | { status: 'error'; message: string }
  | { status: 'full' }
  | { status: 'ready'; sessionId: string; title: string; conversation: Conversation; participants: Participant[]; ownerUserId: string | null };

export function JoinSessionClient({ token }: JoinSessionClientProps) {
  const { ready, authenticated, login, getAccessToken } = usePrivy();
  const actionsRef = useRef<QAInterfaceActions | null>(null);
  const [joinState, setJoinState] = useState<JoinState>({ status: 'loading' });

  const doJoin = useCallback(async () => {
    if (!ready) return;
    if (!authenticated) {
      setJoinState({ status: 'requires_auth' });
      return;
    }

    try {
      const token_ = await getAccessToken();
      const res = await fetch(`/api/qa/sessions/join/${token}`, {
        headers: token_ ? { Authorization: `Bearer ${token_}` } : {},
      });

      if (res.status === 401) { setJoinState({ status: 'requires_auth' }); return; }
      if (res.status === 409) { setJoinState({ status: 'full' }); return; }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setJoinState({ status: 'error', message: (body as { error?: { message?: string } }).error?.message ?? 'Could not join session.' });
        return;
      }

      const data = await res.json() as {
        sessionId: string;
        title: string;
        messages: Array<{ role: string; content: string; sources?: unknown[] }>;
        participants: Participant[];
        maxParticipants: number;
        ownerUserId: string | null;
      };

      const conversation: Conversation = {
        id: newConversationId(),
        serverConversationId: data.sessionId,
        userId: '',
        title: data.title,
        messages: data.messages.map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        })),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      setJoinState({
        status: 'ready',
        sessionId: data.sessionId,
        title: data.title,
        conversation,
        participants: data.participants,
        ownerUserId: data.ownerUserId,
      });
    } catch {
      setJoinState({ status: 'error', message: 'Network error. Please try again.' });
    }
  }, [ready, authenticated, getAccessToken, token]);

  useEffect(() => {
    void doJoin();
  }, [doJoin]);

  // ── Auth gate ───────────────────────────────────────────────────────────────

  if (!ready || joinState.status === 'loading') {
    return (
      <div className="flex items-center justify-center h-screen" style={{ background: 'var(--bg)' }}>
        <div className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading session…</div>
      </div>
    );
  }

  if (joinState.status === 'requires_auth') {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-4" style={{ background: 'var(--bg)' }}>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          Sign in to join this shared Q&amp;A session.
        </p>
        <button
          onClick={() => login()}
          className="px-4 py-2 rounded-full text-sm"
          style={{ background: 'var(--sage)', color: '#fff' }}
        >
          Sign in to join
        </button>
      </div>
    );
  }

  if (joinState.status === 'full') {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-2" style={{ background: 'var(--bg)' }}>
        <p className="text-base font-medium" style={{ color: 'var(--text)' }}>Session is full</p>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          This session already has 5 participants. Ask the host to share a new link.
        </p>
      </div>
    );
  }

  if (joinState.status === 'error') {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-2" style={{ background: 'var(--bg)' }}>
        <p className="text-base font-medium" style={{ color: 'var(--error-text, #c0392b)' }}>
          Could not join session
        </p>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{joinState.message}</p>
        <a href="/ask" className="text-sm underline mt-2" style={{ color: 'var(--sage)' }}>
          Start your own conversation
        </a>
      </div>
    );
  }

  // ── Joined — render collaborative Q&A interface ─────────────────────────────

  const { conversation, sessionId, participants } = joinState;

  return (
    <div className="flex flex-col h-screen" style={{ background: 'var(--bg)' }}>
      {/* Session header */}
      <div
        className="flex items-center justify-between px-4 py-2 border-b flex-shrink-0"
        style={{ borderColor: 'var(--border)', background: 'var(--bg)' }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full flex-shrink-0"
            style={{ background: 'var(--sage-bg, #e8f0ec)', color: 'var(--sage)' }}
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 0 0 3.741-.479 3 3 0 0 0-4.682-2.72m.94 3.198.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0 1 12 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 0 1 6 18.719m12 0a5.971 5.971 0 0 0-.941-3.197m0 0A5.995 5.995 0 0 0 12 12.75a5.995 5.995 0 0 0-5.058 2.772m0 0a3 3 0 0 0-4.681 2.72 8.986 8.986 0 0 0 3.74.477m.94-3.197a5.971 5.971 0 0 0-.94 3.197M15 6.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm6 3a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Zm-13.5 0a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Z" />
            </svg>
            Collaborative
          </span>
          <span className="text-sm truncate" style={{ color: 'var(--text-muted)' }}>
            {joinState.title}
          </span>
        </div>

        {/* Participant avatars */}
        <ParticipantAvatars participants={participants} sessionId={sessionId} />
      </div>

      <div className="flex-1 min-h-0">
        <QAInterface
          initialConversation={conversation}
          actionsRef={actionsRef}
          collaborativeSessionId={sessionId}
        />
      </div>
    </div>
  );
}

function ParticipantAvatars({
  participants,
  sessionId: _sessionId,
}: {
  participants: Participant[];
  sessionId: string;
}) {
  if (participants.length === 0) return null;
  const shown = participants.slice(0, 5);
  const extra = participants.length - shown.length;

  return (
    <div className="flex items-center gap-1 flex-shrink-0 ml-3">
      {shown.map((p) => (
        <div
          key={p.userId}
          title={p.displayName ?? p.userId}
          className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium border-2 flex-shrink-0"
          style={{
            background: p.isSelf ? 'var(--sage)' : 'var(--bg-chip)',
            color: p.isSelf ? '#fff' : 'var(--text)',
            borderColor: p.isOwner ? 'var(--sage)' : 'var(--border)',
          }}
        >
          {initials(p.displayName ?? p.userId)}
        </div>
      ))}
      {extra > 0 && (
        <div
          className="w-7 h-7 rounded-full flex items-center justify-center text-xs flex-shrink-0"
          style={{ background: 'var(--bg-chip)', color: 'var(--text-muted)' }}
        >
          +{extra}
        </div>
      )}
    </div>
  );
}

function initials(name: string): string {
  if (!name) return '?';
  // ENS-style: 0x1234…abcd → show first 2 of hex
  if (name.startsWith('0x')) return name.slice(2, 4).toUpperCase();
  // …abcd → last 2
  if (name.startsWith('…')) return name.slice(-2).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}
