/**
 * Redis-backed answer cache for the non-streaming Q&A path.
 *
 * Cache key: SHA-256(normalised_query | chunk_fp_1 | chunk_fp_2 | chunk_fp_3)
 * where each chunk fingerprint is derived from the chunk's source file and the
 * first 100 characters of its text, making the key stable across re-runs that
 * return the same top-3 chunks.
 *
 * TTL: 1 hour.  Fails gracefully — returns null / no-ops when Redis is
 * unavailable.  Only applied to non-streaming requests; callers are responsible
 * for skipping the cache on streaming responses.
 */

import { createHash } from 'node:crypto';

const TTL_SECONDS = 60 * 60; // 1 hour
const KEY_PREFIX = 'qa:answer:v1:';

export interface CachedQaAnswer {
  answer: string;
  followUps: string[];
  chunks: Array<{ text: string; speaker: string; source: string; score: number; chunkId?: string; sourceUrl?: string }>;
}

function redisConfig(): { url: string; token: string } | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return { url, token };
}

/**
 * Derive a stable cache key from the normalised question and the top-3 retrieved
 * chunks. Using both components ensures cached answers are only reused when the
 * query intent AND the supporting context are the same.
 */
export function buildAnswerCacheKey(
  question: string,
  chunks: Array<{ text: string; source: string }>,
): string {
  const normalised = question.toLowerCase().trim();
  const fps = chunks.slice(0, 3).map((c) =>
    createHash('sha256')
      .update(`${c.source}:${c.text.slice(0, 100)}`)
      .digest('hex')
      .slice(0, 16),
  );
  return createHash('sha256')
    .update(`${normalised}|${fps.join('|')}`)
    .digest('hex');
}

/** Fetch a cached answer from Redis. Returns null on miss or any error. */
export async function getAnswerCache(key: string): Promise<CachedQaAnswer | null> {
  const redis = redisConfig();
  if (!redis) return null;
  try {
    const res = await fetch(
      `${redis.url}/get/${encodeURIComponent(`${KEY_PREFIX}${key}`)}`,
      { headers: { Authorization: `Bearer ${redis.token}` } },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as { result: string | null };
    if (!json.result) return null;
    return JSON.parse(json.result) as CachedQaAnswer;
  } catch {
    return null;
  }
}

/** Write an answer to the Redis cache. Fire-and-forget — errors are suppressed. */
export async function setAnswerCache(key: string, value: CachedQaAnswer): Promise<void> {
  const redis = redisConfig();
  if (!redis) return;
  try {
    await fetch(
      `${redis.url}/set/${encodeURIComponent(`${KEY_PREFIX}${key}`)}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${redis.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ value: JSON.stringify(value), ex: TTL_SECONDS }),
      },
    );
  } catch {
    // Non-fatal
  }
}
