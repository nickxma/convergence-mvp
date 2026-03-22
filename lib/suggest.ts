/** Pure helpers for the /api/questions/suggest endpoint. */

export const MIN_QUERY_LENGTH = 3;
export const MAX_RESULTS = 5;

export interface Suggestion {
  question: string;
  count: number;
}

/** Aggregate question rows into frequency-ranked suggestions. */
export function aggregateSuggestions(
  rows: { question: string }[],
  maxResults = MAX_RESULTS,
): Suggestion[] {
  const freq = new Map<string, number>();
  for (const row of rows) {
    const key = row.question.trim();
    freq.set(key, (freq.get(key) ?? 0) + 1);
  }
  return Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxResults)
    .map(([question, count]) => ({ question, count }));
}
