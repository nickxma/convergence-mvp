import { NextRequest, NextResponse } from 'next/server';
import { verifyRequest } from '@/lib/privy-auth';
import { supabase } from '@/lib/supabase';

function errorResponse(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

/**
 * POST /api/referral/convert
 * Records that the authenticated user was referred by the code in their `ref` cookie.
 * Idempotent — safe to call multiple times; only records the first conversion.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await verifyRequest(req);
  if (!auth) return errorResponse(401, 'UNAUTHORIZED', 'Authentication required.');

  const { userId } = auth;

  // Read ref code from cookie (set client-side when ?ref= URL param is detected)
  const refCode = req.cookies.get('ref')?.value?.trim();
  if (!refCode) {
    return NextResponse.json({ converted: false, reason: 'no_ref_cookie' });
  }

  const { data: converted, error } = await supabase.rpc('record_referral_conversion', {
    p_referred_user_id: userId,
    p_ref_code: refCode,
  });

  if (error) {
    console.error('[/api/referral/convert] rpc error:', error.message);
    return errorResponse(500, 'INTERNAL_ERROR', 'Failed to record referral conversion.');
  }

  return NextResponse.json({ converted: converted === true });
}
