/**
 * Unit tests for Q&A quality monitor logic.
 */
import { describe, it, expect } from 'vitest';

// ── Quality score formula ─────────────────────────────────────────────────────
// quality_score = (pinecone_top1_score * 0.6) + (positive_feedback_rate * 0.4)

function computeQualityScore(pineconeTop1Score: number, positiveCount: number, totalCount: number): number {
  const positiveRate = totalCount > 0 ? positiveCount / totalCount : 0;
  return pineconeTop1Score * 0.6 + positiveRate * 0.4;
}

function isFlagged(qualityScore: number, feedbackCount: number): boolean {
  return qualityScore < 0.4 && feedbackCount >= 3;
}

describe('computeQualityScore', () => {
  it('returns 0.6 for perfect Pinecone score with no feedback', () => {
    expect(computeQualityScore(1.0, 0, 0)).toBeCloseTo(0.6);
  });

  it('returns 0 for zero Pinecone score with all negative feedback', () => {
    expect(computeQualityScore(0, 0, 5)).toBe(0);
  });

  it('returns 1.0 for perfect Pinecone score and 100% positive feedback', () => {
    expect(computeQualityScore(1.0, 10, 10)).toBe(1.0);
  });

  it('weights pinecone 60% and feedback 40%', () => {
    // pinecone=0.5, feedback=50% → 0.5*0.6 + 0.5*0.4 = 0.3+0.2 = 0.5
    expect(computeQualityScore(0.5, 5, 10)).toBeCloseTo(0.5);
  });

  it('handles zero feedback count without dividing by zero', () => {
    // feedback rate = 0 when totalCount = 0
    expect(computeQualityScore(0.8, 0, 0)).toBeCloseTo(0.48);
  });

  it('computes correctly for a low-quality scenario', () => {
    // pinecone=0.2, 1 up out of 5 → rate=0.2 → 0.2*0.6 + 0.2*0.4 = 0.12+0.08 = 0.2
    expect(computeQualityScore(0.2, 1, 5)).toBeCloseTo(0.2);
  });
});

describe('isFlagged', () => {
  it('flags entries with quality_score < 0.4 and feedback_count >= 3', () => {
    expect(isFlagged(0.3, 3)).toBe(true);
    expect(isFlagged(0.39, 10)).toBe(true);
  });

  it('does not flag entries with quality_score >= 0.4', () => {
    expect(isFlagged(0.4, 5)).toBe(false);
    expect(isFlagged(0.9, 100)).toBe(false);
  });

  it('does not flag entries with feedback_count < 3 even if score is low', () => {
    expect(isFlagged(0.1, 0)).toBe(false);
    expect(isFlagged(0.0, 2)).toBe(false);
  });

  it('does not flag at exactly quality_score = 0.4', () => {
    expect(isFlagged(0.4, 5)).toBe(false);
  });

  it('flags at exactly feedback_count = 3', () => {
    expect(isFlagged(0.3, 3)).toBe(true);
  });
});
