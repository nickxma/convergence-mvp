/**
 * GET /api/sessions/notes
 *
 * Returns the list of session IDs for which the authenticated user has saved notes.
 * Used by the course landing page to show pencil icons next to sessions that have notes.
 *
 * Session notes are a Pro feature. Free-tier users receive 402 upgrade_required.
 *
 * Response: { sessions: string[] }  — array of session IDs with non-empty notes
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyRequest } from '@/lib/privy-auth';
import { requiresPro } from '@/lib/subscription';
import { supabase } from '@/lib/supabase';

function errorResponse(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await verifyRequest(req);
  if (!auth) return errorResponse(401, 'UNAUTHORIZED', 'Authentication required.');

  const gate = await requiresPro('session_notes', auth.userId);
  if (!gate.allowed) return gate.response;

  const { data, error } = await supabase
    .from('session_notes')
    .select('session_id')
    .eq('user_id', auth.userId)
    .neq('content', '');

  if (error) {
    console.error('[session-notes list GET] db error:', error.message);
    return errorResponse(500, 'DB_ERROR', 'Failed to fetch session list.');
  }

  const sessions = (data ?? []).map((row) => row.session_id as string);
  return NextResponse.json({ sessions });
}
