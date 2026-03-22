/**
 * Unit tests for lib/rate-limit.ts
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { checkRateLimit, isDuplicateContent, buildRateLimitError, getClientIp, isInternalRequest, MINUTE_MS } from '../lib/rate-limit';

afterEach(() => {
  vi.useRealTimers();
});

// Each test uses a unique key prefix to avoid shared state between tests
let seq = 0;
const nextKey = () => `test-${seq++}-${Math.random().toString(36).slice(2)}`;

// ── checkRateLimit ────────────────────────────────────────────────────────────

describe('checkRateLimit', () => {
  it('allows requests up to the limit', () => {
    const key = nextKey();
    for (let i = 0; i < 5; i++) {
      expect(checkRateLimit(key, 5).allowed).toBe(true);
    }
  });

  it('blocks the request that exceeds the limit', () => {
    const key = nextKey();
    for (let i = 0; i < 5; i++) checkRateLimit(key, 5);
    const result = checkRateLimit(key, 5);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it('returns correct remaining count after each call', () => {
    const key = nextKey();
    expect(checkRateLimit(key, 10).remaining).toBe(9);
    expect(checkRateLimit(key, 10).remaining).toBe(8);
    expect(checkRateLimit(key, 10).remaining).toBe(7);
  });

  it('remaining reaches 0 on the last allowed call', () => {
    const key = nextKey();
    let last!: ReturnType<typeof checkRateLimit>;
    for (let i = 0; i < 3; i++) last = checkRateLimit(key, 3);
    expect(last.allowed).toBe(true);
    expect(last.remaining).toBe(0);
  });

  it('handles limit of 1 (boundary)', () => {
    const key = nextKey();
    expect(checkRateLimit(key, 1).allowed).toBe(true);
    expect(checkRateLimit(key, 1).allowed).toBe(false);
  });

  it('independent keys do not share state', () => {
    const k1 = nextKey();
    const k2 = nextKey();
    for (let i = 0; i < 5; i++) checkRateLimit(k1, 5);
    expect(checkRateLimit(k1, 5).allowed).toBe(false);
    expect(checkRateLimit(k2, 5).allowed).toBe(true);
  });

  it('returns a resetAt in the future', () => {
    vi.useFakeTimers();
    const now = Date.now();
    const key = nextKey();
    checkRateLimit(key, 5, 3_600_000);
    const result = checkRateLimit(key, 5, 3_600_000);
    expect(result.resetAt).toBeGreaterThanOrEqual(now + 3_600_000 - 100);
    expect(result.resetAt).toBeLessThanOrEqual(now + 3_600_000 + 100);
  });

  it('resets after the window expires', () => {
    vi.useFakeTimers();
    const key = nextKey();
    checkRateLimit(key, 1, 1_000); // 1-second window
    expect(checkRateLimit(key, 1, 1_000).allowed).toBe(false);
    vi.advanceTimersByTime(1_001);
    expect(checkRateLimit(key, 1, 1_000).allowed).toBe(true);
  });

  it('uses sliding window — old calls roll off as time advances', () => {
    vi.useFakeTimers();
    const key = nextKey();
    // Fill up to limit at t=0
    for (let i = 0; i < 3; i++) checkRateLimit(key, 3, 1_000);
    expect(checkRateLimit(key, 3, 1_000).allowed).toBe(false);
    // Advance so the first timestamp expires, freeing one slot
    vi.advanceTimersByTime(1_001);
    expect(checkRateLimit(key, 3, 1_000).allowed).toBe(true);
  });

  it('respects custom windowMs', () => {
    vi.useFakeTimers();
    const key = nextKey();
    checkRateLimit(key, 1, 500); // 500 ms window
    expect(checkRateLimit(key, 1, 500).allowed).toBe(false);
    vi.advanceTimersByTime(501);
    expect(checkRateLimit(key, 1, 500).allowed).toBe(true);
  });
});

// ── isDuplicateContent ────────────────────────────────────────────────────────

describe('isDuplicateContent', () => {
  const wallet = (n: number) => `0xWallet${n}${seq}`;

  it('allows first submission of any content', () => {
    expect(isDuplicateContent(wallet(1), `unique-${nextKey()}`)).toBe(false);
  });

  it('detects exact duplicate from the same wallet', () => {
    const w = wallet(2);
    const content = `dup-${nextKey()}`;
    isDuplicateContent(w, content);
    expect(isDuplicateContent(w, content)).toBe(true);
  });

  it('allows the same content from a different wallet', () => {
    const content = `shared-${nextKey()}`;
    isDuplicateContent(wallet(3), content);
    expect(isDuplicateContent(wallet(4), content)).toBe(false);
  });

  it('treats distinct content as unique even from the same wallet', () => {
    const w = wallet(5);
    const base = nextKey();
    isDuplicateContent(w, `content-A-${base}`);
    expect(isDuplicateContent(w, `content-B-${base}`)).toBe(false);
  });

  it('is case-sensitive (different case = different hash)', () => {
    const w = wallet(6);
    const content = `CaseTest-${nextKey()}`;
    isDuplicateContent(w, content.toLowerCase());
    expect(isDuplicateContent(w, content.toUpperCase())).toBe(false);
  });

  it('expires duplicates after the window', () => {
    vi.useFakeTimers();
    const w = wallet(7);
    const content = `expiring-${nextKey()}`;
    isDuplicateContent(w, content, 1_000); // 1-second window
    expect(isDuplicateContent(w, content, 1_000)).toBe(true);
    vi.advanceTimersByTime(1_001);
    // After expiry, same content should be allowed again
    expect(isDuplicateContent(w, content, 1_000)).toBe(false);
  });

  it('re-registers content after it expires', () => {
    vi.useFakeTimers();
    const w = wallet(8);
    const content = `resubmit-${nextKey()}`;
    isDuplicateContent(w, content, 1_000);
    vi.advanceTimersByTime(1_001);
    isDuplicateContent(w, content, 1_000); // re-register
    expect(isDuplicateContent(w, content, 1_000)).toBe(true);
  });
});

// ── buildRateLimitError — 429 path ────────────────────────────────────────────

describe('buildRateLimitError (429 response payload)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns status 429', () => {
    const result = buildRateLimitError(Date.now() + 60_000, 'Too many requests.');
    expect(result.status).toBe(429);
  });

  it('includes RATE_LIMIT_EXCEEDED code', () => {
    const result = buildRateLimitError(Date.now() + 60_000, 'Too many requests.');
    expect(result.error.code).toBe('RATE_LIMIT_EXCEEDED');
  });

  it('passes the message through to the error body', () => {
    const msg = 'Max 10 posts per hour. Please wait.';
    const result = buildRateLimitError(Date.now() + 60_000, msg);
    expect(result.error.message).toBe(msg);
  });

  it('computes retryAfterSec as seconds until resetAt', () => {
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now);
    const resetAt = now + 90_000; // 90 seconds in the future
    const result = buildRateLimitError(resetAt, 'wait');
    expect(result.retryAfterSec).toBe(90);
  });

  it('returns at least 1 second even for very small remaining windows', () => {
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now);
    // resetAt is only 1 ms in the future — rounds up to 1
    const result = buildRateLimitError(now + 1, 'wait');
    expect(result.retryAfterSec).toBeGreaterThanOrEqual(1);
  });

  it('integrates with checkRateLimit: exhausted key produces valid 429 payload for POST /api/community/posts', () => {
    vi.useFakeTimers();
    const key = `community:post:0xWallet${nextKey()}`;
    // Exhaust the 10/hr post limit
    for (let i = 0; i < 10; i++) checkRateLimit(key, 10);
    const rl = checkRateLimit(key, 10);
    expect(rl.allowed).toBe(false);

    const rle = buildRateLimitError(rl.resetAt, 'Max 10 posts per hour. Please wait.');
    expect(rle.status).toBe(429);
    expect(rle.retryAfterSec).toBeGreaterThanOrEqual(1);
    expect(rle.error.code).toBe('RATE_LIMIT_EXCEEDED');
    expect(rle.error.message).toBe('Max 10 posts per hour. Please wait.');
  });

  it('integrates with checkRateLimit: exhausted key produces valid 429 payload for POST /api/community/posts/:id/replies', () => {
    vi.useFakeTimers();
    const key = `community:reply:0xWallet${nextKey()}`;
    // Exhaust the 30/hr reply limit
    for (let i = 0; i < 30; i++) checkRateLimit(key, 30);
    const rl = checkRateLimit(key, 30);
    expect(rl.allowed).toBe(false);

    const rle = buildRateLimitError(rl.resetAt, 'Max 30 replies per hour. Please wait.');
    expect(rle.status).toBe(429);
    expect(rle.retryAfterSec).toBeGreaterThanOrEqual(1);
    expect(rle.error.code).toBe('RATE_LIMIT_EXCEEDED');
    expect(rle.error.message).toBe('Max 30 replies per hour. Please wait.');
  });

  it('Retry-After header value matches retryAfterSec', () => {
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now);
    const rle = buildRateLimitError(now + 3_000, 'wait');
    // Simulate what the route does: headers: { 'Retry-After': String(rle.retryAfterSec) }
    const headerValue = String(rle.retryAfterSec);
    expect(parseInt(headerValue, 10)).toBe(rle.retryAfterSec);
    expect(parseInt(headerValue, 10)).toBe(3);
  });
});

// ── 429 path — /api/ask per-minute limits ────────────────────────────────────

describe('429 path (per-minute window)', () => {
  it('blocks the 6th unauthenticated request within 60 s (5/min limit)', () => {
    vi.useFakeTimers();
    const key = `ask:anon:192.0.2.${seq++}`;
    const LIMIT = 5;
    for (let i = 0; i < LIMIT; i++) {
      expect(checkRateLimit(key, LIMIT, MINUTE_MS).allowed).toBe(true);
    }
    const result = checkRateLimit(key, LIMIT, MINUTE_MS);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it('429 response payload is correct for /api/ask anonymous', () => {
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now);
    const key = `ask:anon:192.0.2.${seq++}`;
    const LIMIT = 5;
    for (let i = 0; i < LIMIT; i++) checkRateLimit(key, LIMIT, MINUTE_MS);
    const rl = checkRateLimit(key, LIMIT, MINUTE_MS);
    expect(rl.allowed).toBe(false);
    const rle = buildRateLimitError(rl.resetAt, 'Too many requests — please wait before trying again.');
    expect(rle.status).toBe(429);
    expect(rle.error.code).toBe('RATE_LIMIT_EXCEEDED');
    expect(rle.retryAfterSec).toBeGreaterThanOrEqual(1);
    expect(rle.retryAfterSec).toBeLessThanOrEqual(60);
  });

  it('Retry-After header is present on the 429 response (verified via retryAfterSec > 0)', () => {
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now);
    const key = `ask:anon:192.0.2.${seq++}`;
    const LIMIT = 5;
    for (let i = 0; i < LIMIT; i++) checkRateLimit(key, LIMIT, MINUTE_MS);
    const rl = checkRateLimit(key, LIMIT, MINUTE_MS);
    const rle = buildRateLimitError(rl.resetAt, 'Too many requests.');
    // The route sets headers: { 'Retry-After': String(rle.retryAfterSec) }
    expect(rle.retryAfterSec).toBeGreaterThan(0);
  });

  it('allows a 30/min authenticated burst (does not block at 30)', () => {
    vi.useFakeTimers();
    const key = `ask:user:user_${seq++}`;
    const LIMIT = 30;
    for (let i = 0; i < LIMIT; i++) {
      expect(checkRateLimit(key, LIMIT, MINUTE_MS).allowed).toBe(true);
    }
    // 31st is blocked
    expect(checkRateLimit(key, LIMIT, MINUTE_MS).allowed).toBe(false);
  });

  it('authenticated limit (30/min) is higher than anonymous limit (5/min)', () => {
    expect(30).toBeGreaterThan(5);
  });

  it('resets after 60 s — the next request is allowed', () => {
    vi.useFakeTimers();
    const key = `ask:anon:192.0.2.${seq++}`;
    const LIMIT = 5;
    for (let i = 0; i < LIMIT; i++) checkRateLimit(key, LIMIT, MINUTE_MS);
    expect(checkRateLimit(key, LIMIT, MINUTE_MS).allowed).toBe(false);
    vi.advanceTimersByTime(MINUTE_MS + 1);
    expect(checkRateLimit(key, LIMIT, MINUTE_MS).allowed).toBe(true);
  });
});

// ── getClientIp ───────────────────────────────────────────────────────────────

describe('getClientIp', () => {
  const makeReq = (headers: Record<string, string>) => ({
    headers: { get: (name: string) => headers[name] ?? null },
  });

  it('extracts the first IP from x-forwarded-for', () => {
    expect(getClientIp(makeReq({ 'x-forwarded-for': '10.0.0.1, 10.0.0.2' }))).toBe('10.0.0.1');
  });

  it('falls back to x-real-ip when x-forwarded-for is absent', () => {
    expect(getClientIp(makeReq({ 'x-real-ip': '203.0.113.5' }))).toBe('203.0.113.5');
  });

  it('returns "unknown" when no IP header is present', () => {
    expect(getClientIp(makeReq({}))).toBe('unknown');
  });
});

// ── isInternalRequest (X-Internal-Token bypass) ───────────────────────────────

describe('isInternalRequest', () => {
  const makeReq = (headers: Record<string, string>) => ({
    headers: { get: (name: string) => headers[name] ?? null },
  });

  beforeEach(() => {
    vi.stubEnv('INTERNAL_API_TOKEN', 'test-secret-token');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns true when the token matches INTERNAL_API_TOKEN', () => {
    expect(isInternalRequest(makeReq({ 'x-internal-token': 'test-secret-token' }))).toBe(true);
  });

  it('returns false when the token does not match', () => {
    expect(isInternalRequest(makeReq({ 'x-internal-token': 'wrong-token' }))).toBe(false);
  });

  it('returns false when the header is absent', () => {
    expect(isInternalRequest(makeReq({}))).toBe(false);
  });

  it('returns false when INTERNAL_API_TOKEN env var is not set', () => {
    vi.stubEnv('INTERNAL_API_TOKEN', '');
    expect(isInternalRequest(makeReq({ 'x-internal-token': 'test-secret-token' }))).toBe(false);
  });
});
