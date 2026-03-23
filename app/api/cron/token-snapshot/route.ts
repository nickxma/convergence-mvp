/**
 * GET /api/cron/token-snapshot — nightly on-chain token balance snapshot
 *
 * Vercel Cron: runs daily at 02:00 UTC.
 * Reads all wallet addresses from token_balances, fetches their current
 * on-chain ERC-20 balance, and upserts a dated snapshot into token_snapshots.
 *
 * Governance vote eligibility is determined from the snapshot taken at proposal
 * creation time — not live balance — to prevent flash-loan voting manipulation.
 *
 * Protected by CRON_SECRET (Vercel Cron sends Authorization: Bearer <CRON_SECRET>).
 */
import { NextRequest, NextResponse } from 'next/server';
import { createPublicClient, http, formatUnits, type Address } from 'viem';
import { arbitrumSepolia } from 'viem/chains';
import { supabase } from '@/lib/supabase';
import { logAudit } from '@/lib/admin-audit-log';

const BATCH_SIZE = 50; // wallets per RPC batch
const SNAPSHOT_DATE = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

const ERC20_ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'decimals',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
  },
] as const;

async function fetchBalanceBatch(
  client: ReturnType<typeof createPublicClient>,
  contractAddress: Address,
  decimals: number,
  wallets: string[],
): Promise<{ walletAddress: string; tokenBalance: number }[]> {
  const calls = wallets.map((wallet) => ({
    address: contractAddress,
    abi: ERC20_ABI,
    functionName: 'balanceOf' as const,
    args: [wallet as Address],
  }));

  const results = await client.multicall({ contracts: calls, allowFailure: true });

  return wallets.map((walletAddress, i) => {
    const res = results[i];
    const raw = res.status === 'success' ? (res.result as bigint) : BigInt(0);
    return { walletAddress, tokenBalance: parseFloat(formatUnits(raw, decimals)) };
  });
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get('authorization');
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Invalid cron secret.' } }, { status: 401 });
    }
  }

  const contractAddress = process.env.NEXT_PUBLIC_TOKEN_CONTRACT_ADDRESS as Address | undefined;
  if (!contractAddress) {
    return NextResponse.json({ error: { code: 'CONFIG_ERROR', message: 'NEXT_PUBLIC_TOKEN_CONTRACT_ADDRESS not set.' } }, { status: 500 });
  }

  const rpcUrl = process.env.NEXT_PUBLIC_ARBITRUM_SEPOLIA_RPC ?? 'https://sepolia-rollup.arbitrum.io/rpc';
  const client = createPublicClient({ chain: arbitrumSepolia, transport: http(rpcUrl) });

  // Fetch token decimals once
  let decimals: number;
  try {
    decimals = await client.readContract({
      address: contractAddress,
      abi: ERC20_ABI,
      functionName: 'decimals',
    }) as number;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[token-snapshot] decimals_fetch_error:', msg);
    return NextResponse.json({ error: { code: 'RPC_ERROR', message: 'Failed to fetch token decimals.' } }, { status: 502 });
  }

  // Load all wallet addresses from the token_balances cache table
  const { data: walletRows, error: walletErr } = await supabase
    .from('token_balances')
    .select('wallet_address');

  if (walletErr) {
    console.error('[token-snapshot] wallet_fetch_error:', walletErr.message);
    return NextResponse.json({ error: { code: 'DB_ERROR', message: 'Failed to load wallet list.' } }, { status: 502 });
  }

  const wallets = (walletRows ?? []).map((r) => r.wallet_address as string);
  if (wallets.length === 0) {
    return NextResponse.json({ snapshotDate: SNAPSHOT_DATE, processed: 0, errors: 0 });
  }

  let processed = 0;
  let errors = 0;

  // Process in batches to avoid overwhelming the RPC node
  for (let i = 0; i < wallets.length; i += BATCH_SIZE) {
    const batch = wallets.slice(i, i + BATCH_SIZE);

    let snapshots: { walletAddress: string; tokenBalance: number }[];
    try {
      snapshots = await fetchBalanceBatch(client, contractAddress, decimals, batch);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[token-snapshot] batch_error offset=${i}:`, msg);
      errors += batch.length;
      continue;
    }

    // Upsert snapshot rows (one per wallet per day)
    const rows = snapshots.map(({ walletAddress, tokenBalance }) => ({
      wallet_address: walletAddress,
      token_balance:  Math.floor(tokenBalance), // store whole units
      snapshot_date:  SNAPSHOT_DATE,
    }));

    const { error: upsertErr } = await supabase
      .from('token_snapshots')
      .upsert(rows, { onConflict: 'wallet_address,snapshot_date' });

    if (upsertErr) {
      console.error(`[token-snapshot] upsert_error offset=${i}:`, upsertErr.message);
      errors += batch.length;
    } else {
      processed += batch.length;

      // Refresh the token_balances cache table with fresh on-chain values
      await supabase
        .from('token_balances')
        .upsert(
          snapshots.map(({ walletAddress, tokenBalance }) => ({
            wallet_address: walletAddress,
            token_balance:  Math.floor(tokenBalance),
            last_synced_at: new Date().toISOString(),
          })),
          { onConflict: 'wallet_address' },
        );
    }
  }

  logAudit({
    actorId: 'system',
    actorRole: 'cron',
    action: 'token.snapshot',
    targetType: 'token_snapshots',
    metadata: { snapshotDate: SNAPSHOT_DATE, processed, errors, total: wallets.length },
  });

  console.log(`[token-snapshot] done date=${SNAPSHOT_DATE} processed=${processed} errors=${errors} total=${wallets.length}`);

  return NextResponse.json({ snapshotDate: SNAPSHOT_DATE, processed, errors, total: wallets.length });
}
