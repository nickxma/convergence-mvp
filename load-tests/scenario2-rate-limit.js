/**
 * Scenario 2: Rate limit enforcement
 *
 * Single user IP, 25 requests in rapid succession.
 * Expected: first 20 succeed, requests 21–25 return 429.
 * Targets:
 *   - Requests 1–20: status 200
 *   - Requests 21–25: status 429
 *   - All 429 responses include Retry-After header
 *   - Zero 500 errors
 *
 * Uses a unique fake IP via x-forwarded-for to avoid polluting real rate limit counters.
 */
import { askQuestion, assert, BASE_URL } from './lib.js';

// Unique IP per run to start with a clean slate
const TEST_IP = `10.99.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;
const RATE_LIMIT = 20;
const TOTAL_REQUESTS = 25;
// Use a minimal question to keep requests fast (rate-limit check happens before OpenAI)
const QUESTION = 'hi';

console.log(`\n=== Scenario 2: Rate Limit Enforcement ===`);
console.log(`Target: ${BASE_URL}/api/ask`);
console.log(`Test IP: ${TEST_IP}`);
console.log(`Sending ${TOTAL_REQUESTS} sequential requests (rate limit: ${RATE_LIMIT}/hour)\n`);

const results = [];
for (let i = 0; i < TOTAL_REQUESTS; i++) {
  const r = await askQuestion(QUESTION, { ip: TEST_IP });
  results.push(r);
  const mark = i < RATE_LIMIT ? '✓' : '→429';
  console.log(`  Req ${String(i + 1).padStart(2)}: HTTP ${r.status} ${mark} latency=${r.latencyMs}ms${r.retryAfter ? ` Retry-After=${r.retryAfter}s` : ''}`);
}

const succeeded = results.filter((r) => r.status === 200);
const rateLimited = results.filter((r) => r.status === 429);
const serverErrors = results.filter((r) => r.status >= 500 || r.status === 0);
const retryAfterPresent = rateLimited.filter((r) => r.retryAfter != null);

// Check ordering: first RATE_LIMIT should be 200, rest 429
const first20 = results.slice(0, RATE_LIMIT);
const last5 = results.slice(RATE_LIMIT);
const first20AllOk = first20.every((r) => r.status === 200);
const last5All429 = last5.every((r) => r.status === 429);

console.log(`\nResults:`);
console.log(`  Succeeded (200): ${succeeded.length}  (expected: ${RATE_LIMIT})`);
console.log(`  Rate limited (429): ${rateLimited.length}  (expected: ${TOTAL_REQUESTS - RATE_LIMIT})`);
console.log(`  Server errors: ${serverErrors.length}  (expected: 0)`);
console.log(`  429 with Retry-After: ${retryAfterPresent.length}/${rateLimited.length}`);

console.log(`\nAssertions:`);
assert(serverErrors.length === 0, `No 5xx/network errors`);
assert(first20AllOk, `Requests 1–${RATE_LIMIT} all returned 200`, `Some of requests 1–${RATE_LIMIT} did NOT return 200`);
assert(last5All429, `Requests ${RATE_LIMIT + 1}–${TOTAL_REQUESTS} all returned 429`, `Some of requests ${RATE_LIMIT + 1}–${TOTAL_REQUESTS} did NOT return 429`);
assert(
  retryAfterPresent.length === rateLimited.length,
  `All ${rateLimited.length} rate-limit responses include Retry-After header`,
  `${rateLimited.length - retryAfterPresent.length} rate-limit responses missing Retry-After`
);
