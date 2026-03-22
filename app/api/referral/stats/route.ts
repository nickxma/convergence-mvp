import { NextRequest, NextResponse } from 'next/server';
import { verifyRequest } from '@/lib/privy-auth';
import { supabase } from '@/lib/supabase';

function errorResponse(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

/** GET /api/referral/stats — returns the authenticated user's referral stats. */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await verifyRequest(req);
  if (!auth) return errorResponse(401, 'UNAUTHORIZED', 'Authentication required.');

  const { userId } = auth;

  const { data, error } = await supabase
    .from('user_referrals')
    .select('code, invite_count')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    console.error('[/api/referral/stats] db error:', error.message);
    return errorResponse(500, 'INTERNAL_ERROR', 'Failed to fetch referral stats.');
  }

  if (!data) {
    // User has no referral code yet — return zeroed stats
    return NextResponse.json({ code: null, inviteCount: 0, joinedCount: 0 });
  }

  // joinedCount = rows in referral_conversions for this referrer
  const { count: joinedCount, error: convErr } = await supabase
    .from('referral_conversions')
    .select('id', { count: 'exact', head: true })
    .eq('referrer_user_id', userId);

  if (convErr) {
    console.error('[/api/referral/stats] conversion count error:', convErr.message);
  }

  return NextResponse.json({
    code: data.code,
    inviteCount: data.invite_count,
    joinedCount: joinedCount ?? data.invite_count,
  });
}
