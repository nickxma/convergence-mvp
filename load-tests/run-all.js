/**
 * Run all load test scenarios sequentially.
 *
 * Usage:
 *   node load-tests/run-all.js
 *   BASE_URL=http://localhost:3000 node load-tests/run-all.js
 *
 * Individual scenarios:
 *   node load-tests/scenario1-cache-warmup.js
 *   node load-tests/scenario2-rate-limit.js
 *   node load-tests/scenario3-concurrent-unique.js
 *   node load-tests/scenario4-community-feed.js
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const scenarios = [
  'scenario1-cache-warmup.js',
  'scenario2-rate-limit.js',
  'scenario3-concurrent-unique.js',
  'scenario4-community-feed.js',
];

let allPassed = true;

for (const scenario of scenarios) {
  const scriptPath = join(__dirname, scenario);
  console.log(`\n${'─'.repeat(60)}`);
  const result = spawnSync(process.execPath, ['--experimental-vm-modules', scriptPath], {
    stdio: 'inherit',
    env: { ...process.env },
  });
  if (result.status !== 0) allPassed = false;
}

console.log(`\n${'═'.repeat(60)}`);
console.log(allPassed ? '✓ All scenarios passed' : '✗ One or more scenarios failed');
process.exit(allPassed ? 0 : 1);
