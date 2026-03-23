import { NextRequest, NextResponse } from 'next/server';
import { verifyRequest } from '@/lib/privy-auth';
import { supabase } from '@/lib/supabase';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_PARTICIPANTS = 5;
const STALE_MS = 10 * 60 * 1000; // 10 minutes

/**
 * GET /api/qa/sessions/join/:token
 *
 * Looks up a collaborative session by its share token, registers the caller
 * as a participant (upsert), and returns the session context needed to render
 * the joined session in the Q&A interface.
 *
 * Auth: Bearer token (Privy JWT).
 *
 * Response:
 *   sessionId       — UUID of the qa_conversation
 *   title           — derived from first user message
 *   messages        — full message history
 *   participants    — list of active participants (joined within last 10 min)
 *   maxParticipants — cap (5)
 *   ownerUserId     — userId of session creator
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const authResult = await verifyRequest(req);
  if (!authResult) {
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'Authentication required.' } },
      { status: 401 },
    );
  }

  const { userId, walletAddress } = authResult;
  const { token } = await params;

  if (!token || !UUID_RE.test(token)) {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: 'Invalid share token.' } },
      { status: 400 },
    );
  }

  // Look up session by share token
  const { data: session, error: fetchError } = await supabase
    .from('qa_conversations')
    .select('id, messages, owner_user_id, is_collaborative')
    .eq('share_token', token)
    .eq('is_collaborative', true)
    .single();

  if (fetchError || !session) {
    return NextResponse.json(
      { error: { code: 'NOT_FOUND', message: 'Session not found or sharing has been disabled.' } },
      { status: 404 },
    );
  }

  const sessionId = session.id as string;
  const staleThreshold = new Date(Date.now() - STALE_MS).toISOString();

  // Count active participants to enforce the cap (exclude the joiner themselves)
  const { count } = await supabase
    .from('qa_session_participants')
    .select('user_id', { count: 'exact', head: true })
    .eq('session_id', sessionId)
    .neq('user_id', userId)
    .gte('last_seen_at', staleThreshold);

  const activeOthers = count ?? 0;

  if (activeOthers >= MAX_PARTICIPANTS - 1) {
    // Session already has MAX_PARTICIPANTS active (owner + 4 others)
    const ownerSlot = session.owner_user_id === userId ? 1 : 0;
    if (activeOthers + ownerSlot >= MAX_PARTICIPANTS) {
      return NextResponse.json(
        { error: { code: 'SESSION_FULL', message: 'This session is full (max 5 participants).' } },
        { status: 409 },
      );
    }
  }

  // Register / refresh participant
  const displayName = shortAddress(walletAddress);
  await supabase
    .from('qa_session_participants')
    .upsert(
      { session_id: sessionId, user_id: userId, display_name: displayName, last_seen_at: new Date().toISOString() },
      { onConflict: 'session_id,user_id' },
    );

  // Fetch current active participants
  const { data: participantRows } = await supabase
    .from('qa_session_participants')
    .select('user_id, display_name, joined_at')
    .eq('session_id', sessionId)
    .gte('last_seen_at', staleThreshold)
    .order('joined_at', { ascending: true });

  const participants = (participantRows ?? []).map((p) => ({
    userId: p.user_id as string,
    displayName: (p.display_name as string | null) ?? shortAddress(p.user_id as string),
    joinedAt: p.joined_at as string,
  }));

  const messages = (session.messages as Array<{ role: string; content: string }>) ?? [];
  const firstQuestion = messages.find((m) => m.role === 'user')?.content ?? '';
  const title = firstQuestion.length > 80
    ? firstQuestion.slice(0, 80) + '\u2026'
    : firstQuestion || 'Collaborative Session';

  return NextResponse.json({
    sessionId,
    title,
    messages,
    participants,
    maxParticipants: MAX_PARTICIPANTS,
    ownerUserId: session.owner_user_id as string | null,
  });
}

/** Shorten an Ethereum address or Privy DID for display */
function shortAddress(addr: string): string {
  if (!addr) return 'Anon';
  if (addr.startsWith('0x') && addr.length >= 10) {
    return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
  }
  // Privy DID (did:privy:…) — show last 6
  if (addr.length > 8) return `…${addr.slice(-6)}`;
  return addr;
}
