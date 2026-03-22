/**
 * Unit tests for Q&A analytics aggregation helpers.
 */
import { describe, it, expect } from 'vitest';
import { calcAvgLatency, calcAvgTopScore, topQuestionsByFrequency } from '../lib/qa-analytics';

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
