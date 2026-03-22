/**
 * GET /api/admin/costs?period=7d — OpenAI cost breakdown by model and day
 *
 * Auth: Authorization: Bearer <ADMIN_WALLET>
 *
 * Query params:
 *   period  — '7d' | '30d' | '1d' (default: '7d')
 *
 * Response:
 *   period        — requested period string
 *   totalUsd      — total cost across the period
 *   byModel       — cost grouped by model { model, totalUsd, promptTokens, completionTokens }[]
 *   byDay         — daily cost breakdown [{ date: 'YYYY-MM-DD', totalUsd }]
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { isAdminRequest } from '@/lib/admin-auth';

function errorResponse(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

function parsePeriodDays(period: string | null): number {
  if (period === '1d') return 1;
  if (period === '30d') return 30;
  return 7; // default: 7d
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!isAdminRequest(req)) {
    return errorResponse(401, 'UNAUTHORIZED', 'Admin access required.');
  }

  const period = req.nextUrl.searchParams.get('period');
  const days = parsePeriodDays(period);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const { data, error } = await supabase
    .from('openai_usage')
    .select('model, endpoint, prompt_tokens, completion_tokens, estimated_cost_usd, created_at')
    .gte('created_at', since.toISOString())
    .order('created_at', { ascending: true });

  if (error) {
    console.error(`[/api/admin/costs] db_error: ${error.message}`);
    return errorResponse(502, 'DB_ERROR', 'Failed to query cost data.');
  }

  const rows = data ?? [];

  // Total
  const totalUsd = rows.reduce((sum, r) => sum + Number(r.estimated_cost_usd ?? 0), 0);

  // Group by model
  const modelMap = new Map<string, { totalUsd: number; promptTokens: number; completionTokens: number }>();
  for (const r of rows) {
    const entry = modelMap.get(r.model) ?? { totalUsd: 0, promptTokens: 0, completionTokens: 0 };
    entry.totalUsd += Number(r.estimated_cost_usd ?? 0);
    entry.promptTokens += r.prompt_tokens ?? 0;
    entry.completionTokens += r.completion_tokens ?? 0;
    modelMap.set(r.model, entry);
  }
  const byModel = Array.from(modelMap.entries()).map(([model, v]) => ({ model, ...v }));

  // Group by day (UTC date string)
  const dayMap = new Map<string, number>();
  for (const r of rows) {
    const day = r.created_at.slice(0, 10); // 'YYYY-MM-DD'
    dayMap.set(day, (dayMap.get(day) ?? 0) + Number(r.estimated_cost_usd ?? 0));
  }
  const byDay = Array.from(dayMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, totalUsd]) => ({ date, totalUsd }));

  return NextResponse.json({ period: `${days}d`, totalUsd, byModel, byDay });
}
