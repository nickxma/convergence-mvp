/**
 * GET /api/leaderboard?period=alltime|weekly|monthly[&userId=<privy-did>]
 *
 * OpenClaw winner leaderboard — top 50 players ranked by prize count.
 * Ties broken by total play sessions (proxy for credits spent).
 * Computed from prizes_won + claw_sessions tables via get_winner_leaderboard().
 *
 * Cache: Upstash Redis, 10-minute TTL per period key. Falls back to uncached.
 *
 * Optional `userId` param: if provided and that user is outside top 50, their
 * rank + stats are returned in a `viewer` field (not cached — per-user).
 *
 * Response:
 *   period  — echoed back
 *   items   — ranked list of { rank, userId, playerDisplay, prizeCount, lastWinDate, totalSessions }
 *   viewer? — same shape with rank; present only when userId is outside top 50
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

const LEADERBOARD_TTL_SEC = 600; // 10 minutes
const VALID_PERIODS = new Set(['alltime', 'weekly', 'monthly']);

// ─── Redis helpers (Upstash REST) ─────────────────────────────────────────────

function getRedisConfig(): { url: string; token: string } | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return { url, token };
}

async function redisGet(key: string): Promise<unknown | null> {
  const redis = getRedisConfig();
  if (!redis) return null;
  try {
    const res = await fetch(`${redis.url}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${redis.token}` },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { result: string | null };
    if (json.result === null) return null;
    return JSON.parse(json.result);
  } catch {
    return null;
  }
}

async function redisSet(key: string, value: unknown, ttlSec: number): Promise<void> {
  const redis = getRedisConfig();
  if (!redis) return;
  try {
    await fetch(`${redis.url}/set/${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${redis.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ value: JSON.stringify(value), ex: ttlSec }),
    });
  } catch {
    // Non-fatal — degrade to uncached
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  playerDisplay: string;
  prizeCount: number;
  lastWinDate: string;
  totalSessions: number;
}

// ─── DB helpers ───────────────────────────────────────────────────────────────

async function fetchTopPlayers(period: string): Promise<LeaderboardEntry[]> {
  const { data, error } = await supabase.rpc('get_winner_leaderboard', {
    p_period: period,
    p_limit: 50,
  });

  if (error) {
    console.error('[/api/leaderboard] get_winner_leaderboard error:', error.message);
    throw new Error('DB_ERROR');
  }

  return (data ?? []).map((row: Record<string, unknown>, i: number) => ({
    rank: i + 1,
    userId: row.user_id as string,
    playerDisplay: row.player_display as string,
    prizeCount: Number(row.prize_count),
    lastWinDate: row.last_win_date as string,
    totalSessions: Number(row.total_sessions),
  }));
}

async function fetchViewerStats(
  userId: string,
  period: string,
): Promise<(LeaderboardEntry & { rank: number }) | null> {
  const { data, error } = await supabase.rpc('get_player_leaderboard_stats', {
    p_user_id: userId,
    p_period: period,
  });

  if (error) {
    console.error('[/api/leaderboard] get_player_leaderboard_stats error:', error.message);
    return null;
  }

  if (!data || data.length === 0) return null;

  const row = data[0] as Record<string, unknown>;
  return {
    rank: Number(row.overall_rank),
    userId,
    playerDisplay: row.player_display as string,
    prizeCount: Number(row.prize_count),
    lastWinDate: (row.last_win_date as string | null) ?? '',
    totalSessions: Number(row.total_sessions),
  };
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(req.url);
  const period = searchParams.get('period') ?? 'alltime';
  const userId = searchParams.get('userId') ?? null;

  if (!VALID_PERIODS.has(period)) {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: 'period must be alltime, weekly, or monthly.' } },
      { status: 400 },
    );
  }

  const cacheKey = `winners:v1:${period}`;

  // Try Redis cache first
  let items = (await redisGet(cacheKey)) as LeaderboardEntry[] | null;

  if (!items) {
    try {
      items = await fetchTopPlayers(period);
    } catch {
      return NextResponse.json(
        { error: { code: 'DB_ERROR', message: 'Failed to load leaderboard.' } },
        { status: 502 },
      );
    }
    // Write-behind — don't block the response
    redisSet(cacheKey, items, LEADERBOARD_TTL_SEC).catch(() => {});
  }

  const response: {
    period: string;
    items: LeaderboardEntry[];
    viewer?: LeaderboardEntry & { rank: number };
  } = { period, items };

  // Attach viewer row if user is authenticated and outside top 50
  if (userId) {
    const inTop50 = items.some((it) => it.userId === userId);
    if (!inTop50) {
      const viewer = await fetchViewerStats(userId, period);
      if (viewer) response.viewer = viewer;
    }
  }

  return NextResponse.json(response);
}
