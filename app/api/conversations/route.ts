import { NextRequest, NextResponse } from 'next/server';
import { verifyRequest } from '@/lib/privy-auth';
import { supabase } from '@/lib/supabase';
import { monitoredQuery } from '@/lib/db-monitor';

const PAGE_SIZE = 30;

/**
 * GET /api/conversations
 *
 * Returns a paginated list of the authenticated user's conversation sessions,
 * newest first. Includes title (first question) and turn count.
 *
 * Query params:
 *   cursor  — ISO timestamp; return conversations updated before this date (for pagination)
 *
 * Auth: Bearer token (Privy JWT).
 */
export async function GET(req: NextRequest) {
  const authResult = await verifyRequest(req);
  if (!authResult) {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required.' } }, { status: 401 });
  }

  const { userId } = authResult;
  const cursor = req.nextUrl.searchParams.get('cursor');

  let query = supabase
    .from('conversation_sessions')
    .select('id, title, message_count, created_at, updated_at, archived')
    .eq('user_id', userId)
    .not('title', 'is', null)
    .order('updated_at', { ascending: false })
    .limit(PAGE_SIZE);

  if (cursor) {
    query = query.lt('updated_at', cursor);
  }

  const { data, error } = await monitoredQuery('conversation_sessions.list', () => query);
  if (error) {
    console.error('[/api/conversations] supabase_error:', error.message);
    return NextResponse.json({ error: { code: 'DB_ERROR', message: 'Failed to fetch conversations.' } }, { status: 500 });
  }

  const conversations = (data ?? []).map((row) => ({
    id: row.id as string,
    title: (row.title as string | null) ?? 'Untitled',
    turnCount: Math.floor(((row.message_count as number) ?? 0) / 2),
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    archived: row.archived as boolean,
  }));

  const nextCursor =
    conversations.length === PAGE_SIZE
      ? conversations[conversations.length - 1].updatedAt
      : null;

  return NextResponse.json({ conversations, nextCursor });
}
