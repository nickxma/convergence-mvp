/**
 * GET /api/credits/packages
 *
 * Returns the active credit package catalogue.
 * Public — no auth required so the /credits page can render SSR.
 *
 * Response: { packages: CreditPackage[] }
 */
import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export interface CreditPackage {
  id: string;
  label: string;
  credits: number;
  priceUSD: number;
  pricePYUSD: number;
  sortOrder: number;
}

export async function GET(): Promise<NextResponse> {
  const { data, error } = await supabase
    .from('credit_packages')
    .select('id, label, credits, price_usd, price_pyusd, sort_order')
    .eq('active', true)
    .order('sort_order');

  if (error) {
    console.error('[credits/packages] db_error:', error.message);
    return NextResponse.json({ error: 'Failed to load packages.' }, { status: 500 });
  }

  const packages: CreditPackage[] = (data ?? []).map((row) => ({
    id: row.id as string,
    label: row.label as string,
    credits: row.credits as number,
    priceUSD: Number(row.price_usd),
    pricePYUSD: Number(row.price_pyusd),
    sortOrder: row.sort_order as number,
  }));

  return NextResponse.json({ packages });
}
