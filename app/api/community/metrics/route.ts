/**
 * GET /api/community/metrics?period=7d|30d|90d
 *
 * Returns aggregated community health statistics for the governance dashboard.
 * Results are cached in-memory with a 5-minute TTL per period.
 *
 * Response includes:
 *   - allTime: total posts, replies, votes, unique voters
 *   - period:  posts, replies, votes, active contributors within the window
 *   - topPosts: top 5 posts by vote count
 *   - voterParticipationRate: unique voters / total pass holders (null if unavailable)
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { getTotalPassHolders } from '@/lib/token-gate';
import {
  getCached,
  setCached,
  calcVoterParticipationRate,
  periodStartIso,
  topPostsFromRows,
  PERIOD_DAYS,
  type MetricsResponse,
  type Period,
} from '@/lib/metrics';

export const runtime = 'nodejs';

// Re-export for convenience (keeps old import paths working if any)
export type { MetricsResponse };

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const periodParam = searchParams.get('period') ?? '7d';

  if (!['7d', '30d', '90d'].includes(periodParam)) {
    return NextResponse.json(
      { error: { code: 'INVALID_PERIOD', message: "period must be one of: 7d, 30d, 90d" } },
      { status: 400 },
    );
  }

  const period = periodParam as Period;
  const cacheKey = `metrics:${period}`;

  const cached = getCached(cacheKey);
  if (cached) {
    return NextResponse.json(cached, { headers: { 'X-Cache': 'HIT' } });
  }

  try {
    const days = PERIOD_DAYS[period];
    const periodStart = periodStartIso(days);

    const [
      allTimePostsRes,
      allTimeRepliesRes,
      allTimeVotesRes,
      allTimeVotersRes,
      periodPostsRes,
      periodRepliesRes,
      periodVotesRes,
      periodContributorsRes,
      topPostsRes,
      totalPassHolders,
    ] = await Promise.all([
      supabase.from('posts').select('*', { count: 'exact', head: true }),
      supabase.from('replies').select('*', { count: 'exact', head: true }),
      supabase.from('votes').select('*', { count: 'exact', head: true }),
      supabase.from('votes').select('voter_wallet').limit(10000),
      supabase
        .from('posts')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', periodStart),
      supabase
        .from('replies')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', periodStart),
      supabase
        .from('votes')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', periodStart),
      supabase
        .from('posts')
        .select('author_wallet')
        .gte('created_at', periodStart),
      supabase
        .from('posts')
        .select('id, author_wallet, title, vote_score')
        .order('vote_score', { ascending: false })
        .limit(5),
      getTotalPassHolders().catch(() => null),
    ]);

    const uniqueVoterSet = new Set(
      (allTimeVotersRes.data ?? []).map((v) => v.voter_wallet as string),
    );
    const periodContributorSet = new Set(
      (periodContributorsRes.data ?? []).map((p) => p.author_wallet as string),
    );

    const metrics: MetricsResponse = {
      allTime: {
        totalPosts: allTimePostsRes.count ?? 0,
        totalReplies: allTimeRepliesRes.count ?? 0,
        totalVotes: allTimeVotesRes.count ?? 0,
        totalVoters: uniqueVoterSet.size,
      },
      period: {
        label: period,
        totalPosts: periodPostsRes.count ?? 0,
        totalReplies: periodRepliesRes.count ?? 0,
        totalVotes: periodVotesRes.count ?? 0,
        activeContributors: periodContributorSet.size,
      },
      topPosts: topPostsFromRows(topPostsRes.data ?? []),
      voterParticipationRate: calcVoterParticipationRate(
        uniqueVoterSet.size,
        totalPassHolders,
      ),
    };

    setCached(cacheKey, metrics);
    return NextResponse.json(metrics, { headers: { 'X-Cache': 'MISS' } });
  } catch (err) {
    console.error('[/api/community/metrics]', err);
    return NextResponse.json(
      { error: 'Failed to fetch metrics' },
      { status: 502 },
    );
  }
}
