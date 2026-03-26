/**
 * POST /api/openclaw/sessions/:id/claim-prize
 *
 * Record a prize win for an active session and initiate the shipping flow.
 * Can be triggered by hardware sensor (machine secret) or by the session owner.
 *
 * Auth: either
 *   - X-Machine-Secret: <CLAW_MACHINE_SECRET>  (hardware sensor, env var)
 *   - Authorization: Bearer <privy-token>       (session owner)
 *
 * Body (optional): {
 *   shippingAddress?: { name, street, city, state, zip, country },
 *   prizeId?: string,
 *   prizeLabel?: string,
 *   playerDisplay?: string,
 * }
 *
 * Flow:
 *   1. Verify auth (machine secret OR Privy token).
 *   2. Load session — must be active.
 *   3. Set prize_won_at + prize_metadata; update status to 'ended'.
 *   4. Insert a prizes_won row (public win card).
 *   5. If shippingAddress provided, insert a prize_shipments row.
 *   6. Publish prize_detected (with winId) + session_end SSE events.
 *   7. Return { ok, prizeWonAt, winId, shipmentId? }.
 *
 * Error codes:
 *   SESSION_NOT_FOUND    — session not found (or wrong owner on Privy auth)
 *   SESSION_ALREADY_ENDED — session is not active
 *   PRIZE_ALREADY_WON    — prize already recorded for this session
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { verifyRequest } from '@/lib/privy-auth';
import { publishToSession, makeEvent } from '@/lib/claw-session-bus';
import { trackEvent } from '@/lib/analytics-events';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function errorResponse(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

function isMachineRequest(req: NextRequest): boolean {
  const secret = process.env.CLAW_MACHINE_SECRET;
  if (!secret) return false;
  return req.headers.get('x-machine-secret') === secret;
}

/** Derive a short non-identifying display label from a Privy DID. */
function derivedPlayerDisplay(userId: string): string {
  // Privy DIDs look like "did:privy:abc123..." — take last 6 chars
  const suffix = userId.replace(/^did:privy:/i, '').slice(-6).toUpperCase();
  return suffix ? `Player …${suffix}` : 'A lucky player';
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id: sessionId } = await params;

  if (!UUID_RE.test(sessionId)) {
    return errorResponse(400, 'BAD_REQUEST', 'Invalid session id.');
  }

  // Dual auth: machine secret (hardware) OR Privy token (session owner)
  const fromMachine = isMachineRequest(req);
  let callerUserId: string | null = null;

  if (!fromMachine) {
    const auth = await verifyRequest(req);
    if (!auth) {
      return errorResponse(401, 'UNAUTHORIZED', 'Valid Privy token or machine secret required.');
    }
    callerUserId = auth.userId;
  }

  // Parse optional body
  let shippingAddress: Record<string, string> | undefined;
  let prizeId: string | undefined;
  let prizeLabel: string | undefined;
  let playerDisplay: string | undefined;
  try {
    const body = await req.json();
    if (body.shippingAddress && typeof body.shippingAddress === 'object') {
      shippingAddress = body.shippingAddress as Record<string, string>;
    }
    if (typeof body.prizeId === 'string') prizeId = body.prizeId;
    if (typeof body.prizeLabel === 'string') prizeLabel = body.prizeLabel;
    if (typeof body.playerDisplay === 'string') playerDisplay = body.playerDisplay;
  } catch {
    // Body is optional — ignore parse errors
  }

  // Load session + machine name in one query
  let query = supabase
    .from('claw_sessions')
    .select('id, status, user_id, machine_id, prize_won_at')
    .eq('id', sessionId);

  // If Privy auth, enforce session ownership
  if (callerUserId) {
    query = query.eq('user_id', callerUserId);
  }

  const { data: session } = await query.single();

  if (!session) {
    return errorResponse(404, 'SESSION_NOT_FOUND', 'Session not found.');
  }

  if (session.status !== 'active') {
    return errorResponse(409, 'SESSION_ALREADY_ENDED', 'Session is not active.');
  }

  if (session.prize_won_at) {
    return errorResponse(409, 'PRIZE_ALREADY_WON', 'Prize already recorded for this session.');
  }

  // Fetch machine name for the win card
  const { data: machine } = await supabase
    .from('claw_machines')
    .select('id, name')
    .eq('id', session.machine_id as string)
    .single();

  const machineName = (machine?.name as string | null) ?? 'Claw Machine';

  const prizeWonAt = new Date().toISOString();
  const prizeMetadata: Record<string, unknown> = {
    wonAt: prizeWonAt,
    ...(prizeId !== undefined ? { prizeId } : {}),
    ...(shippingAddress ? { shippingAddress } : {}),
  };

  const { error: updateErr } = await supabase
    .from('claw_sessions')
    .update({
      prize_won_at: prizeWonAt,
      prize_metadata: prizeMetadata,
      status: 'ended',
    })
    .eq('id', sessionId)
    .eq('status', 'active'); // optimistic guard

  if (updateErr) {
    console.error('[openclaw/sessions/claim-prize] db_update_error', updateErr.message);
    return errorResponse(500, 'DB_ERROR', 'Failed to record prize.');
  }

  // Create the public win card record in prizes_won
  const userId = (session.user_id as string) ?? '';
  const displayName =
    playerDisplay ?? derivedPlayerDisplay(userId);

  let winId: string | null = null;
  const { data: winRow, error: winErr } = await supabase
    .from('prizes_won')
    .insert({
      session_id: sessionId,
      user_id: userId,
      machine_id: session.machine_id as string,
      machine_name: machineName,
      player_display: displayName,
      prize_label: prizeLabel ?? null,
      prize_photo_url: null,
      won_at: prizeWonAt,
      ...(shippingAddress
        ? { address: shippingAddress, address_submitted_at: prizeWonAt }
        : {}),
    })
    .select('id')
    .single();

  if (winErr) {
    // Non-fatal: win is still recorded in claw_sessions; win card is best-effort
    console.error('[openclaw/sessions/claim-prize] prizes_won_error', winErr.message);
  } else if (winRow) {
    winId = winRow.id as string;
  }

  // Create shipment record if shipping address was provided
  let shipmentId: string | null = null;
  if (shippingAddress) {
    const { data: shipment, error: shipErr } = await supabase
      .from('prize_shipments')
      .insert({
        session_id: sessionId,
        user_id: userId,
        address: shippingAddress,
        prize_meta: prizeMetadata,
        status: 'pending',
      })
      .select('id')
      .single();

    if (shipErr) {
      // Non-fatal: prize is recorded; shipping can be retried separately
      console.error('[openclaw/sessions/claim-prize] shipment_error', shipErr.message);
    } else if (shipment) {
      shipmentId = shipment.id as string;
    }
  }

  void trackEvent({
    eventType: 'prize_won',
    sessionId,
    machineId: session.machine_id as string,
    userId,
    metadata: { prizeId: prizeId ?? null, prizeLabel: prizeLabel ?? null, winId },
  });

  void trackEvent({
    eventType: 'session_end',
    sessionId,
    machineId: session.machine_id as string,
    userId,
    metadata: { reason: 'prize_claimed' },
  });

  // Notify SSE subscribers — include winId so the play page can show share link
  publishToSession(
    sessionId,
    makeEvent('prize_detected', {
      prizeId: prizeId ?? null,
      prizeWonAt,
      winId,
    }),
  );
  publishToSession(sessionId, makeEvent('session_end', { reason: 'prize_claimed', prizeWonAt }));

  return NextResponse.json({
    ok: true,
    prizeWonAt,
    ...(winId ? { winId } : {}),
    ...(shipmentId ? { shipmentId } : {}),
  });
}
