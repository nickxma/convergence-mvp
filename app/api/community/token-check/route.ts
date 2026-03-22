import { NextRequest, NextResponse } from 'next/server';
import { isPassHolder } from '@/lib/token-gate';

export async function GET(req: NextRequest) {
  const wallet = req.nextUrl.searchParams.get('wallet');
  if (!wallet) {
    return NextResponse.json({ error: 'wallet parameter is required' }, { status: 400 });
  }

  try {
    const hasPass = await isPassHolder(wallet);
    return NextResponse.json({ hasPass });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('not set')) {
      // Contract not configured — default to no pass (read-only)
      return NextResponse.json({ hasPass: false });
    }
    console.error('[/api/community/token-check]', msg);
    return NextResponse.json({ hasPass: false }, { status: 200 });
  }
}
