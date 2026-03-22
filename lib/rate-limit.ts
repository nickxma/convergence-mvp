/**
 * Sliding window rate limiter + duplicate content detector.
 *
 * Primary store: Upstash Redis (when UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN are set).
 * Fallback store: in-memory (single Node.js process — not shared across Vercel invocations).
 */
import crypto from 'node:crypto';

export const MINUTE_MS = 60_000;

interface RateLimitEntry {
  timestamps: number[];
}

const store = new Map<string, RateLimitEntry>();
const contentHashStore = new Map<string, number>(); // key → last-seen epoch ms

const HOUR_MS = 3_600_000;

/**
 * Extract the best available client IP from request headers.
 * Works with NextRequest and any object that exposes a `headers.get()` method.
 */
export function getClientIp(req: { headers: { get(name: string): string | null } }): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.headers.get('x-real-ip') ?? 'unknown';
}

/**
 * Returns true when the request carries a valid internal bypass token.
 * Set INTERNAL_API_TOKEN in the environment and pass `X-Internal-Token: <token>`
 * to skip rate limiting on agent/internal calls.
 */
export function isInternalRequest(req: { headers: { get(name: string): string | null } }): boolean {
  const expected = process.env.INTERNAL_API_TOKEN;
  if (!expected) return false;
  const provided = req.headers.get('x-internal-token');
  return provided === expected;
}

// Prune expired entries every 5 minutes to prevent unbounded memory growth
setInterval(() => {
  const cutoff = Date.now() - HOUR_MS;
  for (const [key, entry] of store.entries()) {
    entry.timestamps = entry.timestamps.filter((t) => t > cutoff);
    if (entry.timestamps.length === 0) store.delete(key);
  }
  for (const [key, ts] of contentHashStore.entries()) {
    if (ts <= cutoff) contentHashStore.delete(key);
  }
}, 5 * 60 * 1000).unref();

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number; // epoch ms when the oldest token expires
}

export interface RateLimitError {
  status: 429;
  retryAfterSec: number;
  error: { code: 'RATE_LIMIT_EXCEEDED'; message: string };
}

export interface RateLimitResultExtended extends RateLimitResult {
  store: 'redis' | 'memory';
}

async function tryRedisRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitResultExtended | null> {
  const restUrl = process.env.UPSTASH_REDIS_REST_URL;
  const restToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!restUrl || !restToken) return null;

  const windowSec = Math.ceil(windowMs / 1000);
  const redisKey = `rl:${key}`;

  try {
    // Pipeline: INCR + EXPIRE NX (set TTL only if none exists — requires Redis 7+)
    const pipeRes = await fetch(`${restUrl}/pipeline`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${restToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([
        ['INCR', redisKey],
        ['EXPIRE', redisKey, windowSec, 'NX'],
      ]),
    });

    if (!pipeRes.ok) {
      console.warn(`[rate-limit] redis_error status=${pipeRes.status}`);
      return null;
    }

    const results = (await pipeRes.json()) as Array<{ result: number }>;
    const count = results[0]?.result ?? limit + 1;
    const resetAt = Date.now() + windowMs;

    if (count > limit) {
      return { allowed: false, remaining: 0, resetAt, store: 'redis' };
    }
    return { allowed: true, remaining: limit - count, resetAt, store: 'redis' };
  } catch (err) {
    console.warn(`[rate-limit] redis_fallback err=${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/**
 * Rate limit check that prefers Upstash Redis when configured,
 * falling back to in-memory on errors or when Redis env vars are absent.
 */
export async function checkRateLimitWithFallback(
  key: string,
  limit: number,
  windowMs = HOUR_MS,
): Promise<RateLimitResultExtended> {
  const redisResult = await tryRedisRateLimit(key, limit, windowMs);
  if (redisResult !== null) return redisResult;
  return { ...checkRateLimit(key, limit, windowMs), store: 'memory' };
}

/**
 * Build the 429 response payload for a rate-limited request.
 * Returns a plain object so callers can construct framework-specific responses.
 */
export function buildRateLimitError(resetAt: number, message: string): RateLimitError {
  return {
    status: 429,
    retryAfterSec: Math.max(1, Math.ceil((resetAt - Date.now()) / 1000)),
    error: { code: 'RATE_LIMIT_EXCEEDED', message },
  };
}

/**
 * Sliding-window rate limiter.
 * @param key      Unique key (e.g. `community:post:<walletAddress>`)
 * @param limit    Max calls allowed per window
 * @param windowMs Window size in ms (default: 1 hour)
 */
export function checkRateLimit(
  key: string,
  limit: number,
  windowMs = HOUR_MS,
): RateLimitResult {
  const now = Date.now();

  let entry = store.get(key);
  if (!entry) {
    entry = { timestamps: [] };
    store.set(key, entry);
  }

  // Drop timestamps outside the rolling window
  entry.timestamps = entry.timestamps.filter((t) => now - t < windowMs);

  const resetAt = (entry.timestamps[0] ?? now) + windowMs;

  if (entry.timestamps.length >= limit) {
    return { allowed: false, remaining: 0, resetAt };
  }

  entry.timestamps.push(now);
  return { allowed: true, remaining: limit - entry.timestamps.length, resetAt };
}

/**
 * Check if content is a duplicate submission within the dedup window.
 * Uses SHA-256 hash of the content, scoped to the wallet address.
 *
 * @param walletAddress Wallet submitting the content
 * @param content       Post/reply body to check
 * @param windowMs      How long to remember a hash (default: 1 hour)
 * @returns true if the content is a duplicate (should be rejected)
 */
export function isDuplicateContent(
  walletAddress: string,
  content: string,
  windowMs = HOUR_MS,
): boolean {
  const hash = crypto.createHash('sha256').update(content).digest('hex');
  const dedupKey = `dedup:${walletAddress}:${hash}`;
  const now = Date.now();

  const lastSeen = contentHashStore.get(dedupKey);
  if (lastSeen !== undefined && now - lastSeen < windowMs) {
    return true;
  }

  contentHashStore.set(dedupKey, now);
  return false;
}
