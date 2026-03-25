/**
 * GET /api/users/me/referral
 *
 * Returns the authenticated user's referral code, share URL, and stats.
 * Creates the code on first call (idempotent via get_or_create_referral_code()).
 *
 * Response:
 *   {
 *     code: string          — 8-char uppercase code
 *     shareUrl: string      — full URL e.g. https://example.com/refer?ref=ABCD1234
 *     pending: number       — signups not yet converted (no first paid session)
 *     converted: number     — signups who completed a paid session
 *     creditsEarned: number — total credits earned from referrals
 *   }
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

  // Get or create the referral code
  const { data: codeData, error: codeError } = await supabase.rpc(
    'get_or_create_referral_code',
    { p_user_id: auth.userId },
  );

  if (codeError || !codeData) {
    console.error('[users/me/referral] code_error:', codeError?.message);
    return NextResponse.json({ error: 'Failed to get referral code.' }, { status: 500 });
  }

  const code = codeData as string;

  // Fetch referral stats for this user
  const { data: stats, error: statsError } = await supabase
    .from('referrals')
    .select('converted_at, reward_issued_at')
    .eq('referrer_id', auth.userId);

  if (statsError) {
    console.error('[users/me/referral] stats_error:', statsError.message);
    return NextResponse.json({ error: 'Failed to fetch referral stats.' }, { status: 500 });
  }

  const rows = stats ?? [];
  const pending = rows.filter((r) => !r.converted_at).length;
  const converted = rows.filter((r) => !!r.converted_at).length;
  const creditsEarned = rows.filter((r) => !!r.reward_issued_at).length * 3;

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? req.nextUrl.origin;
  const shareUrl = `${baseUrl}/refer?ref=${code}`;

  return NextResponse.json({ code, shareUrl, pending, converted, creditsEarned });
}
