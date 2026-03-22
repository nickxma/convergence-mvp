/**
 * Subscription tier helpers.
 *
 * Tiers: free (default) | pro | team
 * Free: 5 Q&A questions / day (read-only community), intro courses, essay reading.
 * Pro:  unlimited Q&A, all courses, community posting, DMs, wallet features, session notes.
 * Team: placeholder.
 */
import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export type SubscriptionTier = 'free' | 'pro' | 'team';

export const FREE_TIER_DAILY_LIMIT = 5;

/**
 * Feature gate configuration.
 * Maps feature identifiers to the minimum tier required to access them.
 * The `qa_unlimited` feature is enforced by the daily counter in /api/ask;
 * all others are enforced via requiresPro().
 */
export const FEATURE_GATES = {
  qa_unlimited:     { minTier: 'pro', label: 'Unlimited Q&A' },
  community_post:   { minTier: 'pro', label: 'Community post creation' },
  dms:              { minTier: 'pro', label: 'Direct messages' },
  wallet:           { minTier: 'pro', label: 'Wallet features' },
  session_notes:    { minTier: 'pro', label: 'Session notes' },
} as const;

export type FeatureKey = keyof typeof FEATURE_GATES;

const TIER_RANK: Record<SubscriptionTier, number> = { free: 0, pro: 1, team: 2 };

/**
 * Check whether a user's tier satisfies a feature gate.
 * Returns { allowed: true } or { allowed: false, response } where response is
 * a 402 NextResponse the API route should return immediately.
 *
 * Usage:
 *   const gate = await requiresPro('community_post', userId);
 *   if (!gate.allowed) return gate.response;
 */
export async function requiresPro(
  feature: FeatureKey,
  userId: string,
): Promise<{ allowed: true } | { allowed: false; response: NextResponse }> {
  const sub = await getUserSubscription(userId);
  const gate = FEATURE_GATES[feature];
  const requiredRank = TIER_RANK[gate.minTier as SubscriptionTier];

  if (TIER_RANK[sub.tier] >= requiredRank) {
    return { allowed: true };
  }

  // Fire-and-forget gate event for PostHog / observability
  trackGateEvent(feature, userId).catch(() => {});

  return {
    allowed: false,
    response: NextResponse.json(
      { error: 'upgrade_required', feature, requiredTier: gate.minTier },
      { status: 402 },
    ),
  };
}

/**
 * Track a feature gate trigger event.
 * Logs server-side and optionally sends to PostHog when POSTHOG_API_KEY is set.
 */
async function trackGateEvent(feature: FeatureKey, userId: string): Promise<void> {
  console.info(`[feature-gate] blocked feature=${feature} user=${userId}`);

  const apiKey = process.env.POSTHOG_API_KEY;
  if (!apiKey) return;

  try {
    await fetch('https://app.posthog.com/capture/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        event: 'feature_gate_triggered',
        distinct_id: userId,
        properties: { feature, required_tier: FEATURE_GATES[feature].minTier },
      }),
    });
  } catch {
    // Non-fatal — analytics must never block the request path
  }
}

export interface UserSubscription {
  tier: SubscriptionTier;
  stripeSubscriber: boolean;
  currentPeriodEnd: string | null;
}

/**
 * Fetch subscription record for a Privy user ID.
 * Returns free-tier defaults if no record exists.
 */
export async function getUserSubscription(userId: string): Promise<UserSubscription> {
  const { data, error } = await supabase
    .from('subscriptions')
    .select('tier, stripe_subscriber, current_period_end')
    .eq('user_id', userId)
    .single();

  if (error || !data) {
    return { tier: 'free', stripeSubscriber: false, currentPeriodEnd: null };
  }

  return {
    tier: (data.tier as SubscriptionTier) ?? 'free',
    stripeSubscriber: (data.stripe_subscriber as boolean) ?? false,
    currentPeriodEnd: (data.current_period_end as string) ?? null,
  };
}

/**
 * Atomically increment a user's daily Q&A question count.
 * Returns the new count (used to enforce the free-tier limit).
 * Fails open (returns 0) if the DB call fails, to avoid blocking the user.
 */
export async function incrementUserQaUsage(userId: string): Promise<number> {
  const { data, error } = await supabase.rpc('increment_user_qa_usage', {
    p_user_id: userId,
  });

  if (error) {
    console.warn('[subscription] increment_user_qa_usage error:', error.message);
    return 0; // fail open — do not block on tracking failure
  }

  return (data as number) ?? 0;
}

/**
 * Get how many Q&A questions a user has asked today (UTC date).
 * Returns 0 if no record found.
 */
export async function getDailyQaUsage(userId: string): Promise<number> {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const { data, error } = await supabase
    .from('user_daily_qa_usage')
    .select('count')
    .eq('user_id', userId)
    .eq('date', today)
    .single();

  if (error || !data) return 0;
  return (data.count as number) ?? 0;
}
