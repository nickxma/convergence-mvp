/**
 * GET /api/sessions/:id/notes  — fetch the authenticated user's notes for a session
 * PUT /api/sessions/:id/notes  — save (upsert) the user's notes for a session
 *
 * Session notes are a Pro feature. Free-tier users receive 402 upgrade_required.
 *
 * The :id parameter is a composite session identifier (e.g. "the-honest-meditator-3"),
 * matching the format used by shared/session-notes.js.
 *
 * Required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyRequest } from '@/lib/privy-auth';
import { requiresPro } from '@/lib/subscription';
import { supabase } from '@/lib/supabase';

const SESSION_ID_RE = /^[\w-]{1,120}$/;
const MAX_CONTENT_LENGTH = 5000;

function errorResponse(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await verifyRequest(req);
  if (!auth) return errorResponse(401, 'UNAUTHORIZED', 'Authentication required.');

  const gate = await requiresPro('session_notes', auth.userId);
  if (!gate.allowed) return gate.response;

  const { id } = await params;
  if (!id || !SESSION_ID_RE.test(id)) {
    return errorResponse(400, 'BAD_REQUEST', 'Invalid session id.');
  }

  const { data, error } = await supabase
    .from('session_notes')
    .select('content, updated_at')
    .eq('user_id', auth.userId)
    .eq('session_id', id)
    .single();

  if (error && error.code !== 'PGRST116') {
    console.error('[session-notes GET] db error:', error.message);
    return errorResponse(500, 'DB_ERROR', 'Failed to fetch notes.');
  }

  return NextResponse.json({
    sessionId: id,
    content: (data?.content as string) ?? '',
    updatedAt: (data?.updated_at as string) ?? null,
  });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await verifyRequest(req);
  if (!auth) return errorResponse(401, 'UNAUTHORIZED', 'Authentication required.');

  const gate = await requiresPro('session_notes', auth.userId);
  if (!gate.allowed) return gate.response;

  const { id } = await params;
  if (!id || !SESSION_ID_RE.test(id)) {
    return errorResponse(400, 'BAD_REQUEST', 'Invalid session id.');
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return errorResponse(400, 'INVALID_JSON', 'Request body must be valid JSON.');
  }

  const content = typeof body.content === 'string' ? body.content : '';
  if (content.length > MAX_CONTENT_LENGTH) {
    return errorResponse(400, 'CONTENT_TOO_LONG', `Notes must be ≤ ${MAX_CONTENT_LENGTH} characters.`);
  }

  const { error } = await supabase.from('session_notes').upsert(
    { user_id: auth.userId, session_id: id, content },
    { onConflict: 'user_id,session_id' },
  );

  if (error) {
    console.error('[session-notes PUT] db error:', error.message);
    return errorResponse(500, 'DB_ERROR', 'Failed to save notes.');
  }

  return NextResponse.json({ ok: true });
}
