/**
 * POST /api/referrals/register
 *
 * Called client-side when an authenticated user has a referral code cookie/param.
 * Idempotent — safe to call multiple times; no-ops if the user is already referred.
 *
 * Body: { code: string }
 *
 * Response:
 *   200 { registered: true }  — referral recorded (or already existed)
 *   200 { registered: false } — code invalid or self-referral
 */
import { NextResponse } from 'next/server';
import { verifyRequest } from '@/lib/privy-auth';
import { supabase } from '@/lib/supabase';
import type { NextRequest } from 'next/server';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await verifyRequest(req);
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({})) as { code?: string };
  const code = typeof body.code === 'string' ? body.code.trim().toUpperCase() : '';

  if (!code || code.length < 4) {
    return NextResponse.json({ registered: false });
  }

  const { data, error } = await supabase.rpc('register_referral', {
    p_referee_id: auth.userId,
    p_ref_code: code,
  });

  if (error) {
    console.error('[referrals/register] db_error:', error.message);
    return NextResponse.json({ error: 'Failed to register referral.' }, { status: 500 });
  }

  return NextResponse.json({ registered: !!data });
}
