/**
 * GET    /api/admin/machines/:id  — get machine + active session + history
 * PATCH  /api/admin/machines/:id  — update a machine
 * DELETE /api/admin/machines/:id  — remove a machine
 *
 * Auth: Bearer ADMIN_WALLET
 *
 * PATCH body (all fields optional):
 *   name, location, streamUrl, controllerUrl, mqttTopic,
 *   creditsPerPlay, prizeStockCount, prizeStockThreshold, status
 *
 * DELETE: 204 on success. Fails with 409 if machine has active sessions.
 *
 * Side effect: setting status to offline/maintenance force-ends active sessions.
 */

import { NextRequest, NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/admin-auth';
import { supabase } from '@/lib/supabase';
import { publishToSession, makeEvent } from '@/lib/claw-session-bus';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_STATUSES = new Set(['online', 'offline', 'maintenance']);

function errorResponse(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!isAdminRequest(req)) {
    return errorResponse(403, 'FORBIDDEN', 'Admin access required.');
  }

  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return errorResponse(400, 'BAD_REQUEST', 'Invalid machine id.');
  }

  const { data: machine, error } = await supabase
    .from('claw_machines')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !machine) {
    return errorResponse(404, 'NOT_FOUND', 'Machine not found.');
  }

  const { data: activeSession } = await supabase
    .from('claw_sessions')
    .select('id, user_id, credits_remaining, started_at, expires_at, status')
    .eq('machine_id', id)
    .eq('status', 'active')
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();

  const { data: history } = await supabase
    .from('claw_sessions')
    .select('id, user_id, status, credits_remaining, started_at, expires_at, prize_won_at')
    .eq('machine_id', id)
    .order('started_at', { ascending: false })
    .limit(10);

  return NextResponse.json({
    machine: serializeMachine(machine),
    activeSession: activeSession ?? null,
    history: history ?? [],
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!isAdminRequest(req)) {
    return errorResponse(403, 'FORBIDDEN', 'Admin access required.');
  }

  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return errorResponse(400, 'BAD_REQUEST', 'Invalid machine id.');
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return errorResponse(400, 'BAD_REQUEST', 'Invalid JSON body.');
  }

  const updates: Record<string, unknown> = {};

  if (body.name !== undefined) {
    const name = (body.name as string).trim();
    if (!name) return errorResponse(400, 'BAD_REQUEST', 'name cannot be empty.');
    updates.name = name;
  }
  if (body.location !== undefined) {
    updates.location = (body.location as string | null)?.trim() ?? null;
  }
  if (body.streamUrl !== undefined) {
    const url = (body.streamUrl as string).trim();
    if (!url) return errorResponse(400, 'BAD_REQUEST', 'streamUrl cannot be empty.');
    updates.stream_url = url;
  }
  if (body.controllerUrl !== undefined) {
    updates.controller_url = (body.controllerUrl as string | null)?.trim() ?? null;
  }
  if (body.mqttTopic !== undefined) {
    updates.mqtt_topic = (body.mqttTopic as string | null)?.trim() ?? null;
  }
  if (body.status !== undefined) {
    if (!VALID_STATUSES.has(body.status as string)) {
      return errorResponse(400, 'BAD_REQUEST', 'status must be online | offline | maintenance.');
    }
    updates.status = body.status;
  }
  if (body.creditsPerPlay !== undefined) {
    const v = body.creditsPerPlay as number;
    if (!Number.isInteger(v) || v < 1) {
      return errorResponse(400, 'BAD_REQUEST', 'creditsPerPlay must be a positive integer.');
    }
    updates.credits_per_play = v;
  }
  if (body.prizeStockCount !== undefined) {
    const v = body.prizeStockCount as number;
    if (!Number.isInteger(v) || v < 0) {
      return errorResponse(400, 'BAD_REQUEST', 'prizeStockCount must be a non-negative integer.');
    }
    updates.prize_stock_count = v;
  }
  if (body.prizeStockThreshold !== undefined) {
    const v = body.prizeStockThreshold as number;
    if (!Number.isInteger(v) || v < 0) {
      return errorResponse(400, 'BAD_REQUEST', 'prizeStockThreshold must be a non-negative integer.');
    }
    updates.prize_stock_threshold = v;
  }

  if (Object.keys(updates).length === 0) {
    return errorResponse(400, 'BAD_REQUEST', 'No valid fields provided for update.');
  }

  const { data: machine, error: updateErr } = await supabase
    .from('claw_machines')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (updateErr) {
    if (updateErr.code === 'PGRST116') {
      return errorResponse(404, 'NOT_FOUND', 'Machine not found.');
    }
    console.error('[admin/machines/patch] db_error:', updateErr.message);
    return errorResponse(500, 'DB_ERROR', 'Failed to update machine.');
  }

  // Force-end active sessions when machine goes offline or into maintenance
  if (updates.status === 'offline' || updates.status === 'maintenance') {
    const { data: activeSessions } = await supabase
      .from('claw_sessions')
      .select('id')
      .eq('machine_id', id)
      .eq('status', 'active');

    if (activeSessions && activeSessions.length > 0) {
      await supabase
        .from('claw_sessions')
        .update({ status: 'ended' })
        .eq('machine_id', id)
        .eq('status', 'active');

      for (const s of activeSessions) {
        publishToSession(
          s.id as string,
          makeEvent('session_end', { reason: 'machine_offline' }),
        );
      }
    }
  }

  return NextResponse.json({ machine: serializeMachine(machine) });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!isAdminRequest(req)) {
    return errorResponse(403, 'FORBIDDEN', 'Admin access required.');
  }

  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return errorResponse(400, 'BAD_REQUEST', 'Invalid machine id.');
  }

  // Block deletion if active sessions exist
  const { count, error: countErr } = await supabase
    .from('claw_sessions')
    .select('id', { count: 'exact', head: true })
    .eq('machine_id', id)
    .eq('status', 'active')
    .gt('expires_at', new Date().toISOString());

  if (countErr) {
    console.error('[admin/machines/delete] count_error:', countErr.message);
    return errorResponse(500, 'DB_ERROR', 'Failed to check active sessions.');
  }

  if ((count ?? 0) > 0) {
    return errorResponse(409, 'MACHINE_BUSY', 'Cannot delete: machine has active sessions.');
  }

  const { error: deleteErr } = await supabase
    .from('claw_machines')
    .delete()
    .eq('id', id);

  if (deleteErr) {
    if (deleteErr.code === 'PGRST116') {
      return errorResponse(404, 'NOT_FOUND', 'Machine not found.');
    }
    console.error('[admin/machines/delete] db_error:', deleteErr.message);
    return errorResponse(500, 'DB_ERROR', 'Failed to delete machine.');
  }

  return new NextResponse(null, { status: 204 });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function serializeMachine(m: Record<string, any>) {
  return {
    id: m.id as string,
    name: m.name as string,
    location: (m.location as string | null) ?? null,
    status: m.status as string,
    streamUrl: m.stream_url as string,
    controllerUrl: (m.controller_url as string | null) ?? null,
    mqttTopic: (m.mqtt_topic as string | null) ?? null,
    creditsPerPlay: m.credits_per_play as number,
    prizeStockCount: m.prize_stock_count as number,
    prizeStockThreshold: m.prize_stock_threshold as number,
    lastHeartbeatAt: (m.last_heartbeat_at as string | null) ?? null,
    createdAt: m.created_at as string,
  };
}
