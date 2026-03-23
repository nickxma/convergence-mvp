'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { getSupabaseBrowser } from '@/lib/supabase-browser';
import type { RealtimeChannel } from '@supabase/supabase-js';

export interface Participant {
  userId: string;
  displayName: string | null;
  joinedAt: string;
  isOwner: boolean;
  isSelf: boolean;
}

interface TypingUser {
  userId: string;
  displayName: string | null;
  /** ISO timestamp when we last heard from this user — stale after 3 s */
  at: string;
}

interface BroadcastTypingPayload {
  userId: string;
  displayName: string | null;
  isTyping: boolean;
}

interface BroadcastMessagePayload {
  sessionId: string;
  turnIndex: number;
  role: 'user' | 'assistant';
  content: string;
  authorUserId?: string;
  authorDisplayName?: string | null;
}

export interface UseCollaborativeSessionOptions {
  /** UUID of the qa_conversation */
  sessionId: string | null;
  /** Calling user's Privy user id */
  userId: string | null;
  /** Short display name shown to other participants */
  displayName: string | null;
  /** Privy access token for heartbeat API calls */
  accessToken: string | null;
  /** Called when a remote participant submits a new message turn */
  onRemoteMessage?: (payload: BroadcastMessagePayload) => void;
}

export interface CollaborativeSessionState {
  participants: Participant[];
  typingUsers: TypingUser[];
  connected: boolean;
  /** Call when the local user starts/stops typing */
  sendTyping: (isTyping: boolean) => void;
  /** Broadcast a completed message turn to other participants */
  broadcastMessage: (payload: Omit<BroadcastMessagePayload, 'sessionId'>) => void;
}

const HEARTBEAT_INTERVAL_MS = 30_000; // keep participant record alive
const TYPING_STALE_MS = 3_000;        // hide typing indicator after 3 s of silence
const POLL_INTERVAL_MS = 15_000;      // fallback participant poll when Realtime unavailable

/**
 * useCollaborativeSession
 *
 * Manages real-time presence and broadcast for a shared Q&A session.
 *
 * Uses Supabase Realtime broadcast channels when NEXT_PUBLIC_SUPABASE_URL and
 * NEXT_PUBLIC_SUPABASE_ANON_KEY are configured. Falls back to REST polling for
 * participants when Realtime is unavailable.
 */
export function useCollaborativeSession({
  sessionId,
  userId,
  displayName,
  accessToken,
  onRemoteMessage,
}: UseCollaborativeSessionOptions): CollaborativeSessionState {
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [typingUsers, setTypingUsers] = useState<TypingUser[]>([]);
  const [connected, setConnected] = useState(false);

  const channelRef = useRef<RealtimeChannel | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const typingTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // ── Fetch participant list via REST ─────────────────────────────────────────

  const fetchParticipants = useCallback(async () => {
    if (!sessionId || !accessToken) return;
    try {
      const res = await fetch(`/api/qa/sessions/${sessionId}/participants`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) return;
      const data: { participants: Participant[] } = await res.json();
      setParticipants(data.participants);
    } catch {
      // network error — keep stale list
    }
  }, [sessionId, accessToken]);

  // ── Presence heartbeat ──────────────────────────────────────────────────────

  const sendHeartbeat = useCallback(async () => {
    if (!sessionId || !accessToken) return;
    try {
      await fetch(`/api/qa/sessions/${sessionId}/participants`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
    } catch {
      // swallow — heartbeat is best-effort
    }
  }, [sessionId, accessToken]);

  // ── Typing indicator helpers ────────────────────────────────────────────────

  const clearTypingTimer = useCallback((uid: string) => {
    const t = typingTimersRef.current.get(uid);
    if (t) clearTimeout(t);
    typingTimersRef.current.delete(uid);
  }, []);

  const markTyping = useCallback(
    (uid: string, dName: string | null) => {
      setTypingUsers((prev) => {
        const others = prev.filter((u) => u.userId !== uid);
        return [...others, { userId: uid, displayName: dName, at: new Date().toISOString() }];
      });
      clearTypingTimer(uid);
      const t = setTimeout(() => {
        setTypingUsers((prev) => prev.filter((u) => u.userId !== uid));
        typingTimersRef.current.delete(uid);
      }, TYPING_STALE_MS);
      typingTimersRef.current.set(uid, t);
    },
    [clearTypingTimer],
  );

  const clearTyping = useCallback(
    (uid: string) => {
      clearTypingTimer(uid);
      setTypingUsers((prev) => prev.filter((u) => u.userId !== uid));
    },
    [clearTypingTimer],
  );

  // ── Broadcast helpers (returned to component) ───────────────────────────────

  const sendTyping = useCallback(
    (isTyping: boolean) => {
      if (!channelRef.current || !userId) return;
      channelRef.current.send({
        type: 'broadcast',
        event: 'typing',
        payload: { userId, displayName, isTyping } satisfies BroadcastTypingPayload,
      });
    },
    [userId, displayName],
  );

  const broadcastMessage = useCallback(
    (payload: Omit<BroadcastMessagePayload, 'sessionId'>) => {
      if (!channelRef.current || !sessionId) return;
      channelRef.current.send({
        type: 'broadcast',
        event: 'message',
        payload: { ...payload, sessionId } satisfies BroadcastMessagePayload,
      });
    },
    [sessionId],
  );

  // ── Main effect — subscribe to Realtime channel ─────────────────────────────

  useEffect(() => {
    if (!sessionId || !userId) return;

    const supabase = getSupabaseBrowser();

    // Start presence heartbeat regardless of Realtime availability
    sendHeartbeat();
    fetchParticipants();

    heartbeatRef.current = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);

    if (!supabase) {
      // No browser Supabase client — fall back to polling for participants
      pollRef.current = setInterval(fetchParticipants, POLL_INTERVAL_MS);
      return () => {
        if (heartbeatRef.current) clearInterval(heartbeatRef.current);
        if (pollRef.current) clearInterval(pollRef.current);
      };
    }

    // Subscribe to broadcast channel `session:{sessionId}`
    const channel = supabase.channel(`session:${sessionId}`, {
      config: { broadcast: { self: false } },
    });

    channel
      .on('broadcast', { event: 'typing' }, ({ payload }: { payload: BroadcastTypingPayload }) => {
        if (payload.userId === userId) return; // ignore self (self:false should already filter)
        if (payload.isTyping) {
          markTyping(payload.userId, payload.displayName);
        } else {
          clearTyping(payload.userId);
        }
      })
      .on('broadcast', { event: 'message' }, ({ payload }: { payload: BroadcastMessagePayload }) => {
        if (payload.authorUserId === userId) return; // ignore own echoes
        onRemoteMessage?.(payload);
        // Refresh participants after a new message (someone may have just joined)
        fetchParticipants();
      })
      .on('broadcast', { event: 'participant_join' }, () => {
        fetchParticipants();
      })
      .subscribe((status) => {
        setConnected(status === 'SUBSCRIBED');
        if (status === 'SUBSCRIBED') {
          // Announce presence to channel
          channel.send({
            type: 'broadcast',
            event: 'participant_join',
            payload: { userId, displayName },
          });
          fetchParticipants();
        }
      });

    channelRef.current = channel;

    // Also poll less frequently as a safety net against missed events
    pollRef.current = setInterval(fetchParticipants, POLL_INTERVAL_MS);

    return () => {
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      if (pollRef.current) clearInterval(pollRef.current);
      typingTimersRef.current.forEach(clearTimeout);
      typingTimersRef.current.clear();
      channel.unsubscribe();
    };
  }, [sessionId, userId]); // eslint-disable-line react-hooks/exhaustive-deps

  return { participants, typingUsers, connected, sendTyping, broadcastMessage };
}
