/**
 * PATCH /api/admin/experiments/variants/:id
 *
 * General update + special actions:
 *   action: "promote"  — set this variant to 100% traffic, deactivate all others
 *   action: "retire"   — set is_active=false, traffic_pct=0
 *   (no action)        — partial update: name, systemPrompt, trafficPct, isActive
 *
 * Auth: Bearer ADMIN_WALLET
 */

import { NextRequest, NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/admin-auth';
import { supabase } from '@/lib/supabase';

function errorResponse(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

function isValidUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!isAdminRequest(req)) {
    return errorResponse(403, 'FORBIDDEN', 'Admin access required.');
  }

  const { id } = await params;
  if (!isValidUuid(id)) {
    return errorResponse(400, 'INVALID_ID', 'Variant id must be a valid UUID.');
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return errorResponse(400, 'INVALID_JSON', 'Request body must be valid JSON.');
  }

  const action = typeof body.action === 'string' ? body.action : null;

  // ── Promote: winner takes 100% traffic, others go to 0 and inactive ──
  if (action === 'promote') {
    // Set all others inactive/0 first
    const { error: resetErr } = await supabase
      .from('prompt_variants')
      .update({ is_active: false, traffic_pct: 0, updated_at: new Date().toISOString() })
      .neq('id', id);

    if (resetErr) {
      console.error('[experiments/variants/:id] promote reset error', resetErr);
      return errorResponse(500, 'DB_ERROR', 'Failed to reset other variants.');
    }

    // Promote this one
    const { data, error } = await supabase
      .from('prompt_variants')
      .update({ is_active: true, traffic_pct: 100, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('id, name, system_prompt, is_active, traffic_pct, updated_at')
      .single();

    if (error) {
      if (error.code === 'PGRST116') return errorResponse(404, 'NOT_FOUND', 'Variant not found.');
      console.error('[experiments/variants/:id] promote error', error);
      return errorResponse(500, 'DB_ERROR', 'Failed to promote variant.');
    }

    return NextResponse.json({ variant: toResponse(data), action: 'promoted' });
  }

  // ── Retire: deactivate + zero traffic ──
  if (action === 'retire') {
    const { data, error } = await supabase
      .from('prompt_variants')
      .update({ is_active: false, traffic_pct: 0, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('id, name, system_prompt, is_active, traffic_pct, updated_at')
      .single();

    if (error) {
      if (error.code === 'PGRST116') return errorResponse(404, 'NOT_FOUND', 'Variant not found.');
      console.error('[experiments/variants/:id] retire error', error);
      return errorResponse(500, 'DB_ERROR', 'Failed to retire variant.');
    }

    return NextResponse.json({ variant: toResponse(data), action: 'retired' });
  }

  // ── Partial update ──
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (typeof body.name === 'string') updates.name = body.name.trim();
  if (typeof body.systemPrompt === 'string') updates.system_prompt = body.systemPrompt.trim();
  if (typeof body.isActive === 'boolean') updates.is_active = body.isActive;
  if (typeof body.trafficPct === 'number') {
    if (body.trafficPct < 0 || body.trafficPct > 100) {
      return errorResponse(400, 'INVALID_FIELD', 'trafficPct must be between 0 and 100.');
    }
    updates.traffic_pct = body.trafficPct;
  }

  if (Object.keys(updates).length === 1) {
    return errorResponse(400, 'NO_CHANGES', 'No updatable fields provided.');
  }

  const { data, error } = await supabase
    .from('prompt_variants')
    .update(updates)
    .eq('id', id)
    .select('id, name, system_prompt, is_active, traffic_pct, updated_at')
    .single();

  if (error) {
    if (error.code === 'PGRST116') return errorResponse(404, 'NOT_FOUND', 'Variant not found.');
    if (error.code === '23505') return errorResponse(409, 'DUPLICATE_NAME', 'Variant name already in use.');
    console.error('[experiments/variants/:id] update error', error);
    return errorResponse(500, 'DB_ERROR', 'Failed to update variant.');
  }

  return NextResponse.json({ variant: toResponse(data) });
}

function toResponse(v: {
  id: string;
  name: string;
  system_prompt: string;
  is_active: boolean;
  traffic_pct: number;
  updated_at: string;
}) {
  return {
    id: v.id,
    name: v.name,
    systemPrompt: v.system_prompt,
    isActive: v.is_active,
    trafficPct: v.traffic_pct,
    updatedAt: v.updated_at,
  };
}
