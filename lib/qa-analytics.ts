/**
 * Pure aggregation helpers for Q&A analytics.
 * Extracted so they can be unit-tested without a real DB.
 */

export interface AnalyticsRow {
  latency_ms: number;
  pinecone_scores: number[];
}

export interface QuestionHashRow {
  question_hash: string;
}

/** Average latency across all rows. Returns null for empty input. */
export function calcAvgLatency(rows: AnalyticsRow[]): number | null {
  if (rows.length === 0) return null;
  const total = rows.reduce((sum, r) => sum + (r.latency_ms ?? 0), 0);
  return Math.round(total / rows.length);
}

/** Average top-1 Pinecone score. Skips rows with no scores. Returns null if none. */
export function calcAvgTopScore(rows: AnalyticsRow[]): number | null {
  const withScore = rows.filter((r) => Array.isArray(r.pinecone_scores) && r.pinecone_scores.length > 0);
  if (withScore.length === 0) return null;
  const total = withScore.reduce((sum, r) => sum + r.pinecone_scores[0], 0);
  return Math.round((total / withScore.length) * 10000) / 10000;
}

/** Returns top N question hashes by frequency, descending. */
export function topQuestionsByFrequency(
  rows: QuestionHashRow[],
  limit = 20,
): Array<{ hash: string; count: number }> {
  const freqMap = new Map<string, number>();
  for (const row of rows) {
    freqMap.set(row.question_hash, (freqMap.get(row.question_hash) ?? 0) + 1);
  }
  return [...freqMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([hash, count]) => ({ hash, count }));
}
