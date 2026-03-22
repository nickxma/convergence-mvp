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

export interface TimestampRow {
  created_at: string;
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

/**
 * Returns daily query counts for the last `days` days (default 7), inclusive of today.
 * Days with no queries get count: 0. Dates are YYYY-MM-DD UTC.
 */
export function calcDailyCounts(
  rows: TimestampRow[],
  days = 7,
): Array<{ date: string; count: number }> {
  const now = new Date();
  const result: Array<{ date: string; count: number }> = [];

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - i);
    result.push({ date: d.toISOString().slice(0, 10), count: 0 });
  }

  for (const row of rows) {
    const date = new Date(row.created_at).toISOString().slice(0, 10);
    const bucket = result.find((r) => r.date === date);
    if (bucket) bucket.count++;
  }

  return result;
}

/**
 * Buckets top-1 Pinecone scores into 10 bands: 0.0–0.1, 0.1–0.2, …, 0.9–1.0.
 * Rows with empty pinecone_scores are skipped.
 */
export function calcScoreDistribution(
  rows: AnalyticsRow[],
): Array<{ bucket: string; count: number }> {
  const buckets = Array.from({ length: 10 }, (_, i) => ({
    bucket: `${(i / 10).toFixed(1)}–${((i + 1) / 10).toFixed(1)}`,
    count: 0,
  }));

  for (const row of rows) {
    if (!Array.isArray(row.pinecone_scores) || row.pinecone_scores.length === 0) continue;
    const score = row.pinecone_scores[0];
    const idx = Math.min(Math.floor(score * 10), 9);
    buckets[idx].count++;
  }

  return buckets;
}
