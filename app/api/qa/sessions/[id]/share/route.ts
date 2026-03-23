import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { verifyRequest } from '@/lib/privy-auth';
import { supabase } from '@/lib/supabase';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_PARTICIPANTS = 5;

/**
 * POST /api/qa/sessions/:id/share
 *
 * Marks a qa_conversation as collaborative and returns a shareable join URL.
 * Idempotent — calling it multiple times returns the same token.
 *
 * Auth: Bearer token (Privy JWT). Caller must own the session.
 */
export async function POST(
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

  // Fetch the session; verify ownership
  const { data: session, error: fetchError } = await supabase
    .from('qa_conversations')
    .select('id, user_id, is_collaborative, share_token')
    .eq('id', id)
    .single();

  if (fetchError || !session) {
    return NextResponse.json(
      { error: { code: 'NOT_FOUND', message: 'Session not found.' } },
      { status: 404 },
    );
  }

  if (session.user_id !== userId) {
    return NextResponse.json(
      { error: { code: 'FORBIDDEN', message: 'You do not own this session.' } },
      { status: 403 },
    );
  }

  // Idempotent: return existing token if already shared
  if (session.is_collaborative && session.share_token) {
    const joinUrl = buildJoinUrl(req, session.share_token as string);
    return NextResponse.json({ shareToken: session.share_token, joinUrl, maxParticipants: MAX_PARTICIPANTS });
  }

  const shareToken = randomUUID();

  const { error: updateError } = await supabase
    .from('qa_conversations')
    .update({
      is_collaborative: true,
      share_token: shareToken,
      owner_user_id: userId,
    })
    .eq('id', id);

  if (updateError) {
    console.error('[share] supabase_error:', updateError.message);
    return NextResponse.json(
      { error: { code: 'DB_ERROR', message: 'Failed to generate share link.' } },
      { status: 500 },
    );
  }

  const joinUrl = buildJoinUrl(req, shareToken);
  return NextResponse.json({ shareToken, joinUrl, maxParticipants: MAX_PARTICIPANTS }, { status: 201 });
}

function buildJoinUrl(req: NextRequest, token: string): string {
  const origin = req.headers.get('origin') ?? req.nextUrl.origin;
  return `${origin}/qa/join/${token}`;
}
