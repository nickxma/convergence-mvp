/**
 * scripts/verify-migrations.ts
 *
 * Verifies that all Supabase migrations in supabase/migrations/ apply cleanly
 * to the target database and that the resulting schema matches expectations.
 *
 * Usage:
 *   npm run verify-migrations
 *
 * Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars.
 * Reads from .env.local automatically.
 *
 * Exit codes:
 *   0 — all migrations applied, schema valid
 *   1 — one or more checks failed
 *
 * How it works:
 *   1. Reads migration files from supabase/migrations/ in filename order.
 *   2. Applies each migration via the Supabase SQL REST endpoint (idempotent —
 *      all DDL uses IF NOT EXISTS / OR REPLACE).
 *   3. Validates required tables and indexes exist in the public schema.
 *   4. Prints a pass/fail summary and exits non-zero on any failure.
 */

import { readdirSync, readFileSync } from 'fs';
import { resolve, join } from 'path';
import { createClient } from '@supabase/supabase-js';

// ── Env loading ───────────────────────────────────────────────────────────────

function loadEnvLocal() {
  const envPath = resolve(process.cwd(), '.env.local');
  try {
    const content = readFileSync(envPath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx < 0) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
      if (key && !process.env[key]) process.env[key] = val;
    }
  } catch {
    // No .env.local — rely on process env
  }
}

loadEnvLocal();

// ── Config ────────────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Expected community tables after all migrations are applied
const EXPECTED_TABLES = [
  'posts',
  'replies',
  'votes',
  'user_profiles',
  'webhooks',
  'webhook_deliveries',
];

// Expected indexes after all migrations are applied (based on migrations 003–008)
const EXPECTED_INDEXES = [
  // 003_webhooks
  'idx_webhook_deliveries_pending',
  'idx_webhook_deliveries_webhook_id',
  // 004_community_indexes (some replaced in later migrations)
  'idx_posts_created_at',
  'idx_votes_post_voter',
  'idx_votes_post_id',
  'idx_user_profiles_wallet_address',
  // 005_posts_fts
  'idx_posts_search_vector',
  // 006_soft_delete (replaces idx_posts_hidden_vote_score and idx_replies_post_id)
  'idx_posts_feed',
  'idx_posts_deleted_at',
  'idx_replies_post_id',
  // 007_search_replies_fts
  'idx_replies_search_vector',
  // 008_wallet_indexes
  'posts_author_wallet_idx',
  'replies_author_wallet_idx',
  'votes_voter_wallet_idx',
];

// ── Helpers ───────────────────────────────────────────────────────────────────

type Result = { ok: boolean; message: string };

function ok(message: string): Result {
  return { ok: true, message };
}

function fail(message: string): Result {
  return { ok: false, message };
}

function log(line: string) {
  process.stdout.write(line + '\n');
}

/**
 * Execute arbitrary SQL via the Supabase PostgREST SQL endpoint.
 * Requires service role key.
 */
async function execSql(sql: string): Promise<{ error?: string }> {
  const url = `${SUPABASE_URL}/rest/v1/sql`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY!,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: sql }),
  });

  if (!res.ok) {
    const body = await res.text();
    return { error: `HTTP ${res.status}: ${body}` };
  }
  return {};
}

/**
 * Query a single column from a SQL SELECT via the SQL endpoint.
 */
async function querySql<T>(
  sql: string,
): Promise<{ rows?: T[]; error?: string }> {
  const url = `${SUPABASE_URL}/rest/v1/sql`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY!,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: sql }),
  });

  if (!res.ok) {
    const body = await res.text();
    return { error: `HTTP ${res.status}: ${body}` };
  }

  const json = await res.json();
  // PostgREST SQL endpoint returns { results: [{ rows: [...], columns: [...] }] }
  // or just an array depending on version
  if (Array.isArray(json)) return { rows: json as T[] };
  if (json?.results?.[0]?.rows) return { rows: json.results[0].rows as T[] };
  return { rows: [] };
}

// ── Step 1: Validate env vars ─────────────────────────────────────────────────

function checkEnvVars(): Result {
  if (!SUPABASE_URL) return fail('SUPABASE_URL is not set');
  if (!SUPABASE_SERVICE_ROLE_KEY) return fail('SUPABASE_SERVICE_ROLE_KEY is not set');
  return ok(`SUPABASE_URL=${SUPABASE_URL}`);
}

// ── Step 2: Get migration files ───────────────────────────────────────────────

function getMigrationFiles(): string[] {
  const dir = resolve(process.cwd(), 'supabase/migrations');
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort() // lexicographic = numeric order (001_, 002_, ...)
    .map((f) => join(dir, f));
}

// ── Step 3: Apply each migration ─────────────────────────────────────────────

async function applyMigration(filePath: string): Promise<Result> {
  const name = filePath.split('/').pop()!;
  const sql = readFileSync(filePath, 'utf-8');

  const { error } = await execSql(sql);
  if (error) return fail(`${name}: ${error}`);
  return ok(name);
}

// ── Step 4: Validate tables ───────────────────────────────────────────────────

async function validateTables(): Promise<Result[]> {
  const { rows, error } = await querySql<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
  );

  if (error) {
    return [fail(`Could not query information_schema.tables: ${error}`)];
  }

  const found = new Set((rows ?? []).map((r) => r.table_name));
  return EXPECTED_TABLES.map((t) =>
    found.has(t) ? ok(`table '${t}' exists`) : fail(`table '${t}' MISSING`),
  );
}

// ── Step 5: Validate indexes ──────────────────────────────────────────────────

async function validateIndexes(): Promise<Result[]> {
  const { rows, error } = await querySql<{ indexname: string }>(
    `SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`,
  );

  if (error) {
    return [fail(`Could not query pg_indexes: ${error}`)];
  }

  const found = new Set((rows ?? []).map((r) => r.indexname));
  return EXPECTED_INDEXES.map((idx) =>
    found.has(idx) ? ok(`index '${idx}' exists`) : fail(`index '${idx}' MISSING`),
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const allResults: { section: string; result: Result }[] = [];
  let anyFailure = false;

  function record(section: string, result: Result) {
    allResults.push({ section, result });
    if (!result.ok) anyFailure = true;
  }

  log('');
  log('🔍  Supabase Migration Verifier');
  log('================================');

  // Env vars
  log('\n[1/4] Environment');
  const envResult = checkEnvVars();
  record('env', envResult);
  log(`  ${envResult.ok ? '✅' : '❌'} ${envResult.message}`);
  if (!envResult.ok) {
    log('\n❌  Cannot continue without required env vars.');
    process.exit(1);
  }

  // Migration files
  log('\n[2/4] Applying migrations');
  let migrationFiles: string[];
  try {
    migrationFiles = getMigrationFiles();
  } catch (err) {
    log(`  ❌  Could not read supabase/migrations/: ${err}`);
    process.exit(1);
  }

  if (migrationFiles.length === 0) {
    log('  ⚠️  No migration files found in supabase/migrations/');
  }

  for (const file of migrationFiles) {
    const result = await applyMigration(file);
    record('migration', result);
    log(`  ${result.ok ? '✅' : '❌'} ${result.message}`);
  }

  // Table validation
  log('\n[3/4] Schema: tables');
  const tableResults = await validateTables();
  for (const r of tableResults) {
    record('table', r);
    log(`  ${r.ok ? '✅' : '❌'} ${r.message}`);
  }

  // Index validation
  log('\n[4/4] Schema: indexes');
  const indexResults = await validateIndexes();
  for (const r of indexResults) {
    record('index', r);
    log(`  ${r.ok ? '✅' : '❌'} ${r.message}`);
  }

  // Summary
  const passed = allResults.filter((r) => r.result.ok).length;
  const failed = allResults.filter((r) => !r.result.ok).length;
  const total = allResults.length;

  log('\n================================');
  log(`  Passed: ${passed}/${total}`);
  if (failed > 0) {
    log(`  Failed: ${failed}`);
    log('\n❌  Verification failed — fix the above issues before deploying.');
    process.exit(1);
  } else {
    log('\n✅  All checks passed — schema is ready for deployment.');
    process.exit(0);
  }
}

main().catch((err) => {
  console.error('❌  Unexpected error:', err);
  process.exit(1);
});
