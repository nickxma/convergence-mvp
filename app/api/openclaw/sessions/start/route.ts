/**
 * POST /api/openclaw/sessions/start
 *
 * Reserve a claw machine and start a new play session.
 *
 * Body: { machineId: string, credits?: number }
 *
 * Auth: valid Privy token.
 *
 * Flow:
 *   1. Verify Privy auth.
 *   2. Validate machineId; check machine exists and is 'online'.
 *   3. Reject if an active session already exists for this machine.
 *   4. Create claw_session row.
 *   5. Return session metadata.
 *
 * Error codes:
 *   MACHINE_NOT_FOUND — machineId doesn't exist
 *   MACHINE_OFFLINE   — machine is not 'online'
 *   MACHINE_BUSY      — another session is already active on this machine
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { verifyRequest } from '@/lib/privy-auth';
import { trackEvent } from '@/lib/analytics-events';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_CREDITS = 10;
const MAX_CREDITS = 30;
const SESSION_MINUTES = 5;

function errorResponse(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await verifyRequest(req);
  if (!auth) {
    return errorResponse(401, 'UNAUTHORIZED', 'Valid Privy token required.');
  }

  let machineId: string;
  let credits: number;
  try {
    const body = await req.json();
    machineId = body.machineId;
    credits =
      typeof body.credits === 'number'
        ? Math.min(Math.max(1, body.credits), MAX_CREDITS)
        : DEFAULT_CREDITS;
  } catch {
    return errorResponse(400, 'BAD_REQUEST', 'Invalid JSON body.');
  }

  if (!machineId || !UUID_RE.test(machineId)) {
    return errorResponse(400, 'BAD_REQUEST', 'machineId required (UUID).');
  }

  // Verify machine exists and is online
  const { data: machine } = await supabase
    .from('claw_machines')
    .select('id, status')
    .eq('id', machineId)
    .single();

  if (!machine) {
    return errorResponse(404, 'MACHINE_NOT_FOUND', 'Machine not found.');
  }

  if (machine.status !== 'online') {
    return errorResponse(409, 'MACHINE_OFFLINE', `Machine is ${machine.status}.`);
  }

  // Reject if another active session exists for this machine
  const { data: existing } = await supabase
    .from('claw_sessions')
    .select('id')
    .eq('machine_id', machineId)
    .eq('status', 'active')
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();

  if (existing) {
    return errorResponse(409, 'MACHINE_BUSY', 'Machine already has an active session.');
  }

  const expiresAt = new Date(Date.now() + SESSION_MINUTES * 60 * 1000).toISOString();

  const { data: session, error: insertErr } = await supabase
    .from('claw_sessions')
    .insert({
      machine_id: machineId,
      user_id: auth.userId,
      credits_remaining: credits,
      expires_at: expiresAt,
      status: 'active',
    })
    .select('id, machine_id, user_id, credits_remaining, started_at, expires_at')
    .single();

  if (insertErr || !session) {
    console.error('[openclaw/sessions/start] db_error', insertErr?.message);
    return errorResponse(500, 'DB_ERROR', 'Failed to create session.');
  }

  const embedded = req.headers.get('x-embed-session') === '1';

  void trackEvent({
    eventType: 'session_start',
    sessionId: session.id as string,
    machineId: session.machine_id as string,
    userId: auth.userId,
    metadata: { creditsAllocated: credits, ...(embedded ? { embedded: true } : {}) },
  });

  // Fire referral conversion for the user's first paid session (best-effort, non-blocking).
  void supabase.rpc('convert_referral', { p_referee_id: auth.userId });

  return NextResponse.json(
    {
      sessionId: session.id as string,
      machineId: session.machine_id as string,
      userId: session.user_id as string,
      startsAt: session.started_at as string,
      expiresAt: session.expires_at as string,
      creditsRemaining: session.credits_remaining as number,
    },
    { status: 201 },
  );
}
