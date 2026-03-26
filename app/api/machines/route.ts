/**
 * GET /api/machines
 *
 * Public endpoint — returns only machines with status 'online'.
 * Stale machines (last_heartbeat_at older than 60 s) are automatically
 * marked offline before the query runs.
 *
 * Response: { machines: PublicMachine[] }
 *
 * PublicMachine fields: id, name, location, streamUrl, creditsPerPlay,
 *   prizeStockCount, busy, queueDepth
 * (sensitive admin fields like mqttTopic, controllerUrl are omitted)
 */

import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function GET(): Promise<NextResponse> {
  // Expire stale machines before returning live data
  await supabase.rpc('mark_stale_machines_offline');

  const { data: machines, error } = await supabase
    .from('claw_machines')
    .select('id, name, location, stream_url, credits_per_play, prize_stock_count')
    .eq('status', 'online')
    .order('name', { ascending: true });

  if (error) {
    console.error('[machines] list_error:', error.message);
    return NextResponse.json(
      { error: { code: 'DB_ERROR', message: 'Failed to fetch machines.' } },
      { status: 500 },
    );
  }

  const machineList = machines ?? [];
  if (machineList.length === 0) {
    return NextResponse.json({ machines: [] });
  }

  const machineIds = machineList.map((m: Record<string, unknown>) => m.id as string);
  const now = new Date().toISOString();

  // Fetch active sessions and queue depths in parallel
  const [activeSessions, queueCounts] = await Promise.all([
    supabase
      .from('claw_sessions')
      .select('machine_id')
      .in('machine_id', machineIds)
      .eq('status', 'active')
      .gt('expires_at', now),
    supabase
      .from('machine_queues')
      .select('machine_id')
      .in('machine_id', machineIds)
      .eq('status', 'waiting'),
  ]);

  // Build lookup sets
  const busyMachineIds = new Set(
    (activeSessions.data ?? []).map((s: Record<string, unknown>) => s.machine_id as string),
  );
  const queueDepthMap = new Map<string, number>();
  for (const row of queueCounts.data ?? []) {
    const mid = (row as Record<string, unknown>).machine_id as string;
    queueDepthMap.set(mid, (queueDepthMap.get(mid) ?? 0) + 1);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = machineList.map((m: Record<string, any>) => ({
    id: m.id as string,
    name: m.name as string,
    location: (m.location as string | null) ?? null,
    streamUrl: m.stream_url as string,
    creditsPerPlay: m.credits_per_play as number,
    prizeStockCount: m.prize_stock_count as number,
    busy: busyMachineIds.has(m.id as string),
    queueDepth: queueDepthMap.get(m.id as string) ?? 0,
  }));

  return NextResponse.json({ machines: result });
}
