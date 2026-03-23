/**
 * GET /api/cron/agent-health-check — OpenClaw agent uptime monitor
 *
 * Vercel Cron: runs every 5 minutes.
 * Fetches all registered OpenClaw agents, classifies each by heartbeat recency,
 * writes a row to agent_health_events, and fires Sentry alerts for agents that
 * have been red for more than 1 hour.
 *
 * Health thresholds:
 *   healthy  = lastHeartbeatAt < 30 min ago
 *   degraded = lastHeartbeatAt 30–60 min ago
 *   red      = lastHeartbeatAt > 60 min ago (or never)
 *
 * Protected by CRON_SECRET (Vercel Cron sends Authorization: Bearer <CRON_SECRET>).
 */
import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { supabase } from '@/lib/supabase';

const DEGRADED_THRESHOLD_MIN = 30;
const RED_THRESHOLD_MIN = 60;
const ALERT_SUSTAINED_MIN = 60;

interface PaperclipAgent {
  id: string;
  name: string;
  role: string;
  lastHeartbeatAt: string | null;
  status: string;
}

function classifyStatus(lastHeartbeatAt: string | null): {
  status: 'healthy' | 'degraded' | 'red';
  minutesSince: number | null;
} {
  if (!lastHeartbeatAt) return { status: 'red', minutesSince: null };
  const minutesSince = (Date.now() - new Date(lastHeartbeatAt).getTime()) / 60_000;
  if (minutesSince < DEGRADED_THRESHOLD_MIN) return { status: 'healthy', minutesSince: Math.floor(minutesSince) };
  if (minutesSince < RED_THRESHOLD_MIN) return { status: 'degraded', minutesSince: Math.floor(minutesSince) };
  return { status: 'red', minutesSince: Math.floor(minutesSince) };
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get('authorization');
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Invalid cron secret.' } }, { status: 401 });
    }
  }

  const apiUrl = process.env.PAPERCLIP_API_URL;
  const apiKey = process.env.PAPERCLIP_API_KEY;
  const companyId = process.env.PAPERCLIP_COMPANY_ID;

  if (!apiUrl || !apiKey || !companyId) {
    console.error('[agent-health-check] missing Paperclip env vars');
    return NextResponse.json(
      { error: { code: 'CONFIG_ERROR', message: 'Paperclip env vars not configured.' } },
      { status: 500 },
    );
  }

  // Fetch all agents from Paperclip
  let agents: PaperclipAgent[];
  try {
    const res = await fetch(`${apiUrl}/api/companies/${companyId}/agents`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`agents list returned ${res.status}`);
    agents = await res.json();
  } catch (err) {
    console.error('[agent-health-check] fetch_agents_error:', err);
    return NextResponse.json({ error: { code: 'FETCH_ERROR', message: 'Failed to fetch agents.' } }, { status: 502 });
  }

  const checkedAt = new Date().toISOString();
  const rows = agents.map((agent) => {
    const { status, minutesSince } = classifyStatus(agent.lastHeartbeatAt);
    return {
      agent_id: agent.id,
      agent_name: agent.name,
      status,
      checked_at: checkedAt,
      last_heartbeat_at: agent.lastHeartbeatAt ?? null,
      minutes_since_heartbeat: minutesSince,
    };
  });

  // Write health events
  const { error: insertError } = await supabase.from('agent_health_events').insert(rows);
  if (insertError) {
    console.error('[agent-health-check] db_insert_error:', insertError.message);
    return NextResponse.json({ error: { code: 'DB_ERROR', message: 'Failed to write health events.' } }, { status: 502 });
  }

  // Alert for agents that have been red for > ALERT_SUSTAINED_MIN minutes.
  // Detect sustained red: current status is red AND their most recent event
  // before this check was also red more than ALERT_SUSTAINED_MIN ago.
  const redAgentIds = rows.filter((r) => r.status === 'red').map((r) => r.agent_id);
  if (redAgentIds.length > 0) {
    const alertThreshold = new Date(Date.now() - ALERT_SUSTAINED_MIN * 60_000).toISOString();

    // For each red agent, find the earliest consecutive red event in the last
    // ALERT_SUSTAINED_MIN window. If they were already red at the start of that window,
    // it's a sustained outage worth alerting.
    const { data: priorRedEvents } = await supabase
      .from('agent_health_events')
      .select('agent_id, agent_name, status, checked_at')
      .in('agent_id', redAgentIds)
      .lte('checked_at', alertThreshold)
      .order('checked_at', { ascending: false });

    if (priorRedEvents && priorRedEvents.length > 0) {
      const sustainedRedAgents = new Map<string, string>();
      for (const event of priorRedEvents) {
        if (event.status === 'red' && !sustainedRedAgents.has(event.agent_id)) {
          sustainedRedAgents.set(event.agent_id, event.agent_name);
        }
      }
      for (const [, agentName] of sustainedRedAgents) {
        const msg = `OpenClaw agent "${agentName}" has been unreachable for >${ALERT_SUSTAINED_MIN} minutes`;
        Sentry.captureMessage(msg, 'error');
        console.error(`[agent-health-check] sustained_red: ${agentName}`);
      }
    }
  }

  const summary = {
    healthy: rows.filter((r) => r.status === 'healthy').length,
    degraded: rows.filter((r) => r.status === 'degraded').length,
    red: rows.filter((r) => r.status === 'red').length,
    total: rows.length,
  };
  console.log('[agent-health-check]', JSON.stringify(summary));

  return NextResponse.json({ checkedAt, ...summary });
}
