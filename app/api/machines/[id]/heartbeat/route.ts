/**
 * POST /api/machines/:id/heartbeat
 *
 * Hardware check-in. The machine controller calls this periodically (every
 * ~30 s) to signal that it is alive and report sensor readings.
 *
 * Auth: X-Machine-Secret header must match CLAW_MACHINE_SECRET env var.
 *
 * Body (all optional):
 *   prizeStockCount      number  — current prize stock level
 *   motorTemp            number  — motor temperature in °C
 *   clawStrength         number  — claw grip strength (machine units)
 *   prizeDetectorStatus  string  — 'ok' | 'fault' | 'unknown'
 *   streamStatus         string  — 'ok' | 'fault' | 'unknown'
 *
 * Behaviour:
 *   - Updates last_heartbeat_at and sets status to 'online' (unless maintenance).
 *   - Inserts a machine_health row with the sensor readings.
 *   - Clears offline_alert_sent_at on recovery so the watchdog can re-alert
 *     on the next outage.
 *
 * Response: { ok: true, machineId, status, prizeStockCount, lowStock: bool }
 *
 * Error codes:
 *   UNAUTHORIZED   — missing or wrong X-Machine-Secret
 *   NOT_FOUND      — machine id not found
 *   MAINTENANCE    — machine is in maintenance; heartbeat recorded but status not changed
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_SENSOR_STATUS = new Set(['ok', 'fault', 'unknown']);

function errorResponse(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const machineSecret = process.env.CLAW_MACHINE_SECRET;
  if (!machineSecret) {
    console.error('[machines/heartbeat] CLAW_MACHINE_SECRET not configured');
    return errorResponse(500, 'CONFIG_ERROR', 'Machine secret not configured.');
  }

  const providedSecret = req.headers.get('x-machine-secret') ?? '';
  if (providedSecret !== machineSecret) {
    return errorResponse(401, 'UNAUTHORIZED', 'Invalid machine secret.');
  }

  const { id: machineId } = await params;
  if (!UUID_RE.test(machineId)) {
    return errorResponse(400, 'BAD_REQUEST', 'Invalid machine id.');
  }

  // Parse optional body
  let reportedStock: number | null = null;
  let motorTemp: number | null = null;
  let clawStrength: number | null = null;
  let prizeDetectorStatus: string | null = null;
  let streamStatus: string | null = null;

  try {
    const body = await req.json().catch(() => ({}));
    if (typeof body.prizeStockCount === 'number' && body.prizeStockCount >= 0) {
      reportedStock = body.prizeStockCount;
    }
    if (typeof body.motorTemp === 'number' && isFinite(body.motorTemp)) {
      motorTemp = body.motorTemp;
    }
    if (typeof body.clawStrength === 'number' && isFinite(body.clawStrength)) {
      clawStrength = body.clawStrength;
    }
    if (typeof body.prizeDetectorStatus === 'string' && VALID_SENSOR_STATUS.has(body.prizeDetectorStatus)) {
      prizeDetectorStatus = body.prizeDetectorStatus;
    }
    if (typeof body.streamStatus === 'string' && VALID_SENSOR_STATUS.has(body.streamStatus)) {
      streamStatus = body.streamStatus;
    }
  } catch {
    // body is optional; ignore parse errors
  }

  // Load machine to get current status, threshold, and alert state
  const { data: machine } = await supabase
    .from('claw_machines')
    .select('id, status, prize_stock_count, prize_stock_threshold, offline_alert_sent_at')
    .eq('id', machineId)
    .single();

  if (!machine) {
    return errorResponse(404, 'NOT_FOUND', 'Machine not found.');
  }

  const wasOffline = machine.status === 'offline';

  const updates: Record<string, unknown> = {
    last_heartbeat_at: new Date().toISOString(),
  };

  // Bring online unless in maintenance
  if (machine.status !== 'maintenance') {
    updates.status = 'online';
  }

  // Update stock if hardware reported it
  if (reportedStock !== null) {
    updates.prize_stock_count = reportedStock;
  }

  // Clear offline alert on reconnect so watchdog can re-alert on next outage
  if (wasOffline && machine.offline_alert_sent_at !== null) {
    updates.offline_alert_sent_at = null;
  }

  const { data: updated, error: updateErr } = await supabase
    .from('claw_machines')
    .update(updates)
    .eq('id', machineId)
    .select('status, prize_stock_count, prize_stock_threshold')
    .single();

  if (updateErr || !updated) {
    console.error('[machines/heartbeat] db_error:', updateErr?.message);
    return errorResponse(500, 'DB_ERROR', 'Failed to update heartbeat.');
  }

  // Write sensor reading (fire-and-forget — don't block the heartbeat response)
  supabase
    .from('machine_health')
    .insert({
      machine_id:            machineId,
      motor_temp:            motorTemp,
      claw_strength:         clawStrength,
      prize_detector_status: prizeDetectorStatus,
      stream_status:         streamStatus,
    })
    .then(({ error: healthErr }) => {
      if (healthErr) {
        console.error('[machines/heartbeat] health_insert_error:', healthErr.message);
      }
    });

  if (wasOffline && machine.status !== 'maintenance') {
    console.log(`[machines/heartbeat] RECOVERED machine=${machineId}`);
  }

  const lowStock = updated.prize_stock_count <= updated.prize_stock_threshold;

  if (lowStock) {
    console.warn(
      `[machines/heartbeat] LOW_STOCK machine=${machineId} ` +
        `stock=${updated.prize_stock_count} threshold=${updated.prize_stock_threshold}`,
    );
  }

  return NextResponse.json({
    ok: true,
    machineId,
    status: updated.status,
    prizeStockCount: updated.prize_stock_count,
    lowStock,
    maintenance: machine.status === 'maintenance',
  });
}
