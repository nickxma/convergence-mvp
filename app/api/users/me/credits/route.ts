/**
 * GET /api/users/me/credits
 *
 * Returns the authenticated user's current credit balance.
 *
 * Response:
 *   { balance: number }
 */
import { NextResponse } from 'next/server';
import { verifyRequest } from '@/lib/privy-auth';
import { supabase } from '@/lib/supabase';
import type { NextRequest } from 'next/server';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await verifyRequest(req);
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data, error } = await supabase
    .from('user_credits')
    .select('balance')
    .eq('user_id', auth.userId)
    .single();

  if (error && error.code !== 'PGRST116') {
    // PGRST116 = row not found — just means no credits yet
    console.error('[users/me/credits] db_error:', error.message);
    return NextResponse.json({ error: 'Failed to fetch balance.' }, { status: 500 });
  }

  return NextResponse.json({ balance: (data?.balance as number | undefined) ?? 0 });
}
