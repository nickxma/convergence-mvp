/**
 * GET /api/community/governance
 * Returns aggregated governance data: top posts, top contributors,
 * community stats, and trending posts for the last 7 days.
 */
import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [
      postsCountRes,
      repliesCountRes,
      topPostsRes,
      contributorPostsRes,
      recentVotesRes,
      uniqueVotersRes,
    ] = await Promise.all([
      supabase.from('posts').select('*', { count: 'exact', head: true }),
      supabase.from('replies').select('*', { count: 'exact', head: true }),
      supabase
        .from('posts')
        .select('id, author_wallet, title, vote_score')
        .order('vote_score', { ascending: false })
        .limit(10),
      // Fetch enough posts to compute top contributor rankings
      supabase
        .from('posts')
        .select('author_wallet, vote_score')
        .order('vote_score', { ascending: false })
        .limit(500),
      // Recent votes for trending calculation
      supabase
        .from('votes')
        .select('post_id')
        .gte('created_at', oneWeekAgo),
      // All voters for unique count
      supabase.from('votes').select('voter_wallet').limit(10000),
    ]);

    // ── Stats ──
    const totalPosts = postsCountRes.count ?? 0;
    const totalReplies = repliesCountRes.count ?? 0;
    const uniqueVoterSet = new Set(
      (uniqueVotersRes.data ?? []).map((v) => v.voter_wallet as string),
    );
    const totalVoters = uniqueVoterSet.size;

    // ── Top posts ──
    const topPosts = (topPostsRes.data ?? []).map((p) => ({
      id: String(p.id),
      authorWallet: p.author_wallet as string,
      title: p.title as string,
      votes: (p as any).vote_score as number,
    }));

    // ── Top contributors: aggregate votes per author ──
    const contributorMap = new Map<string, { totalVotes: number; postCount: number }>();
    for (const post of contributorPostsRes.data ?? []) {
      const key = post.author_wallet as string;
      const cur = contributorMap.get(key) ?? { totalVotes: 0, postCount: 0 };
      contributorMap.set(key, {
        totalVotes: cur.totalVotes + ((post as any).vote_score as number),
        postCount: cur.postCount + 1,
      });
    }
    const topContributors = Array.from(contributorMap.entries())
      .map(([authorWallet, { totalVotes, postCount }]) => ({
        authorWallet,
        totalVotes,
        postCount,
      }))
      .sort((a, b) => b.totalVotes - a.totalVotes)
      .slice(0, 10);

    // ── Trending this week: count recent votes per post ──
    const recentVotesByPost = new Map<string, number>();
    for (const vote of recentVotesRes.data ?? []) {
      const key = String((vote as any).post_id);
      recentVotesByPost.set(key, (recentVotesByPost.get(key) ?? 0) + 1);
    }

    const trendingIds = Array.from(recentVotesByPost.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([id]) => id);

    let trendingThisWeek: Array<{
      id: string;
      authorWallet: string;
      title: string;
      votes: number;
      weeklyVotes: number;
    }> = [];

    if (trendingIds.length > 0) {
      const trendingRes = await supabase
        .from('posts')
        .select('id, author_wallet, title, vote_score')
        .in('id', trendingIds);

      trendingThisWeek = (trendingRes.data ?? [])
        .map((p) => ({
          id: String(p.id),
          authorWallet: p.author_wallet as string,
          title: p.title as string,
          votes: (p as any).vote_score as number,
          weeklyVotes: recentVotesByPost.get(String(p.id)) ?? 0,
        }))
        .sort((a, b) => b.weeklyVotes - a.weeklyVotes);
    }

    return NextResponse.json({
      stats: { totalPosts, totalReplies, totalVoters },
      topPosts,
      topContributors,
      trendingThisWeek,
    });
  } catch (err) {
    console.error('[/api/community/governance]', err);
    return NextResponse.json(
      { error: 'Failed to fetch governance data' },
      { status: 502 },
    );
  }
}
