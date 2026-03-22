/**
 * scripts/semantic-segment.ts
 *
 * LLM-based semantic segmentation of Waking Up transcripts into idea units.
 *
 * What it does:
 *   1. Reads all .txt files in the transcript directory.
 *   2. Checks a local manifest to skip already-segmented files.
 *   3. Sends each transcript to GPT-4o-mini to segment into coherent idea units.
 *   4. Writes output to data/semantic-chunks/{filename}.json.
 *   5. Updates data/semantic-chunks/.manifest.json after each file.
 *
 * Usage:
 *   pnpm segment:corpus
 *   # or:
 *   tsx scripts/semantic-segment.ts [--test 5]   (process only first N files)
 *
 * Requires:
 *   OPENAI_API_KEY (in .env.local or environment)
 *
 * Cost estimate: ~$1-2 for all ~1,100 transcripts using GPT-4o-mini.
 */

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

// ── Load .env.local ────────────────────────────────────────────────────────────

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

import OpenAI from 'openai';

// ── Config ────────────────────────────────────────────────────────────────────

const TRANSCRIPT_DIR = join(
  homedir(),
  'Library/Mobile Documents/com~apple~CloudDocs/Documents/Transcripts (via Waking Up)/Text files/*Everything',
);

const DATA_DIR = resolve(process.cwd(), 'data/semantic-chunks');
const MANIFEST_PATH = join(DATA_DIR, '.manifest.json');

// Max chars to send in a single GPT call (~15K tokens — safe for gpt-4o-mini)
const MAX_CALL_CHARS = 60_000;

// Concurrent file processing limit
const CONCURRENCY = 5;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Segment {
  text: string;
  topic: string;
  speaker: string;
}

export interface SegmentFile {
  filename: string;
  file_hash: string;
  segments: Segment[];
  segmented_at: string;
}

type Manifest = Record<string, string>; // filename -> file_hash

// ── GPT segmentation ──────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an expert at segmenting mindfulness and meditation transcripts into coherent idea units.

Return a JSON object with a "segments" array. Each segment object has:
- "text": the verbatim text of this idea unit (preserve exact wording)
- "topic": 2-5 word description of the main concept in this segment
- "speaker": the teacher's first name (infer from context; use "Unknown" if unclear)

Rules:
- Each segment = one complete thought, instruction, analogy, story, or concept
- Aim for 2-8 sentences per segment
- Do NOT skip, alter, or reorder any text — all content must appear in segments
- Be consistent with speaker name across all segments from the same file`;

async function segmentChunk(oai: OpenAI, text: string): Promise<Segment[]> {
  let attempt = 0;
  while (attempt < 3) {
    try {
      const resp = await oai.chat.completions.create({
        model: 'gpt-4o-mini',
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: `Segment this transcript:\n\n${text}` },
        ],
        temperature: 0.1,
      });

      const raw = resp.choices[0]?.message?.content ?? '{}';
      const parsed = JSON.parse(raw) as { segments?: unknown };
      const segments = parsed.segments;

      if (!Array.isArray(segments) || segments.length === 0) {
        throw new Error('Empty or invalid segments array from API');
      }

      return segments.map((seg: unknown) => {
        const s = seg as Record<string, unknown>;
        return {
          text: String(s.text ?? '').trim(),
          topic: String(s.topic ?? 'general').trim(),
          speaker: String(s.speaker ?? 'Unknown').trim(),
        };
      }).filter((s) => s.text.length > 0);
    } catch (err) {
      attempt++;
      if (attempt >= 3) throw err;
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
  throw new Error('Unreachable');
}

async function segmentFile(oai: OpenAI, content: string): Promise<Segment[]> {
  // If content fits in one call, process directly
  if (content.length <= MAX_CALL_CHARS) {
    return segmentChunk(oai, content);
  }

  // Otherwise, split at double-newlines and batch into MAX_CALL_CHARS chunks
  const parts: string[] = [];
  let current = '';
  for (const paragraph of content.split(/\n\n+/)) {
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
    if (candidate.length <= MAX_CALL_CHARS) {
      current = candidate;
    } else {
      if (current) parts.push(current);
      current = paragraph;
    }
  }
  if (current) parts.push(current);

  const allSegments: Segment[] = [];
  for (const part of parts) {
    const segs = await segmentChunk(oai, part);
    allSegments.push(...segs);
  }
  return allSegments;
}

// ── Concurrency limiter ────────────────────────────────────────────────────────

async function processWithConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    console.error('ERROR: OPENAI_API_KEY is required');
    process.exit(1);
  }

  // Parse --test N argument for sample runs
  const testArg = process.argv.indexOf('--test');
  const testLimit = testArg >= 0 ? parseInt(process.argv[testArg + 1] ?? '5', 10) : 0;
  if (testLimit > 0) {
    console.log(`TEST MODE: processing first ${testLimit} files only.\n`);
  }

  const oai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  // Ensure output directory exists
  mkdirSync(DATA_DIR, { recursive: true });

  // Load manifest
  let manifest: Manifest = {};
  if (existsSync(MANIFEST_PATH)) {
    try {
      manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8')) as Manifest;
    } catch {
      manifest = {};
    }
  }
  console.log(`Manifest: ${Object.keys(manifest).length} files already segmented.`);

  // Read transcript files
  console.log(`Scanning: ${TRANSCRIPT_DIR}`);
  let txFiles: string[];
  try {
    txFiles = readdirSync(TRANSCRIPT_DIR)
      .filter((f) => f.endsWith('.txt'))
      .map((f) => join(TRANSCRIPT_DIR, f));
  } catch (err) {
    console.error(`ERROR: Cannot read transcript directory: ${TRANSCRIPT_DIR}`);
    console.error((err as Error).message);
    process.exit(1);
  }
  console.log(`Found ${txFiles.length} .txt files.\n`);

  // Identify unprocessed files
  const toProcess: { path: string; filename: string; hash: string; content: string }[] = [];
  for (const filePath of txFiles) {
    const filename = basename(filePath);
    const content = readFileSync(filePath, 'utf-8');
    const hash = createHash('sha256').update(content).digest('hex');
    if (manifest[filename] === hash) continue;
    toProcess.push({ path: filePath, filename, hash, content });
  }

  const limit = testLimit > 0 ? Math.min(testLimit, toProcess.length) : toProcess.length;
  const batch = toProcess.slice(0, limit);

  console.log(`Files to segment: ${limit} of ${toProcess.length} unprocessed.`);
  if (batch.length === 0) {
    console.log('Nothing to do — all files already segmented.');
    return;
  }

  let done = 0;
  let errors = 0;

  await processWithConcurrency(batch, CONCURRENCY, async (file, i) => {
    const label = `[${i + 1}/${batch.length}] ${file.filename}`;
    try {
      const segments = await segmentFile(oai, file.content);

      const output: SegmentFile = {
        filename: file.filename,
        file_hash: file.hash,
        segments,
        segmented_at: new Date().toISOString(),
      };

      const outPath = join(DATA_DIR, `${file.filename}.json`);
      writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf-8');

      // Update in-memory manifest and persist (JS is single-threaded so no race)
      manifest[file.filename] = file.hash;
      writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2), 'utf-8');

      console.log(`  ✓ ${label} — ${segments.length} segments`);
      done++;
    } catch (err) {
      console.error(`  ✗ ${label} — ${(err as Error).message}`);
      errors++;
    }
  });

  console.log(`\n── Run Report ─────────────────────────────────────────`);
  console.log(`  Files segmented: ${done}`);
  console.log(`  Errors:          ${errors}`);
  console.log(`  Output dir:      ${DATA_DIR}`);
  console.log(`───────────────────────────────────────────────────────\n`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
