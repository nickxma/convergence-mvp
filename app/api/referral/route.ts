import { randomBytes } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { verifyRequest } from '@/lib/privy-auth';
import { supabase } from '@/lib/supabase';

function errorResponse(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

function buildReferralUrl(req: NextRequest, code: string): string {
  const host = req.headers.get('host') ?? '';
  const proto = host.startsWith('localhost') ? 'http' : 'https';
  return `${proto}://${host}/?ref=${code}`;
}

/** GET /api/referral — returns (or creates) the authenticated user's referral code. */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await verifyRequest(req);
  if (!auth) return errorResponse(401, 'UNAUTHORIZED', 'Authentication required.');

  const { userId } = auth;

  // Try to fetch existing code first
  const { data: existing } = await supabase
    .from('user_referrals')
    .select('code')
    .eq('user_id', userId)
    .maybeSingle();

  if (existing?.code) {
    return NextResponse.json({
      code: existing.code,
      referralUrl: buildReferralUrl(req, existing.code),
    });
  }

  // Generate a new URL-safe code (8 chars)
  const code = randomBytes(6).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '').slice(0, 8);

  // Insert; if another request raced us, the unique constraint fires — re-select
  await supabase
    .from('user_referrals')
    .insert({ user_id: userId, code })
    .select('code')
    .maybeSingle();

  const { data: final, error } = await supabase
    .from('user_referrals')
    .select('code')
    .eq('user_id', userId)
    .single();

  if (error || !final?.code) {
    console.error('[/api/referral] failed to create referral code:', error?.message);
    return errorResponse(500, 'INTERNAL_ERROR', 'Failed to create referral code.');
  }

  return NextResponse.json({
    code: final.code,
    referralUrl: buildReferralUrl(req, final.code),
  });
}
