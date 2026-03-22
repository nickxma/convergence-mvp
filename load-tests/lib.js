/**
 * Shared utilities for load tests.
 */

export const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';

/**
 * Single POST to /api/ask.
 * Returns { status, latencyMs, cached, error }
 */
export async function askQuestion(question, { ip = null, streamFalse = true } = {}) {
  const url = streamFalse ? `${BASE_URL}/api/ask?stream=false` : `${BASE_URL}/api/ask`;
  const headers = { 'Content-Type': 'application/json' };
  if (ip) headers['x-forwarded-for'] = ip;

  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ question }),
    });
    const latencyMs = Date.now() - t0;
    const retryAfter = res.headers.get('retry-after');
    if (!res.ok) {
      return { status: res.status, latencyMs, cached: false, retryAfter, error: null };
    }
    const body = await res.json();
    return { status: res.status, latencyMs, cached: !!body.cached, error: null };
  } catch (err) {
    return { status: 0, latencyMs: Date.now() - t0, cached: false, error: err.message };
  }
}

/** Run n concurrent requests; return array of results. */
export async function concurrentRequests(fn, n) {
  return Promise.all(Array.from({ length: n }, () => fn()));
}

/** Percentile from a sorted array of numbers. */
export function percentile(sorted, p) {
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

export function stats(latencies) {
  const sorted = [...latencies].sort((a, b) => a - b);
  return {
    count: sorted.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    mean: Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length),
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
  };
}

export function pass(label) { console.log(`  ✓ ${label}`); }
export function fail(label) { console.error(`  ✗ ${label}`); process.exitCode = 1; }
export function assert(cond, passLabel, failLabel) {
  cond ? pass(passLabel) : fail(failLabel ?? passLabel);
}
