import { NextResponse } from 'next/server';
import { verifyRequest } from '@/lib/privy-auth';
import {
  getUserSubscription,
  getDailyQaUsage,
  FREE_TIER_DAILY_LIMIT,
} from '@/lib/subscription';
import type { NextRequest } from 'next/server';

/**
 * GET /api/subscriptions/me
 *
 * Returns the authenticated user's subscription tier and daily Q&A usage.
 *
 * Response:
 *   {
 *     tier: "free" | "pro" | "team",
 *     questionsUsedToday: number,
 *     questionsLimit: number | null,   // null = unlimited (pro/team)
 *     renewalDate: string | null        // ISO timestamp of next billing period end
 *   }
 */
export async function GET(req: NextRequest) {
  const auth = await verifyRequest(req);
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { userId } = auth;
  const [sub, questionsUsedToday] = await Promise.all([
    getUserSubscription(userId),
    getDailyQaUsage(userId),
  ]);

  const questionsLimit = sub.tier === 'free' ? FREE_TIER_DAILY_LIMIT : null;

  return NextResponse.json({
    tier: sub.tier,
    questionsUsedToday,
    questionsLimit,
    renewalDate: sub.currentPeriodEnd,
  });
}
