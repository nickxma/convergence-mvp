/**
 * Scenario 1: Cache warm-up
 *
 * 50 requests, all asking the same question.
 * Expected: first request hits OpenAI (cache miss), all subsequent serve from cache.
 * Targets:
 *   - >95% cache hit rate after first request
 *   - p99 latency < 200ms after warm-up (cached requests only)
 */
import { askQuestion, stats, assert, BASE_URL } from './lib.js';

const QUESTION = 'What is the relationship between mindfulness and ego dissolution?';
const TOTAL_REQUESTS = 50;
const CACHE_HIT_TARGET = 0.95; // 95%
const CACHED_P99_TARGET_MS = 200;

console.log(`\n=== Scenario 1: Cache Warm-up ===`);
console.log(`Target: ${BASE_URL}/api/ask`);
console.log(`Question: "${QUESTION}"`);
console.log(`Requests: ${TOTAL_REQUESTS} (same question)\n`);

// Step 1: warm-up request (sequential to ensure cache is populated before concurrent burst)
console.log('Sending warm-up request...');
const warmup = await askQuestion(QUESTION, { ip: '10.0.1.1' });
if (warmup.status === 0 || warmup.status >= 500) {
  console.error(`Warm-up failed: status=${warmup.status} error=${warmup.error}`);
  process.exit(1);
}
console.log(`  Warm-up: status=${warmup.status} cached=${warmup.cached} latency=${warmup.latencyMs}ms`);

// Brief wait for fire-and-forget cache write to commit to Supabase before burst
await new Promise((r) => setTimeout(r, 600));

// Step 2: concurrent burst — remaining 49 requests (all should cache-hit now)
// Each VU uses a unique IP to prevent rate-limit collisions (50 VUs × 1 IP = rate-limited after 20)
console.log(`\nSending ${TOTAL_REQUESTS - 1} concurrent requests (unique IPs per VU)...`);
const results = await Promise.all(
  Array.from({ length: TOTAL_REQUESTS - 1 }, (_, i) =>
    askQuestion(QUESTION, { ip: `10.0.1.${2 + i}` })
  )
);

const allResults = [warmup, ...results];
const successful = allResults.filter((r) => r.status === 200);
const cached = successful.filter((r) => r.cached);
const errors = allResults.filter((r) => r.status === 0 || r.status >= 500);

const cacheHitRate = cached.length / (successful.length - 1); // exclude warm-up from ratio
const cachedLatencies = cached.map((r) => r.latencyMs);
const cachedStats = stats(cachedLatencies.length > 0 ? cachedLatencies : [0]);

console.log(`\nResults:`);
console.log(`  Total requests:  ${allResults.length}`);
console.log(`  Successful (2xx): ${successful.length}`);
console.log(`  Cache hits:       ${cached.length} (excl. warm-up: ${cached.length}/${successful.length - 1})`);
console.log(`  Errors (5xx/net): ${errors.length}`);
console.log(`  Cache hit rate:   ${(cacheHitRate * 100).toFixed(1)}% (target: >${CACHE_HIT_TARGET * 100}%)`);
console.log(`\nCached request latency:`);
console.log(`  min=${cachedStats.min}ms  mean=${cachedStats.mean}ms  p50=${cachedStats.p50}ms  p95=${cachedStats.p95}ms  p99=${cachedStats.p99}ms`);
console.log(`  (warm-up: ${warmup.latencyMs}ms — expected slow, hits OpenAI)`);

console.log(`\nAssertions:`);
assert(errors.length === 0, `No 5xx errors (got ${errors.length})`, `${errors.length} server errors`);
assert(
  cacheHitRate >= CACHE_HIT_TARGET,
  `Cache hit rate ${(cacheHitRate * 100).toFixed(1)}% >= ${CACHE_HIT_TARGET * 100}%`,
  `Cache hit rate ${(cacheHitRate * 100).toFixed(1)}% < ${CACHE_HIT_TARGET * 100}% TARGET MISSED`
);
assert(
  cachedStats.p99 < CACHED_P99_TARGET_MS,
  `Cached p99 ${cachedStats.p99}ms < ${CACHED_P99_TARGET_MS}ms`,
  `Cached p99 ${cachedStats.p99}ms >= ${CACHED_P99_TARGET_MS}ms TARGET MISSED`
);
