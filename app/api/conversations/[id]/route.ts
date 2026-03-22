import { NextRequest, NextResponse } from 'next/server';
import { verifyRequest } from '@/lib/privy-auth';
import { supabase } from '@/lib/supabase';

/**
 * GET /api/conversations/:id
 *
 * Returns the full turn history for a specific conversation session.
 * The conversation must belong to the authenticated user.
 *
 * Auth: Bearer token (Privy JWT).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authResult = await verifyRequest(req);
  if (!authResult) {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required.' } }, { status: 401 });
  }

  const { userId } = authResult;
  const { id } = await params;

  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: { code: 'BAD_REQUEST', message: 'Invalid conversation id.' } }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('conversation_sessions')
    .select('id, title, history, message_count, created_at, updated_at')
    .eq('id', id)
    .eq('user_id', userId)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Conversation not found.' } }, { status: 404 });
  }

  return NextResponse.json({
    id: data.id as string,
    title: (data.title as string | null) ?? 'Untitled',
    history: (data.history as Array<{ role: string; content: string }>) ?? [],
    turnCount: Math.floor(((data.message_count as number) ?? 0) / 2),
    createdAt: data.created_at as string,
    updatedAt: data.updated_at as string,
  });
}
