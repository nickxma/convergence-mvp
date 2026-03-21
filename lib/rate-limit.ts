/**
 * In-memory sliding window rate limiter.
 *
 * NOTE: This works within a single Node.js process instance. On Vercel serverless
 * functions, state is not shared across concurrent invocations. For production
 * multi-instance rate limiting, replace the store with Upstash Redis or similar.
 */

interface RateLimitEntry {
  timestamps: number[];
}

const store = new Map<string, RateLimitEntry>();

// Prune expired entries every 5 minutes to prevent unbounded memory growth
setInterval(() => {
  const cutoff = Date.now() - 60_000;
  for (const [key, entry] of store.entries()) {
    entry.timestamps = entry.timestamps.filter((t) => t > cutoff);
    if (entry.timestamps.length === 0) store.delete(key);
  }
}, 5 * 60 * 1000).unref();

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number; // epoch ms when the oldest token expires
}

export function checkRateLimit(key: string, limitPerMinute: number): RateLimitResult {
  const now = Date.now();
  const windowMs = 60_000;

  let entry = store.get(key);
  if (!entry) {
    entry = { timestamps: [] };
    store.set(key, entry);
  }

  // Drop timestamps outside the rolling 1-minute window
  entry.timestamps = entry.timestamps.filter((t) => now - t < windowMs);

  const resetAt = (entry.timestamps[0] ?? now) + windowMs;

  if (entry.timestamps.length >= limitPerMinute) {
    return { allowed: false, remaining: 0, resetAt };
  }

  entry.timestamps.push(now);
  return { allowed: true, remaining: limitPerMinute - entry.timestamps.length, resetAt };
}
