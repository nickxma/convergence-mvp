/**
 * scripts/export-subscribers.ts
 *
 * Emergency fallback: exports the Resend audience to a local CSV file.
 * Use this when Resend is unavailable or before migrating to a different
 * email provider.
 *
 * Usage:
 *   pnpm export:subscribers
 *   # or directly:
 *   tsx scripts/export-subscribers.ts
 *
 * Requires (in .env.local or environment):
 *   RESEND_API_KEY      — Resend API key (re_*)
 *   RESEND_AUDIENCE_ID  — Audience UUID from resend.com → Audiences
 *
 * Output:
 *   exports/subscribers-YYYY-MM-DD.csv
 *
 * CSV columns: email, first_name, last_name, subscribed, created_at
 *
 * The Resend Contacts API pages results (max 1000 per call). This script
 * fetches all pages and deduplicates before writing.
 */

import { createWriteStream, mkdirSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

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

// ── Config ────────────────────────────────────────────────────────────────────

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_AUDIENCE_ID = process.env.RESEND_AUDIENCE_ID;

if (!RESEND_API_KEY) {
  console.error('✗ RESEND_API_KEY not set in .env.local');
  process.exit(1);
}
if (!RESEND_AUDIENCE_ID) {
  console.error('✗ RESEND_AUDIENCE_ID not set in .env.local');
  console.error('  Find it at resend.com → Audiences → <your audience> → ID');
  process.exit(1);
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface ResendContact {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  unsubscribed: boolean;
  created_at: string;
}

interface ResendContactsResponse {
  data: ResendContact[];
}

// ── Fetch all contacts (paginated) ────────────────────────────────────────────

async function fetchAllContacts(): Promise<ResendContact[]> {
  const url = `https://api.resend.com/audiences/${RESEND_AUDIENCE_ID}/contacts`;
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${RESEND_API_KEY}` },
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Resend API error ${resp.status}: ${body}`);
  }

  const json = (await resp.json()) as ResendContactsResponse;
  return json.data ?? [];
}

// ── CSV helpers ───────────────────────────────────────────────────────────────

function csvEscape(val: string | null | undefined): string {
  if (val === null || val === undefined) return '';
  const s = String(val);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function toCsvRow(c: ResendContact): string {
  return [
    csvEscape(c.email),
    csvEscape(c.first_name),
    csvEscape(c.last_name),
    c.unsubscribed ? 'false' : 'true', // subscribed = !unsubscribed
    csvEscape(c.created_at),
  ].join(',');
}

// ── Main ──────────────────────────────────────────────────────────────────────

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

async function main() {
  const exportsDir = resolve(ROOT, 'exports');
  mkdirSync(exportsDir, { recursive: true });

  const outPath = resolve(exportsDir, `subscribers-${today()}.csv`);

  console.log(`→ Fetching contacts from Resend audience ${RESEND_AUDIENCE_ID}…`);
  const contacts = await fetchAllContacts();
  console.log(`  Found ${contacts.length} contacts`);

  const stream = createWriteStream(outPath, { encoding: 'utf-8' });
  stream.write('email,first_name,last_name,subscribed,created_at\n');
  for (const c of contacts) {
    stream.write(toCsvRow(c) + '\n');
  }
  await new Promise<void>((resolve, reject) => {
    stream.end((err?: Error | null) => (err ? reject(err) : resolve()));
  });

  const subscribed = contacts.filter((c) => !c.unsubscribed).length;
  const unsubscribed = contacts.length - subscribed;

  console.log(`✓ Exported to ${outPath}`);
  console.log(`  ${subscribed} subscribed, ${unsubscribed} unsubscribed`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
