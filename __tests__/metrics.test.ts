/**
 * Unit tests for community health metrics helpers.
 *
 * Tests metric calculations without making real DB or RPC calls.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  calcVoterParticipationRate,
  periodStartIso,
  topPostsFromRows,
  getCached,
  setCached,
  clearCache,
  type MetricsResponse,
} from '../lib/metrics';

// ── calcVoterParticipationRate ────────────────────────────────────────────────

describe('calcVoterParticipationRate', () => {
  it('returns correct rate when both inputs are valid', () => {
    expect(calcVoterParticipationRate(50, 100)).toBeCloseTo(0.5);
  });

  it('returns 1.0 when all pass holders have voted', () => {
    expect(calcVoterParticipationRate(100, 100)).toBeCloseTo(1.0);
  });

  it('can exceed 1.0 if vote count somehow exceeds supply', () => {
    // Should not happen in practice but the math is still well-defined
    expect(calcVoterParticipationRate(110, 100)).toBeCloseTo(1.1);
  });

  it('returns null when totalPassHolders is null', () => {
    expect(calcVoterParticipationRate(50, null)).toBeNull();
  });

  it('returns null when totalPassHolders is 0 (avoids division by zero)', () => {
    expect(calcVoterParticipationRate(0, 0)).toBeNull();
  });

  it('returns 0 when no voters exist but pass holders do', () => {
    expect(calcVoterParticipationRate(0, 100)).toBeCloseTo(0);
  });
});

// ── periodStartIso ────────────────────────────────────────────────────────────

describe('periodStartIso', () => {
  const FIXED_NOW = new Date('2026-03-21T12:00:00.000Z').getTime();

  it('returns ISO string 7 days before now', () => {
    const result = periodStartIso(7, FIXED_NOW);
    expect(result).toBe('2026-03-14T12:00:00.000Z');
  });

  it('returns ISO string 30 days before now', () => {
    const result = periodStartIso(30, FIXED_NOW);
    expect(result).toBe('2026-02-19T12:00:00.000Z');
  });

  it('returns ISO string 90 days before now', () => {
    const result = periodStartIso(90, FIXED_NOW);
    expect(result).toBe('2025-12-21T12:00:00.000Z');
  });

  it('returns a valid ISO 8601 string', () => {
    const result = periodStartIso(7);
    expect(() => new Date(result)).not.toThrow();
    expect(new Date(result).toISOString()).toBe(result);
  });
});

// ── topPostsFromRows ──────────────────────────────────────────────────────────

describe('topPostsFromRows', () => {
  const rows = [
    { id: 3, title: 'Third', author_wallet: '0xaaa', votes: 10 },
    { id: 1, title: 'First', author_wallet: '0xbbb', votes: 50 },
    { id: 2, title: 'Second', author_wallet: '0xccc', votes: 30 },
    { id: 4, title: 'Fourth', author_wallet: '0xddd', votes: 5 },
    { id: 5, title: 'Fifth', author_wallet: '0xeee', votes: 3 },
    { id: 6, title: 'Sixth', author_wallet: '0xfff', votes: 1 },
  ];

  it('returns the top 5 posts sorted by votes descending', () => {
    const result = topPostsFromRows(rows);
    expect(result).toHaveLength(5);
    expect(result[0].votes).toBe(50);
    expect(result[1].votes).toBe(30);
    expect(result[2].votes).toBe(10);
    expect(result[3].votes).toBe(5);
    expect(result[4].votes).toBe(3);
  });

  it('respects a custom limit', () => {
    const result = topPostsFromRows(rows, 3);
    expect(result).toHaveLength(3);
    expect(result[0].votes).toBe(50);
    expect(result[2].votes).toBe(10);
  });

  it('maps id to string', () => {
    const result = topPostsFromRows([{ id: 42, title: 'T', author_wallet: '0x1', votes: 1 }]);
    expect(result[0].id).toBe('42');
    expect(typeof result[0].id).toBe('string');
  });

  it('maps author_wallet to authorWallet', () => {
    const result = topPostsFromRows([{ id: 1, title: 'T', author_wallet: '0xabc', votes: 1 }]);
    expect(result[0].authorWallet).toBe('0xabc');
  });

  it('returns empty array for empty input', () => {
    expect(topPostsFromRows([])).toHaveLength(0);
  });

  it('returns all rows when fewer than limit', () => {
    const short = rows.slice(0, 3);
    const result = topPostsFromRows(short, 5);
    expect(result).toHaveLength(3);
  });
});

// ── Cache helpers ─────────────────────────────────────────────────────────────

describe('metrics cache', () => {
  const MOCK_METRICS: MetricsResponse = {
    allTime: { totalPosts: 10, totalReplies: 50, totalVotes: 200, totalVoters: 30 },
    period: { label: '7d', totalPosts: 2, totalReplies: 8, totalVotes: 20, activeContributors: 5 },
    topPosts: [],
    voterParticipationRate: 0.3,
  };

  beforeEach(() => clearCache());

  it('returns null on cache miss', () => {
    expect(getCached('metrics:7d')).toBeNull();
  });

  it('returns cached data after set', () => {
    setCached('metrics:7d', MOCK_METRICS);
    expect(getCached('metrics:7d')).toEqual(MOCK_METRICS);
  });

  it('returns null after TTL expires', () => {
    vi.useFakeTimers();
    setCached('metrics:7d', MOCK_METRICS);
    vi.advanceTimersByTime(5 * 60 * 1000 + 1); // 5 min + 1ms
    expect(getCached('metrics:7d')).toBeNull();
    vi.useRealTimers();
  });

  it('does not expire before TTL', () => {
    vi.useFakeTimers();
    setCached('metrics:7d', MOCK_METRICS);
    vi.advanceTimersByTime(5 * 60 * 1000 - 1); // 1ms before expiry
    expect(getCached('metrics:7d')).toEqual(MOCK_METRICS);
    vi.useRealTimers();
  });

  it('caches different periods independently', () => {
    const metrics30d = { ...MOCK_METRICS, period: { ...MOCK_METRICS.period, label: '30d' as const } };
    setCached('metrics:7d', MOCK_METRICS);
    setCached('metrics:30d', metrics30d);
    expect(getCached('metrics:7d')?.period.label).toBe('7d');
    expect(getCached('metrics:30d')?.period.label).toBe('30d');
    expect(getCached('metrics:90d')).toBeNull();
  });

  it('clears all cache entries', () => {
    setCached('metrics:7d', MOCK_METRICS);
    setCached('metrics:30d', MOCK_METRICS);
    clearCache();
    expect(getCached('metrics:7d')).toBeNull();
    expect(getCached('metrics:30d')).toBeNull();
  });
});
