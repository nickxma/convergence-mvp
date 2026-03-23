import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { verifyRequest } from '@/lib/privy-auth';
import { BADGE_THRESHOLDS } from '@/app/api/meditations/[id]/complete/route';

// ── Types ─────────────────────────────────────────────────────────────────────

interface MeditationRow {
  id: string;
  theme: string;
  style: string;
  duration: number;
  title: string;
  rating: number | null;
  share_token: string | null;
  created_at: string;
}

interface LeaderboardRow {
  user_id: string;
  duration: number;
  user_name: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function toDateStr(iso: string): string {
  return iso.slice(0, 10);
}

function calcStreaks(dates: string[]): { current: number; longest: number } {
  if (dates.length === 0) return { current: 0, longest: 0 };

  const unique = [...new Set(dates)].sort();

  const todayStr = new Date().toISOString().slice(0, 10);
  const yesterdayStr = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

  // Current streak — walk backwards from today or yesterday
  let current = 0;
  const latestActive = unique.includes(todayStr)
    ? todayStr
    : unique.includes(yesterdayStr)
      ? yesterdayStr
      : null;

  if (latestActive) {
    current = 1;
    let d = new Date(latestActive);
    while (true) {
      d = new Date(d.getTime() - 86_400_000);
      if (unique.includes(d.toISOString().slice(0, 10))) {
        current++;
      } else {
        break;
      }
    }
  }

  // Longest streak — scan all unique dates
  let longest = 0;
  let run = 1;
  for (let i = 1; i < unique.length; i++) {
    const diff =
      (new Date(unique[i]).getTime() - new Date(unique[i - 1]).getTime()) / 86_400_000;
    if (diff === 1) {
      run++;
    } else {
      longest = Math.max(longest, run);
      run = 1;
    }
  }
  longest = Math.max(longest, run);

  return { current, longest };
}

// ── Handler ───────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const auth = await verifyRequest(req);
  if (!auth) {
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'Login required.' } },
      { status: 401 },
    );
  }

  // Personal sessions
  const { data: rows, error } = await supabase
    .from('meditations')
    .select('id, theme, style, duration, title, rating, share_token, created_at')
    .eq('user_id', auth.userId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error(`[/api/meditations/stats] db_error user=${auth.userId} err=${error.message}`);
    return NextResponse.json(
      { error: { code: 'DB_ERROR', message: 'Failed to load stats.' } },
      { status: 500 },
    );
  }

  const sessions = (rows ?? []) as MeditationRow[];

  // ── Aggregate stats ──────────────────────────────────────────────────────

  const totalSessions = sessions.length;
  const totalMinutes = sessions.reduce((s, r) => s + r.duration, 0);
  const avgDuration = totalSessions > 0 ? Math.round(totalMinutes / totalSessions) : 0;

  const themeCounts: Record<string, number> = {};
  const styleCounts: Record<string, number> = {};
  for (const r of sessions) {
    themeCounts[r.theme] = (themeCounts[r.theme] ?? 0) + 1;
    styleCounts[r.style] = (styleCounts[r.style] ?? 0) + 1;
  }
  const favoriteTheme =
    Object.entries(themeCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const favoriteStyle =
    Object.entries(styleCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  const ratingDistribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const r of sessions) {
    if (r.rating && r.rating >= 1 && r.rating <= 5) {
      ratingDistribution[r.rating]++;
    }
  }

  // ── Heatmap: last 365 days ────────────────────────────────────────────────

  const byDate: Record<string, { minutes: number; sessions: number }> = {};
  for (const r of sessions) {
    const d = toDateStr(r.created_at);
    if (!byDate[d]) byDate[d] = { minutes: 0, sessions: 0 };
    byDate[d].minutes += r.duration;
    byDate[d].sessions++;
  }

  const today = new Date();
  const heatmap: { date: string; minutes: number; sessions: number }[] = [];
  for (let i = 364; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86_400_000);
    const dateStr = d.toISOString().slice(0, 10);
    heatmap.push({ date: dateStr, ...(byDate[dateStr] ?? { minutes: 0, sessions: 0 }) });
  }

  // ── Streaks ───────────────────────────────────────────────────────────────

  const sessionDates = sessions.map((r) => toDateStr(r.created_at));
  const { current: currentStreak, longest: longestStreak } = calcStreaks(sessionDates);

  // ── Recent sessions ───────────────────────────────────────────────────────

  const recentSessions = sessions.slice(0, 10).map((r) => ({
    id: r.id,
    title: r.title,
    theme: r.theme,
    style: r.style,
    duration: r.duration,
    rating: r.rating,
    shareToken: r.share_token,
    createdAt: r.created_at,
  }));

  // ── Milestones ────────────────────────────────────────────────────────────

  const milestones = BADGE_THRESHOLDS.map((t) => ({
    days:    t.days,
    slug:    t.slug,
    achieved: longestStreak >= t.days,
  }));

  // ── Earned badges ────────────────────────────────────────────────────────

  const { data: badgeRows } = await supabase
    .from('user_meditation_badges')
    .select('badge_slug, earned_at')
    .eq('user_id', auth.userId);

  const earnedBadges = (badgeRows ?? []).map((r: { badge_slug: string; earned_at: string }) => ({
    slug:     r.badge_slug,
    earnedAt: r.earned_at,
  }));

  // ── Reputation ───────────────────────────────────────────────────────────

  const { data: repRow } = await supabase
    .from('user_reputation')
    .select('points')
    .eq('user_id', auth.userId)
    .maybeSingle();

  const reputationPoints = (repRow as { points: number } | null)?.points ?? 0;

  // ── Global leaderboard ────────────────────────────────────────────────────

  const { data: lbData } = await supabase
    .from('meditations')
    .select('user_id, duration, user_name')
    .not('user_id', 'is', null);

  const lbMap: Record<string, { totalMinutes: number; totalSessions: number; name: string }> = {};
  for (const r of (lbData ?? []) as LeaderboardRow[]) {
    if (!lbMap[r.user_id]) {
      lbMap[r.user_id] = { totalMinutes: 0, totalSessions: 0, name: r.user_name ?? '' };
    }
    lbMap[r.user_id].totalMinutes += r.duration;
    lbMap[r.user_id].totalSessions++;
    // prefer non-empty user_name
    if (r.user_name && !lbMap[r.user_id].name) {
      lbMap[r.user_id].name = r.user_name;
    }
  }

  const leaderboard = Object.entries(lbMap)
    .sort((a, b) => b[1].totalMinutes - a[1].totalMinutes)
    .slice(0, 10)
    .map(([userId, data], i) => ({
      rank: i + 1,
      displayName: data.name || (userId === auth.userId ? 'You' : `Meditator ${i + 1}`),
      totalMinutes: data.totalMinutes,
      totalSessions: data.totalSessions,
      isCurrentUser: userId === auth.userId,
    }));

  return NextResponse.json({
    currentStreak,
    longestStreak,
    totalSessions,
    totalMinutes,
    avgDuration,
    favoriteTheme,
    favoriteStyle,
    ratingDistribution,
    heatmap,
    recentSessions,
    milestones,
    earnedBadges,
    reputationPoints,
    leaderboard,
  });
}
