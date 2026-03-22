/**
 * Unit tests for lib/feed-cache.ts (in-memory path; Redis path is tested via env var injection).
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

// No Redis env vars → exercises in-memory fallback path only
vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');

// Import after env stubs are set
const { getFeedCache, setFeedCache, invalidateFeedCache } = await import('../lib/feed-cache');

afterEach(async () => {
  // Clear all cached pages between tests
  await invalidateFeedCache();
  vi.useRealTimers();
});

describe('getFeedCache / setFeedCache', () => {
  it('returns null for an uncached page', async () => {
    expect(await getFeedCache(1)).toBeNull();
  });

  it('returns the cached value after set', async () => {
    const payload = { posts: [{ id: 1 }], page: 1, pageSize: 20, total: 1 };
    await setFeedCache(1, payload);
    expect(await getFeedCache(1)).toEqual(payload);
  });

  it('caches pages independently', async () => {
    const p1 = { posts: [], page: 1, pageSize: 20, total: 0 };
    const p2 = { posts: [], page: 2, pageSize: 20, total: 0 };
    await setFeedCache(1, p1);
    await setFeedCache(2, p2);
    expect(await getFeedCache(1)).toEqual(p1);
    expect(await getFeedCache(2)).toEqual(p2);
  });

  it('returns null after TTL expires', async () => {
    vi.useFakeTimers();
    const payload = { posts: [], page: 1, pageSize: 20, total: 0 };
    await setFeedCache(1, payload);
    expect(await getFeedCache(1)).toEqual(payload);

    // Advance past the 30-second TTL
    vi.advanceTimersByTime(31_000);
    expect(await getFeedCache(1)).toBeNull();
  });
});

describe('invalidateFeedCache', () => {
  it('clears all cached pages', async () => {
    await setFeedCache(1, { page: 1 });
    await setFeedCache(2, { page: 2 });
    await setFeedCache(3, { page: 3 });

    await invalidateFeedCache();

    expect(await getFeedCache(1)).toBeNull();
    expect(await getFeedCache(2)).toBeNull();
    expect(await getFeedCache(3)).toBeNull();
  });

  it('allows re-caching after invalidation', async () => {
    const payload = { posts: [], page: 1, pageSize: 20, total: 0 };
    await setFeedCache(1, payload);
    await invalidateFeedCache();
    await setFeedCache(1, payload);
    expect(await getFeedCache(1)).toEqual(payload);
  });
});
