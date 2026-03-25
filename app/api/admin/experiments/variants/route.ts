/**
 * GET  /api/admin/experiments/variants  — list all variants
 * POST /api/admin/experiments/variants  — create a variant (max 3 active)
 *
 * Auth: Bearer ADMIN_WALLET
 *
 * POST body:
 *   name         string   — display name (unique)
 *   systemPrompt string   — the system prompt text
 *   trafficPct   number   — traffic percentage 0–100
 *   isActive     boolean? — default true
 */

import { NextRequest, NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/admin-auth';
import { supabase } from '@/lib/supabase';

const MAX_ACTIVE_VARIANTS = 3;

function errorResponse(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!isAdminRequest(req)) {
    return errorResponse(403, 'FORBIDDEN', 'Admin access required.');
  }

  const { data, error } = await supabase
    .from('prompt_variants')
    .select('id, name, system_prompt, is_active, traffic_pct, created_at, updated_at')
    .order('created_at');

  if (error) {
    console.error('[/api/admin/experiments/variants] list error', error);
    return errorResponse(500, 'DB_ERROR', 'Failed to load variants.');
  }

  const variants = (data ?? []).map((v) => ({
    id: v.id,
    name: v.name,
    systemPrompt: v.system_prompt,
    isActive: v.is_active,
    trafficPct: v.traffic_pct,
    createdAt: v.created_at,
    updatedAt: v.updated_at,
  }));

  return NextResponse.json({ variants });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!isAdminRequest(req)) {
    return errorResponse(403, 'FORBIDDEN', 'Admin access required.');
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return errorResponse(400, 'INVALID_JSON', 'Request body must be valid JSON.');
  }

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const systemPrompt = typeof body.systemPrompt === 'string' ? body.systemPrompt.trim() : '';
  const trafficPct = typeof body.trafficPct === 'number' ? body.trafficPct : NaN;
  const isActive = body.isActive !== false; // default true

  if (!name) return errorResponse(400, 'MISSING_FIELD', 'name is required.');
  if (!systemPrompt) return errorResponse(400, 'MISSING_FIELD', 'systemPrompt is required.');
  if (isNaN(trafficPct) || trafficPct < 0 || trafficPct > 100) {
    return errorResponse(400, 'INVALID_FIELD', 'trafficPct must be a number between 0 and 100.');
  }

  // Enforce max 3 concurrent active variants
  if (isActive) {
    const { count, error: countErr } = await supabase
      .from('prompt_variants')
      .select('id', { count: 'exact', head: true })
      .eq('is_active', true);

    if (countErr) {
      console.error('[/api/admin/experiments/variants] count error', countErr);
      return errorResponse(500, 'DB_ERROR', 'Failed to validate variant count.');
    }

    if ((count ?? 0) >= MAX_ACTIVE_VARIANTS) {
      return errorResponse(
        409,
        'MAX_VARIANTS_EXCEEDED',
        `Maximum ${MAX_ACTIVE_VARIANTS} active variants allowed. Retire or deactivate an existing variant first.`,
      );
    }
  }

  const { data, error } = await supabase
    .from('prompt_variants')
    .insert({
      name,
      system_prompt: systemPrompt,
      traffic_pct: trafficPct,
      is_active: isActive,
    })
    .select('id, name, system_prompt, is_active, traffic_pct, created_at, updated_at')
    .single();

  if (error) {
    if (error.code === '23505') {
      return errorResponse(409, 'DUPLICATE_NAME', `A variant named "${name}" already exists.`);
    }
    console.error('[/api/admin/experiments/variants] insert error', error);
    return errorResponse(500, 'DB_ERROR', 'Failed to create variant.');
  }

  return NextResponse.json(
    {
      variant: {
        id: data.id,
        name: data.name,
        systemPrompt: data.system_prompt,
        isActive: data.is_active,
        trafficPct: data.traffic_pct,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
      },
    },
    { status: 201 },
  );
}
