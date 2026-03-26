/**
 * POST /api/admin/machines   — register a new claw machine
 * GET  /api/admin/machines   — list all machines (all statuses)
 *
 * Auth: Bearer ADMIN_WALLET
 *
 * POST body (all required except optional fields):
 *   name            string   — display name
 *   location        string?  — physical location label
 *   streamUrl       string   — HLS .m3u8 camera URL
 *   controllerUrl   string?  — WebSocket/HTTP claw controller URL
 *   mqttTopic       string?  — MQTT topic for this machine
 *   creditsPerPlay  number?  — credits consumed per play (default 10)
 *   prizeStockCount number?  — initial prize stock (default 0)
 *   prizeStockThreshold number? — alert threshold (default 5)
 *   status          'online'|'offline'|'maintenance'?  (default 'offline')
 *
 * GET response: { machines: Machine[], lowStockAlerts: string[], healthSummary: Record<string, HealthSummary> }
 *
 * Staleness: on GET, stale machines (heartbeat > 90 s old) are marked
 * offline before results are returned.
 */

import { NextRequest, NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/admin-auth';
import { supabase } from '@/lib/supabase';

function errorResponse(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

const VALID_STATUSES = new Set(['online', 'offline', 'maintenance']);

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!isAdminRequest(req)) {
    return errorResponse(403, 'FORBIDDEN', 'Admin access required.');
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return errorResponse(400, 'BAD_REQUEST', 'Invalid JSON body.');
  }

  const name = body.name as string | undefined;
  const streamUrl = body.streamUrl as string | undefined;
  if (!name?.trim()) {
    return errorResponse(400, 'BAD_REQUEST', 'name is required.');
  }
  if (!streamUrl?.trim()) {
    return errorResponse(400, 'BAD_REQUEST', 'streamUrl is required.');
  }

  const status = (body.status as string | undefined) ?? 'offline';
  if (!VALID_STATUSES.has(status)) {
    return errorResponse(400, 'BAD_REQUEST', 'status must be online | offline | maintenance.');
  }

  const { data: machine, error: insertErr } = await supabase
    .from('claw_machines')
    .insert({
      name: name.trim(),
      location: (body.location as string | undefined)?.trim() ?? null,
      stream_url: streamUrl.trim(),
      controller_url: (body.controllerUrl as string | undefined)?.trim() ?? null,
      mqtt_topic: (body.mqttTopic as string | undefined)?.trim() ?? null,
      credits_per_play:
        typeof body.creditsPerPlay === 'number' && body.creditsPerPlay > 0
          ? body.creditsPerPlay
          : 10,
      prize_stock_count:
        typeof body.prizeStockCount === 'number' && body.prizeStockCount >= 0
          ? body.prizeStockCount
          : 0,
      prize_stock_threshold:
        typeof body.prizeStockThreshold === 'number' && body.prizeStockThreshold >= 0
          ? body.prizeStockThreshold
          : 5,
      status,
    })
    .select()
    .single();

  if (insertErr || !machine) {
    console.error('[admin/machines] insert_error:', insertErr?.message);
    return errorResponse(500, 'DB_ERROR', 'Failed to create machine.');
  }

  return NextResponse.json({ machine: serializeMachine(machine) }, { status: 201 });
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!isAdminRequest(req)) {
    return errorResponse(403, 'FORBIDDEN', 'Admin access required.');
  }

  // Mark stale machines offline before returning
  await supabase.rpc('mark_stale_machines_offline');

  const { data: machines, error } = await supabase
    .from('claw_machines')
    .select('*')
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[admin/machines] list_error:', error.message);
    return errorResponse(500, 'DB_ERROR', 'Failed to fetch machines.');
  }

  const result = (machines ?? []).map(serializeMachine);

  // Low stock alert flag
  const lowStock = result.filter(
    (m) => m.prizeStockCount <= m.prizeStockThreshold,
  );

  // Fetch latest health reading for every machine in one shot
  const machineIds = result.map((m) => m.id);
  let healthSummary: Record<string, { motorTemp: number | null; clawStrength: number | null; prizeDetectorStatus: string | null; streamStatus: string | null; recordedAt: string } | null> = {};

  if (machineIds.length > 0) {
    const { data: healthRows } = await supabase
      .from('machine_health')
      .select('machine_id, motor_temp, claw_strength, prize_detector_status, stream_status, recorded_at')
      .in('machine_id', machineIds)
      .order('machine_id')
      .order('recorded_at', { ascending: false });

    // Keep only the latest row per machine
    for (const row of healthRows ?? []) {
      const mid = row.machine_id as string;
      if (!healthSummary[mid]) {
        healthSummary[mid] = {
          motorTemp: row.motor_temp as number | null,
          clawStrength: row.claw_strength as number | null,
          prizeDetectorStatus: row.prize_detector_status as string | null,
          streamStatus: row.stream_status as string | null,
          recordedAt: row.recorded_at as string,
        };
      }
    }
  }

  return NextResponse.json({ machines: result, lowStockAlerts: lowStock.map((m) => m.id), healthSummary });
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
