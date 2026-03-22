import { NextRequest, NextResponse } from 'next/server';
import { verifyRequest } from '@/lib/privy-auth';
import { supabase } from '@/lib/supabase';

const VALID_STYLES = ['brief', 'detailed', 'citations_first'] as const;
type AnswerStyle = (typeof VALID_STYLES)[number];

function errorResponse(status: number, message: string): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

/** GET /api/user/preferences — returns the authenticated user's preferences. */
export async function GET(req: NextRequest) {
  const auth = await verifyRequest(req);
  if (!auth?.userId) return errorResponse(401, 'Unauthorized');

  const { data, error } = await supabase
    .from('user_preferences')
    .select('answer_style')
    .eq('user_id', auth.userId)
    .single();

  if (error && error.code !== 'PGRST116') {
    console.error('[/api/user/preferences] fetch error', error.message);
    return errorResponse(500, 'Internal server error');
  }

  return NextResponse.json({ answer_style: data?.answer_style ?? 'detailed' });
}

/** PATCH /api/user/preferences — upserts one or more preference fields. */
export async function PATCH(req: NextRequest) {
  const auth = await verifyRequest(req);
  if (!auth?.userId) return errorResponse(401, 'Unauthorized');

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return errorResponse(400, 'Invalid JSON');
  }

  const updates: { answer_style?: AnswerStyle } = {};

  if ('answer_style' in body) {
    if (!VALID_STYLES.includes(body.answer_style as AnswerStyle)) {
      return errorResponse(400, `answer_style must be one of: ${VALID_STYLES.join(', ')}`);
    }
    updates.answer_style = body.answer_style as AnswerStyle;
  }

  if (Object.keys(updates).length === 0) {
    return errorResponse(400, 'No valid fields to update');
  }

  const { error } = await supabase
    .from('user_preferences')
    .upsert({ user_id: auth.userId, ...updates, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });

  if (error) {
    console.error('[/api/user/preferences] upsert error', error.message);
    return errorResponse(500, 'Internal server error');
  }

  return NextResponse.json({ ok: true, ...updates });
}
