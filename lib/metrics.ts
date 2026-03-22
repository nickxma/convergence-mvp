/**
 * Pure calculation helpers for community health metrics.
 * No I/O dependencies — safe to import in unit tests.
 */

export interface MetricsResponse {
  allTime: {
    totalPosts: number;
    totalReplies: number;
    totalVotes: number;
    totalVoters: number;
  };
  period: {
    label: '7d' | '30d' | '90d';
    totalPosts: number;
    totalReplies: number;
    totalVotes: number;
    activeContributors: number;
  };
  topPosts: Array<{
    id: string;
    title: string;
    authorWallet: string;
    votes: number;
  }>;
  voterParticipationRate: number | null;
}

export type Period = '7d' | '30d' | '90d';

export const PERIOD_DAYS: Record<Period, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
};

const CACHE_TTL_MS = 5 * 60 * 1000;

interface CacheEntry {
  data: MetricsResponse;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

export function getCached(key: string): MetricsResponse | null {
  const entry = cache.get(key);
  if (!entry || Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

export function setCached(key: string, data: MetricsResponse): void {
  cache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
}

export function clearCache(): void {
  cache.clear();
}

export function calcVoterParticipationRate(
  uniqueVoters: number,
  totalPassHolders: number | null,
): number | null {
  if (totalPassHolders == null || totalPassHolders <= 0) return null;
  return uniqueVoters / totalPassHolders;
}

export function periodStartIso(periodDays: number, now = Date.now()): string {
  return new Date(now - periodDays * 24 * 60 * 60 * 1000).toISOString();
}

export function topPostsFromRows(
  rows: Array<{ id: number | string; title: string; author_wallet: string; votes: number }>,
  limit = 5,
): MetricsResponse['topPosts'] {
  return rows
    .sort((a, b) => (b.votes as number) - (a.votes as number))
    .slice(0, limit)
    .map((p) => ({
      id: String(p.id),
      title: p.title as string,
      authorWallet: p.author_wallet as string,
      votes: p.votes as number,
    }));
}
