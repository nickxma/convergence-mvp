/**
 * GET /api/subscriptions/plans
 *
 * Returns active subscription plans for the /pricing page.
 * Public — no auth required.
 *
 * Response: { plans: SubscriptionPlan[] }
 */
import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export interface SubscriptionPlan {
  id: string;
  name: string;
  description: string | null;
  features: string[];
  priceMonthlyPYUSD: number;
  sortOrder: number;
}

export async function GET(): Promise<NextResponse> {
  const { data, error } = await supabase
    .from('subscription_plans')
    .select('id, name, description, features, price_monthly_pyusd, sort_order')
    .eq('active', true)
    .order('sort_order');

  if (error) {
    console.error('[subscriptions/plans] db_error:', error.message);
    return NextResponse.json({ error: 'Failed to load plans.' }, { status: 500 });
  }

  const plans: SubscriptionPlan[] = (data ?? []).map((row) => ({
    id: row.id as string,
    name: row.name as string,
    description: row.description as string | null,
    features: (row.features as string[]) ?? [],
    priceMonthlyPYUSD: Number(row.price_monthly_pyusd),
    sortOrder: row.sort_order as number,
  }));

  return NextResponse.json({ plans });
}
