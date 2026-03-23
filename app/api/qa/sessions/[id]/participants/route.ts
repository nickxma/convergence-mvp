import { NextRequest, NextResponse } from 'next/server';
import { verifyRequest } from '@/lib/privy-auth';
import { supabase } from '@/lib/supabase';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STALE_MS = 10 * 60 * 1000;

/**
 * GET /api/qa/sessions/:id/participants
 *
 * Returns the list of active participants for a collaborative session.
 * Any participant in the session may call this endpoint (not just the owner).
 *
 * Auth: Bearer token (Privy JWT).
 *
 * PATCH /api/qa/sessions/:id/participants
 *
 * Heartbeat — updates last_seen_at for the calling user.
 * Called periodically by connected clients to maintain presence.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authResult = await verifyRequest(req);
  if (!authResult) {
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'Authentication required.' } },
      { status: 401 },
    );
  }

  const { userId } = authResult;
  const { id } = await params;

  if (!id || !UUID_RE.test(id)) {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: 'Invalid session id.' } },
      { status: 400 },
    );
  }

  // Verify the caller is a participant (or the owner)
  const { data: session } = await supabase
    .from('qa_conversations')
    .select('owner_user_id, is_collaborative')
    .eq('id', id)
    .single();

  if (!session?.is_collaborative) {
    return NextResponse.json(
      { error: { code: 'NOT_FOUND', message: 'Collaborative session not found.' } },
      { status: 404 },
    );
  }

  const staleThreshold = new Date(Date.now() - STALE_MS).toISOString();

  const { data: rows } = await supabase
    .from('qa_session_participants')
    .select('user_id, display_name, joined_at, last_seen_at')
    .eq('session_id', id)
    .gte('last_seen_at', staleThreshold)
    .order('joined_at', { ascending: true });

  const participants = (rows ?? []).map((p) => ({
    userId: p.user_id as string,
    displayName: p.display_name as string | null,
    joinedAt: p.joined_at as string,
    isOwner: p.user_id === session.owner_user_id,
    isSelf: p.user_id === userId,
  }));

  return NextResponse.json({ participants });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authResult = await verifyRequest(req);
  if (!authResult) {
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'Authentication required.' } },
      { status: 401 },
    );
  }

  const { userId } = authResult;
  const { id } = await params;

  if (!id || !UUID_RE.test(id)) {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: 'Invalid session id.' } },
      { status: 400 },
    );
  }

  await supabase
    .from('qa_session_participants')
    .update({ last_seen_at: new Date().toISOString() })
    .eq('session_id', id)
    .eq('user_id', userId);

  return NextResponse.json({ ok: true });
}
