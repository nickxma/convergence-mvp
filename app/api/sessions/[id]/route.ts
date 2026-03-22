/**
 * GET /api/sessions/:id
 *
 * Returns a course session by ID (public — no auth required).
 *
 * Response fields:
 *   id          — UUID
 *   courseId    — parent course UUID
 *   slug        — URL-friendly identifier within the course
 *   title       — display title
 *   body        — text content (markdown)
 *   audioUrl    — Supabase Storage or CDN URL, null if not set
 *   sortOrder   — position within course
 *   createdAt
 *   updatedAt
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function errorResponse(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;

  if (!id || !UUID_RE.test(id)) {
    return errorResponse(400, 'BAD_REQUEST', 'Invalid session id.');
  }

  const { data, error } = await supabase
    .from('course_sessions')
    .select('id, course_id, slug, title, body, audio_url, sort_order, created_at, updated_at')
    .eq('id', id)
    .single();

  if (error || !data) {
    return errorResponse(404, 'NOT_FOUND', 'Session not found.');
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
