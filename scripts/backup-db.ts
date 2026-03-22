/**
 * scripts/backup-db.ts
 *
 * Exports a full SQL dump of the linked Supabase project to a local gzipped
 * file at backups/YYYY-MM-DD.sql.gz.
 *
 * Usage:
 *   pnpm backup:db
 *   # or directly:
 *   tsx scripts/backup-db.ts
 *
 * Requirements:
 *   - Supabase CLI installed (npm i -g supabase or brew install supabase/tap/supabase)
 *   - Project linked: supabase link --project-ref <ref>
 *   - SUPABASE_DB_PASSWORD in .env.local (Settings → Database → Connection info → Password)
 *
 * Output:
 *   backups/YYYY-MM-DD.sql.gz   — SQL dump, gzip-compressed
 *
 * The backups/ directory is gitignored. Safe to re-run; existing files for the
 * same date are overwritten.
 */

import { execSync } from 'node:child_process';
import { createGzip } from 'node:zlib';
import { createWriteStream, mkdirSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// ── Load .env.local ───────────────────────────────────────────────────────────

function loadEnvLocal() {
  const envPath = resolve(ROOT, '.env.local');
  try {
    const content = readFileSync(envPath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
      if (!(key in process.env)) process.env[key] = val;
    }
  } catch {
    // .env.local not found — rely on process environment
  }
}

loadEnvLocal();

// ── Helpers ───────────────────────────────────────────────────────────────────

function today(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function ensureBackupsDir(): string {
  const dir = resolve(ROOT, 'backups');
  mkdirSync(dir, { recursive: true });
  return dir;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const backupsDir = ensureBackupsDir();
  const outPath = resolve(backupsDir, `${today()}.sql.gz`);

  console.log(`→ Dumping Supabase database…`);
  console.log(`  Output: ${outPath}`);

  // supabase db dump --linked outputs SQL to stdout.
  // We pipe it through gzip and write to the output file.
  let sql: Buffer;
  try {
    sql = execSync('supabase db dump --linked', {
      cwd: ROOT,
      maxBuffer: 256 * 1024 * 1024, // 256 MB
      env: process.env,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('not found') || msg.includes('command not found')) {
      console.error('✗ supabase CLI not found.');
      console.error('  Install: npm i -g supabase  or  brew install supabase/tap/supabase');
      process.exit(1);
    }
    if (msg.includes('not linked')) {
      console.error('✗ Project not linked.');
      console.error('  Run: supabase link --project-ref <ref>');
      process.exit(1);
    }
    console.error('✗ supabase db dump failed:', msg);
    process.exit(1);
  }

  const readStream = Readable.from(sql);
  const gzip = createGzip({ level: 9 });
  const writeStream = createWriteStream(outPath);

  await pipeline(readStream, gzip, writeStream);

  const sizeMB = (sql.length / 1024 / 1024).toFixed(1);
  console.log(`✓ Dump complete: ${sizeMB} MB uncompressed → ${outPath}`);
  console.log(`\nTo restore (staging):`);
  console.log(`  gunzip -c ${outPath} | psql "<staging-db-url>"`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
