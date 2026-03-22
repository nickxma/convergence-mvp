/**
 * Scenario 4: Community feed under load
 *
 * 100 concurrent GET requests to /api/community/posts.
 * Expected: fast response from Supabase with indexes.
 * Targets:
 *   - p99 latency < 300ms
 *   - 0 server errors
 */
import { stats, assert, BASE_URL } from './lib.js';

const CONCURRENCY = 100;
const P99_TARGET_MS = 300;
const ENDPOINT = `${BASE_URL}/api/community/posts`;

console.log(`\n=== Scenario 4: Community Feed Under Load ===`);
console.log(`Target: ${ENDPOINT}`);
console.log(`Concurrency: ${CONCURRENCY} simultaneous GET requests\n`);

async function fetchPosts() {
  const t0 = Date.now();
  try {
    const res = await fetch(ENDPOINT, { method: 'GET', headers: { Accept: 'application/json' } });
    const latencyMs = Date.now() - t0;
    return { status: res.status, latencyMs, error: null };
  } catch (err) {
    return { status: 0, latencyMs: Date.now() - t0, error: err.message };
  }
}

const results = await Promise.all(Array.from({ length: CONCURRENCY }, () => fetchPosts()));

const successful = results.filter((r) => r.status === 200);
const serverErrors = results.filter((r) => r.status >= 500 || r.status === 0);
const otherErrors = results.filter((r) => r.status > 0 && r.status < 500 && r.status !== 200);
const latencies = successful.map((r) => r.latencyMs);
const latencyStats = latencies.length > 0 ? stats(latencies) : null;

console.log(`Results:`);
console.log(`  Successful (200): ${successful.length}/${CONCURRENCY}`);
console.log(`  Server errors (5xx/net): ${serverErrors.length}`);
console.log(`  Other (4xx): ${otherErrors.length}${otherErrors.length > 0 ? ` [statuses: ${[...new Set(otherErrors.map((r) => r.status))].join(',')}]` : ''}`);

if (successful.length === 0) {
  console.error(`\n  WARN: No successful responses. Is the server running and /api/community/posts accessible?`);
  console.error(`  Check BASE_URL=${BASE_URL} and ensure the server has this route compiled.`);
  process.exitCode = 1;
} else {
  console.log(`\nLatency (successful requests):`);
  console.log(`  min=${latencyStats.min}ms  mean=${latencyStats.mean}ms  p50=${latencyStats.p50}ms  p95=${latencyStats.p95}ms  p99=${latencyStats.p99}ms`);
}

console.log(`\nAssertions:`);
assert(serverErrors.length === 0, `No 5xx/network errors`);
if (latencyStats) {
  assert(
    latencyStats.p99 < P99_TARGET_MS,
    `p99 latency ${latencyStats.p99}ms < ${P99_TARGET_MS}ms`,
    `p99 latency ${latencyStats.p99}ms >= ${P99_TARGET_MS}ms TARGET MISSED`
  );
}
