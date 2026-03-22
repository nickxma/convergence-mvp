/**
 * PATCH /api/admin/sessions/:id
 *
 * Auth: Authorization: Bearer <ADMIN_WALLET>
 *
 * Updates a course session. Currently supports setting audio_url.
 *
 * Request body (all fields optional):
 *   audioUrl  — Supabase Storage signed URL or public CDN URL; pass null to clear
 *
 * Response: updated session object (same shape as GET /api/sessions/:id).
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { isAdminRequest } from '@/lib/admin-auth';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function errorResponse(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

interface PatchBody {
  audioUrl?: string | null;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!isAdminRequest(req)) {
    return errorResponse(401, 'UNAUTHORIZED', 'Admin access required.');
  }

  const { id } = await params;

  if (!id || !UUID_RE.test(id)) {
    return errorResponse(400, 'BAD_REQUEST', 'Invalid session id.');
  }

  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return errorResponse(400, 'BAD_REQUEST', 'Invalid JSON body.');
  }

  // Validate audioUrl if provided
  if (body.audioUrl !== undefined && body.audioUrl !== null) {
    if (typeof body.audioUrl !== 'string' || body.audioUrl.trim() === '') {
      return errorResponse(400, 'BAD_REQUEST', 'audioUrl must be a non-empty string or null.');
    }
    try {
      new URL(body.audioUrl);
    } catch {
      return errorResponse(400, 'BAD_REQUEST', 'audioUrl must be a valid URL.');
    }
  }

  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if ('audioUrl' in body) {
    updates.audio_url = body.audioUrl ?? null;
  }

  const { data, error } = await supabase
    .from('course_sessions')
    .update(updates)
    .eq('id', id)
    .select('id, course_id, slug, title, body, audio_url, sort_order, created_at, updated_at')
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return errorResponse(404, 'NOT_FOUND', 'Session not found.');
    }
    console.error(`[/api/admin/sessions/${id}] db_error: ${error.message}`);
    return errorResponse(502, 'DB_ERROR', 'Failed to update session.');
  }

  return NextResponse.json({
    id: data.id as string,
    courseId: data.course_id as string,
    slug: data.slug as string,
    title: data.title as string,
    body: data.body as string,
    audioUrl: (data.audio_url as string | null) ?? null,
    sortOrder: data.sort_order as number,
    createdAt: data.created_at as string,
    updatedAt: data.updated_at as string,
  });
}
