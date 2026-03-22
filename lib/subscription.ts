/**
 * Subscription tier helpers.
 *
 * Tiers: free (default) | pro | team
 * Free: 5 Q&A questions / day, community read+write, intro courses only.
 * Pro:  unlimited Q&A, all courses, bypass semantic cache.
 * Team: placeholder.
 */
import { supabase } from '@/lib/supabase';

export type SubscriptionTier = 'free' | 'pro' | 'team';

export const FREE_TIER_DAILY_LIMIT = 5;

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
