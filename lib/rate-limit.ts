/**
 * In-memory sliding window rate limiter + duplicate content detector.
 *
 * NOTE: This works within a single Node.js process instance. On Vercel serverless
 * functions, state is not shared across concurrent invocations. For production
 * multi-instance rate limiting, replace the store with Upstash Redis or similar.
 */
import crypto from 'node:crypto';

interface RateLimitEntry {
  timestamps: number[];
}

const store = new Map<string, RateLimitEntry>();
const contentHashStore = new Map<string, number>(); // key → last-seen epoch ms

const HOUR_MS = 3_600_000;

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
