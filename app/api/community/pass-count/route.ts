/**
 * GET /api/community/pass-count
 *
 * Returns the total number of Acceptance Pass holders from the Base mainnet contract.
 * Public endpoint — no auth required.
 *
 * Response:
 *   totalPassHolders — number | null (null if contract not configured)
 */
import { NextResponse } from 'next/server';
import { getTotalPassHolders } from '@/lib/token-gate';

export async function GET() {
  try {
    const totalPassHolders = await getTotalPassHolders();
    return NextResponse.json({ totalPassHolders });
  } catch (err) {
    console.error('[/api/community/pass-count]', err);
    return NextResponse.json({ totalPassHolders: null });
  }
}
