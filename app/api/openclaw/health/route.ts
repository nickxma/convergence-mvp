/**
 * GET /api/openclaw/health — OpenClaw agent health status
 *
 * Returns current health status for all registered agents plus a 7-day
 * daily uptime sparkline derived from agent_health_events.
 *
 * Uptime % per day = checks where status='healthy' / total checks that day.
 *
 * Protected by ADMIN_WALLET bearer token (same as other admin endpoints).
 */
import { NextRequest, NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/admin-auth';
import { supabase } from '@/lib/supabase';

interface PaperclipAgent {
  id: string;
  name: string;
  role: string;
  urlKey: string;
  lastHeartbeatAt: string | null;
  status: string;
}

interface DailyUptime {
  date: string; // YYYY-MM-DD
  uptimePct: number; // 0–100
  totalChecks: number;
}

interface AgentHealth {
  agentId: string;
  name: string;
  role: string;
  urlKey: string;
  currentStatus: 'healthy' | 'degraded' | 'red' | 'unknown';
  lastHeartbeatAt: string | null;
  minutesSinceHeartbeat: number | null;
  uptimePct7d: number | null;
  sparkline: DailyUptime[];
}

function classifyStatus(lastHeartbeatAt: string | null): {
  status: 'healthy' | 'degraded' | 'red';
  minutesSince: number | null;
} {
  if (!lastHeartbeatAt) return { status: 'red', minutesSince: null };
  const minutesSince = (Date.now() - new Date(lastHeartbeatAt).getTime()) / 60_000;
  if (minutesSince < 30) return { status: 'healthy', minutesSince: Math.floor(minutesSince) };
  if (minutesSince < 60) return { status: 'degraded', minutesSince: Math.floor(minutesSince) };
  return { status: 'red', minutesSince: Math.floor(minutesSince) };
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!isAdminRequest(req)) {
    return NextResponse.json({ error: { code: 'FORBIDDEN', message: 'Admin access required.' } }, { status: 403 });
  }

  const apiUrl = process.env.PAPERCLIP_API_URL;
  const apiKey = process.env.PAPERCLIP_API_KEY;
  const companyId = process.env.PAPERCLIP_COMPANY_ID;

  if (!apiUrl || !apiKey || !companyId) {
    return NextResponse.json(
      { error: { code: 'CONFIG_ERROR', message: 'Paperclip env vars not configured.' } },
      { status: 500 },
    );
  }

  // Fetch current agent list
  let agents: PaperclipAgent[];
  try {
    const res = await fetch(`${apiUrl}/api/companies/${companyId}/agents`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`agents list returned ${res.status}`);
    agents = await res.json();
  } catch (err) {
    console.error('[openclaw/health] fetch_agents_error:', err);
    return NextResponse.json({ error: { code: 'FETCH_ERROR', message: 'Failed to fetch agents.' } }, { status: 502 });
  }

  // Fetch 7 days of health events for sparkline
  const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: events, error: eventsError } = await supabase
    .from('agent_health_events')
    .select('agent_id, status, checked_at')
    .gte('checked_at', since7d)
    .order('checked_at', { ascending: true });

  if (eventsError) {
    console.error('[openclaw/health] db_error:', eventsError.message);
    return NextResponse.json({ error: { code: 'DB_ERROR', message: 'Failed to load health history.' } }, { status: 502 });
  }

  // Build per-agent sparkline from event history
  type EventRow = { agent_id: string; status: string; checked_at: string };
  const eventsByAgent = new Map<string, EventRow[]>();
  for (const e of events ?? []) {
    const arr = eventsByAgent.get(e.agent_id) ?? [];
    arr.push(e);
    eventsByAgent.set(e.agent_id, arr);
  }

  // Generate ISO date strings for the past 7 days (UTC)
  const past7Days: string[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
    past7Days.push(d.toISOString().slice(0, 10));
  }

  const result: AgentHealth[] = agents.map((agent) => {
    const { status: currentStatus, minutesSince } = classifyStatus(agent.lastHeartbeatAt);
    const agentEvents = eventsByAgent.get(agent.id) ?? [];

    // Group events by UTC date
    const byDay = new Map<string, { total: number; healthy: number }>();
    for (const e of agentEvents) {
      const day = e.checked_at.slice(0, 10);
      const bucket = byDay.get(day) ?? { total: 0, healthy: 0 };
      bucket.total++;
      if (e.status === 'healthy') bucket.healthy++;
      byDay.set(day, bucket);
    }

    const sparkline: DailyUptime[] = past7Days.map((date) => {
      const bucket = byDay.get(date);
      if (!bucket || bucket.total === 0) return { date, uptimePct: 0, totalChecks: 0 };
      return {
        date,
        uptimePct: Math.round((bucket.healthy / bucket.total) * 100),
        totalChecks: bucket.total,
      };
    });

    const totalChecks7d = sparkline.reduce((s, d) => s + d.totalChecks, 0);
    const healthyChecks7d = sparkline.reduce((s, d) => s + Math.round((d.uptimePct / 100) * d.totalChecks), 0);
    const uptimePct7d = totalChecks7d > 0 ? Math.round((healthyChecks7d / totalChecks7d) * 100) : null;

    return {
      agentId: agent.id,
      name: agent.name,
      role: agent.role,
      urlKey: agent.urlKey,
      currentStatus,
      lastHeartbeatAt: agent.lastHeartbeatAt,
      minutesSinceHeartbeat: minutesSince,
      uptimePct7d,
      sparkline,
    };
  });

  // Sort: red first, then degraded, then healthy; alpha within group
  result.sort((a, b) => {
    const order = { red: 0, degraded: 1, healthy: 2, unknown: 3 };
    const diff = order[a.currentStatus] - order[b.currentStatus];
    return diff !== 0 ? diff : a.name.localeCompare(b.name);
  });

  return NextResponse.json({ agents: result, checkedAt: new Date().toISOString() });
}
