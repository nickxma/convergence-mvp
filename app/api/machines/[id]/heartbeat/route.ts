/**
 * POST /api/machines/:id/heartbeat
 *
 * Hardware check-in. The machine controller calls this periodically (every
 * ~15–30 s) to signal that it is alive. Updates last_heartbeat_at and sets
 * status to 'online' (unless the machine is in 'maintenance').
 *
 * Auth: X-Machine-Secret header must match CLAW_MACHINE_SECRET env var.
 *
 * Body (optional):
 *   prizeStockCount  number  — current prize stock level (machine-reported)
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

  // Optionally parse stock count from body
  let reportedStock: number | null = null;
  try {
    const body = await req.json().catch(() => ({}));
    if (typeof body.prizeStockCount === 'number' && body.prizeStockCount >= 0) {
      reportedStock = body.prizeStockCount;
    }
  } catch {
    // body is optional; ignore parse errors
  }

  // Load machine to get current status and threshold
  const { data: machine } = await supabase
    .from('claw_machines')
    .select('id, status, prize_stock_count, prize_stock_threshold')
    .eq('id', machineId)
    .single();

  if (!machine) {
    return errorResponse(404, 'NOT_FOUND', 'Machine not found.');
  }

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
