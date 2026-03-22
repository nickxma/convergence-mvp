/**
 * Scenario 3: Concurrent unique questions (worst case)
 *
 * 10 VUs each ask a unique question (no cache benefit), staggered across 60s.
 * Expected: all return valid answers, no errors.
 * Targets:
 *   - p95 latency < 8000ms
 *   - 0 server errors (5xx)
 *
 * Note: Each "VU" asks one unique question. The 10 are sent concurrently.
 * In a full 60s run this would be repeated in waves; here we do one 10-way concurrent burst
 * to validate the concurrency behavior without hammering OpenAI excessively.
 */
import { askQuestion, stats, assert, BASE_URL } from './lib.js';

const P95_TARGET_MS = 8000;

const UNIQUE_QUESTIONS = [
  'How does focused attention differ from open awareness during meditation?',
  'What is the relationship between anxiety and the sense of self?',
  'How can one practice mindfulness in everyday conversations?',
  'What role does breath awareness play in non-dual practice?',
  'How does the concept of impermanence relate to emotional suffering?',
  'What is the difference between concentration and insight meditation?',
  'How does mindfulness affect the default mode network in the brain?',
  'What is meant by the witness consciousness in contemplative traditions?',
  'How can one work with difficult emotions through mindful inquiry?',
  'What is the relationship between loving-kindness practice and insight?',
];

console.log(`\n=== Scenario 3: Concurrent Unique Questions ===`);
console.log(`Target: ${BASE_URL}/api/ask`);
console.log(`Concurrency: ${UNIQUE_QUESTIONS.length} simultaneous requests (unique questions)\n`);

// Each VU gets a distinct IP to avoid rate limit interference
const results = await Promise.all(
  UNIQUE_QUESTIONS.map((q, i) => askQuestion(q, { ip: `10.0.3.${i + 1}` }))
);

const successful = results.filter((r) => r.status === 200);
const serverErrors = results.filter((r) => r.status >= 500 || r.status === 0);
const rateLimited = results.filter((r) => r.status === 429);
const latencies = successful.map((r) => r.latencyMs);
const latencyStats = latencies.length > 0 ? stats(latencies) : null;

console.log('Results per VU:');
results.forEach((r, i) => {
  const q = UNIQUE_QUESTIONS[i].slice(0, 60);
  console.log(`  VU${i + 1}: HTTP ${r.status} cached=${r.cached} latency=${r.latencyMs}ms  "${q}..."`);
});

console.log(`\nSummary:`);
console.log(`  Successful: ${successful.length}/${results.length}`);
console.log(`  Server errors: ${serverErrors.length}`);
console.log(`  Rate limited: ${rateLimited.length}`);
if (latencyStats) {
  console.log(`  Latency: min=${latencyStats.min}ms  mean=${latencyStats.mean}ms  p95=${latencyStats.p95}ms  p99=${latencyStats.p99}ms  max=${latencyStats.max}ms`);
}

console.log(`\nAssertions:`);
assert(serverErrors.length === 0, `No 5xx/network errors`, `${serverErrors.length} server errors`);
assert(rateLimited.length === 0, `No rate limit hits (each VU uses unique IP)`, `${rateLimited.length} unexpected 429s`);
if (latencyStats) {
  assert(
    latencyStats.p95 < P95_TARGET_MS,
    `p95 latency ${latencyStats.p95}ms < ${P95_TARGET_MS}ms`,
    `p95 latency ${latencyStats.p95}ms >= ${P95_TARGET_MS}ms TARGET MISSED`
  );
}
