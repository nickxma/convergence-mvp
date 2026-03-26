/**
 * POST /api/openclaw/sessions/:id/end
 *
 * Gracefully end an active claw session.
 *
 * Auth: valid Privy token (session owner only).
 *
 * Flow:
 *   1. Verify auth.
 *   2. Load session — verify ownership + active status.
 *   3. Update status to 'ended'.
 *   4. Publish session_end SSE event.
 *   5. Return { ok, creditsRemaining }.
 *
 * Error codes:
 *   SESSION_NOT_FOUND    — session doesn't exist or belongs to another user
 *   SESSION_ALREADY_ENDED — session is not active
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { verifyRequest } from '@/lib/privy-auth';
import { publishToSession, makeEvent } from '@/lib/claw-session-bus';
import { advanceQueue } from '@/lib/queue-utils';
import { trackEvent } from '@/lib/analytics-events';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function errorResponse(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id: sessionId } = await params;

  if (!UUID_RE.test(sessionId)) {
    return errorResponse(400, 'BAD_REQUEST', 'Invalid session id.');
  }

  const auth = await verifyRequest(req);
  if (!auth) {
    return errorResponse(401, 'UNAUTHORIZED', 'Valid Privy token required.');
  }

  const { data: session } = await supabase
    .from('claw_sessions')
    .select('id, machine_id, status, credits_remaining')
    .eq('id', sessionId)
    .eq('user_id', auth.userId)
    .single();

  if (!session) {
    return errorResponse(404, 'SESSION_NOT_FOUND', 'Session not found.');
  }

  if (session.status !== 'active') {
    return errorResponse(409, 'SESSION_ALREADY_ENDED', 'Session is not active.');
  }

  const { error: updateErr } = await supabase
    .from('claw_sessions')
    .update({ status: 'ended' })
    .eq('id', sessionId)
    .eq('status', 'active'); // optimistic guard

  if (updateErr) {
    console.error('[openclaw/sessions/end] db_error', updateErr.message);
    return errorResponse(500, 'DB_ERROR', 'Failed to end session.');
  }

  publishToSession(
    sessionId,
    makeEvent('session_end', {
      reason: 'user_ended',
      creditsRemaining: session.credits_remaining as number,
    }),
  );

  void trackEvent({
    eventType: 'session_end',
    sessionId,
    machineId: session.machine_id as string,
    userId: auth.userId,
    metadata: { reason: 'user_ended', creditsRemaining: session.credits_remaining as number },
  });

  // Advance the waitlist for this machine (fire-and-forget)
  void advanceQueue(session.machine_id as string);

  return NextResponse.json({ ok: true, creditsRemaining: session.credits_remaining as number });
}
