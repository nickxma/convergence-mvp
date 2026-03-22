/**
 * Unit tests for Q&A analytics aggregation helpers.
 */
import { describe, it, expect } from 'vitest';
import {
  calcAvgLatency,
  calcAvgTopScore,
  calcDailyCounts,
  calcScoreDistribution,
  topQuestionsByFrequency,
} from '../lib/qa-analytics';

// ── calcAvgLatency ────────────────────────────────────────────────────────────

describe('calcAvgLatency', () => {
  it('returns null for empty input', () => {
    expect(calcAvgLatency([])).toBeNull();
  });

  it('returns the single row latency unchanged', () => {
    expect(calcAvgLatency([{ latency_ms: 400, pinecone_scores: [] }])).toBe(400);
  });

  it('returns rounded average across multiple rows', () => {
    const rows = [
      { latency_ms: 100, pinecone_scores: [] },
      { latency_ms: 200, pinecone_scores: [] },
      { latency_ms: 300, pinecone_scores: [] },
    ];
    expect(calcAvgLatency(rows)).toBe(200);
  });

  it('rounds fractional averages', () => {
    const rows = [
      { latency_ms: 100, pinecone_scores: [] },
      { latency_ms: 101, pinecone_scores: [] },
    ];
    // (100 + 101) / 2 = 100.5 → rounds to 101
    expect(calcAvgLatency(rows)).toBe(101);
  });
});

// ── calcAvgTopScore ───────────────────────────────────────────────────────────

describe('calcAvgTopScore', () => {
  it('returns null for empty input', () => {
    expect(calcAvgTopScore([])).toBeNull();
  });

  it('returns null when all rows have empty scores', () => {
    const rows = [
      { latency_ms: 100, pinecone_scores: [] },
      { latency_ms: 200, pinecone_scores: [] },
    ];
    expect(calcAvgTopScore(rows)).toBeNull();
  });

  it('returns the top-1 score for a single row', () => {
    expect(calcAvgTopScore([{ latency_ms: 100, pinecone_scores: [0.85, 0.7, 0.6] }])).toBe(0.85);
  });

  it('averages only the first score across rows', () => {
    const rows = [
      { latency_ms: 100, pinecone_scores: [0.8, 0.5] },
      { latency_ms: 200, pinecone_scores: [0.6, 0.3] },
    ];
    // avg of 0.8 and 0.6 = 0.7
    expect(calcAvgTopScore(rows)).toBe(0.7);
  });

  it('skips rows without scores when computing average', () => {
    const rows = [
      { latency_ms: 100, pinecone_scores: [0.9] },
      { latency_ms: 200, pinecone_scores: [] },
    ];
    // only 0.9 counts
    expect(calcAvgTopScore(rows)).toBe(0.9);
  });

  it('rounds to 4 decimal places', () => {
    const rows = [
      { latency_ms: 100, pinecone_scores: [1 / 3] },
    ];
    expect(calcAvgTopScore(rows)).toBe(0.3333);
  });
});

// ── topQuestionsByFrequency ───────────────────────────────────────────────────

describe('topQuestionsByFrequency', () => {
  it('returns empty array for empty input', () => {
    expect(topQuestionsByFrequency([])).toEqual([]);
  });

  it('counts and sorts by frequency descending', () => {
    const rows = [
      { question_hash: 'aaa' },
      { question_hash: 'bbb' },
      { question_hash: 'aaa' },
      { question_hash: 'ccc' },
      { question_hash: 'aaa' },
      { question_hash: 'bbb' },
    ];
    const result = topQuestionsByFrequency(rows);
    expect(result[0]).toEqual({ hash: 'aaa', count: 3 });
    expect(result[1]).toEqual({ hash: 'bbb', count: 2 });
    expect(result[2]).toEqual({ hash: 'ccc', count: 1 });
  });

  it('respects the default limit of 20', () => {
    const rows = Array.from({ length: 30 }, (_, i) => ({ question_hash: `hash-${i}` }));
    const result = topQuestionsByFrequency(rows);
    expect(result).toHaveLength(20);
  });

  it('respects a custom limit', () => {
    const rows = [
      { question_hash: 'aaa' },
      { question_hash: 'bbb' },
      { question_hash: 'ccc' },
    ];
    const result = topQuestionsByFrequency(rows, 2);
    expect(result).toHaveLength(2);
  });

  it('returns all when fewer than limit', () => {
    const rows = [{ question_hash: 'x' }, { question_hash: 'y' }];
    expect(topQuestionsByFrequency(rows, 20)).toHaveLength(2);
  });
});

// ── calcDailyCounts ───────────────────────────────────────────────────────────

describe('calcDailyCounts', () => {
  it('returns 7 entries by default', () => {
    const result = calcDailyCounts([]);
    expect(result).toHaveLength(7);
  });

  it('returns all zeros for empty input', () => {
    const result = calcDailyCounts([]);
    expect(result.every((d) => d.count === 0)).toBe(true);
  });

  it('counts rows falling within their UTC date', () => {
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    const rows = [
      { created_at: now.toISOString() },
      { created_at: now.toISOString() },
    ];
    const result = calcDailyCounts(rows);
    const today = result.find((d) => d.date === todayStr);
    expect(today?.count).toBe(2);
  });

  it('ignores rows outside the window', () => {
    const old = new Date();
    old.setUTCDate(old.getUTCDate() - 30);
    const result = calcDailyCounts([{ created_at: old.toISOString() }]);
    expect(result.every((d) => d.count === 0)).toBe(true);
  });

  it('dates are in ascending order', () => {
    const result = calcDailyCounts([]);
    for (let i = 1; i < result.length; i++) {
      expect(result[i].date > result[i - 1].date).toBe(true);
    }
  });

  it('respects a custom days parameter', () => {
    const result = calcDailyCounts([], 3);
    expect(result).toHaveLength(3);
  });
});

// ── calcScoreDistribution ─────────────────────────────────────────────────────

describe('calcScoreDistribution', () => {
  it('returns 10 buckets', () => {
    expect(calcScoreDistribution([])).toHaveLength(10);
  });

  it('returns all zeros for empty input', () => {
    const result = calcScoreDistribution([]);
    expect(result.every((b) => b.count === 0)).toBe(true);
  });

  it('skips rows with empty scores', () => {
    const rows = [{ latency_ms: 100, pinecone_scores: [] }];
    const result = calcScoreDistribution(rows);
    expect(result.every((b) => b.count === 0)).toBe(true);
  });

  it('places score 0.85 in the 0.8–0.9 bucket', () => {
    const rows = [{ latency_ms: 100, pinecone_scores: [0.85, 0.5] }];
    const result = calcScoreDistribution(rows);
    const bucket = result.find((b) => b.bucket === '0.8–0.9');
    expect(bucket?.count).toBe(1);
  });

  it('clamps score of 1.0 to the last bucket', () => {
    const rows = [{ latency_ms: 100, pinecone_scores: [1.0] }];
    const result = calcScoreDistribution(rows);
    const last = result[result.length - 1];
    expect(last.count).toBe(1);
  });

  it('uses only the top-1 score per row', () => {
    const rows = [
      { latency_ms: 100, pinecone_scores: [0.15, 0.55, 0.75] },
    ];
    const result = calcScoreDistribution(rows);
    // score 0.15 → bucket index 1 ("0.1–0.2")
    const bucket = result.find((b) => b.bucket === '0.1–0.2');
    expect(bucket?.count).toBe(1);
    // total across all buckets must be 1
    const total = result.reduce((s, b) => s + b.count, 0);
    expect(total).toBe(1);
  });
});
