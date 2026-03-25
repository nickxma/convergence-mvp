/**
 * GET /api/referrals/leaderboard
 *
 * Returns the top 20 referrers ranked by converted referrals.
 * Public endpoint — no auth required (user IDs are returned as display handles).
 *
 * Response:
 *   { items: Array<{ rank, userId, converted, pending, creditsEarned }> }
 */
import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function GET(): Promise<NextResponse> {
  const { data, error } = await supabase.rpc('get_referral_leaderboard');

  if (error) {
    console.error('[referrals/leaderboard] db_error:', error.message);
    return NextResponse.json({ error: 'Failed to fetch leaderboard.' }, { status: 500 });
  }

  const rows = (data ?? []) as Array<{
    user_id: string;
    converted: number;
    pending: number;
    credits_earned: number;
  }>;

  const items = rows.map((row, i) => ({
    rank: i + 1,
    userId: row.user_id,
    converted: Number(row.converted),
    pending: Number(row.pending),
    creditsEarned: Number(row.credits_earned),
  }));

  return NextResponse.json({ items });
}
