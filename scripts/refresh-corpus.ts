/**
 * scripts/refresh-corpus.ts
 *
 * Incremental Pinecone corpus refresh — embeds new Waking Up transcripts only.
 *
 * What it does:
 *   1. Reads all .txt files in the transcript directory.
 *   2. Hashes each file's content (SHA-256) and checks the corpus_manifest
 *      table in Supabase. Files already in the manifest with the same hash
 *      are skipped.
 *   3. Chunks new/changed files using sentence-aware splitting (~300 tokens
 *      per chunk, 50-token overlap).
 *   4. Embeds chunks with OpenAI text-embedding-3-small, upserts to Pinecone
 *      in batches of 100 (namespace: waking-up).
 *   5. Writes new rows to corpus_manifest after successful upsert.
 *   6. Prints a run report: new files, chunks added, total corpus size.
 *
 * Usage:
 *   pnpm refresh:corpus
 *   # or directly:
 *   tsx scripts/refresh-corpus.ts
 *
 * Requires (in .env.local or environment):
 *   PINECONE_API_KEY, PINECONE_INDEX, OPENAI_API_KEY,
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import type { SegmentFile } from './semantic-segment';

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

import { createClient } from '@supabase/supabase-js';
import { Pinecone } from '@pinecone-database/pinecone';
import OpenAI from 'openai';

// ── Config ────────────────────────────────────────────────────────────────────

const TRANSCRIPT_DIR = join(
  homedir(),
  'Library/Mobile Documents/com~apple~CloudDocs/Documents/Transcripts (via Waking Up)/Text files/*Everything',
);

const EMBED_MODEL = 'text-embedding-3-small';
const PINECONE_NAMESPACE = 'waking-up';
const BATCH_SIZE = 100; // chunks per OpenAI embed call and Pinecone upsert

// Semantic chunk sizing (token approximation: 1 token ≈ 4 characters)
const MIN_CHUNK_CHARS = 400;  // ~100 tokens — merge smaller adjacent same-topic segments
const MAX_CHUNK_CHARS = 2000; // ~500 tokens — sub-split larger segments at sentence boundaries

// Fallback sentence-based chunker config (used when no semantic segments exist)
const TARGET_CHUNK_TOKENS = 300;
const OVERLAP_TOKENS = 50;
const TARGET_CHUNK_CHARS = TARGET_CHUNK_TOKENS * 4; // 1200
const OVERLAP_CHARS = OVERLAP_TOKENS * 4; // 200

// Directory where semantic-segment.ts writes its JSON output
const DATA_DIR = resolve(process.cwd(), 'data/semantic-chunks');

// ── Types ─────────────────────────────────────────────────────────────────────

interface Chunk {
  id: string;
  text: string;
  source_file: string;
  chunk_index: number;
  speaker?: string;
  topic?: string;
}

interface ManifestRow {
  filename: string;
  file_hash: string;
  chunk_count: number;
  embedded_at: string;
}

// ── Semantic chunker (primary) ─────────────────────────────────────────────────

/**
 * Splits text at sentence boundaries up to maxChars per part.
 * Used to sub-split oversized semantic segments.
 */
function splitAtSentences(text: string, maxChars: number): string[] {
  const sentences = text.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => s.length > 0);
  const parts: string[] = [];
  let current = '';
  for (const sentence of sentences) {
    const candidate = current ? `${current} ${sentence}` : sentence;
    if (candidate.length <= maxChars) {
      current = candidate;
    } else {
      if (current) parts.push(current);
      current = sentence;
    }
  }
  if (current) parts.push(current);
  return parts;
}

/**
 * Loads pre-computed semantic segments from data/semantic-chunks/{filename}.json,
 * applies size guardrails, prepends context headers, and returns Chunk[].
 *
 * Falls back to sentence-based chunkText() if no segment file exists.
 */
function loadSemanticChunks(filename: string, content: string): Chunk[] {
  const segmentPath = join(DATA_DIR, `${filename}.json`);
  if (!existsSync(segmentPath)) {
    console.warn(`  [warn] No semantic segments for ${filename} — using fallback chunker`);
    return chunkText(content, filename);
  }

  let segmentFile: SegmentFile;
  try {
    segmentFile = JSON.parse(readFileSync(segmentPath, 'utf-8')) as SegmentFile;
    if (!Array.isArray(segmentFile.segments) || segmentFile.segments.length === 0) {
      throw new Error('Empty segments array');
    }
  } catch (err) {
    console.warn(`  [warn] Bad segment file for ${filename}: ${(err as Error).message} — using fallback chunker`);
    return chunkText(content, filename);
  }

  const filenameHash = createHash('sha256').update(filename).digest('hex').slice(0, 12);

  // Merge small adjacent same-speaker+topic segments
  const merged: SegmentFile['segments'] = [];
  let pending: SegmentFile['segments'][number] | null = null;
  for (const seg of segmentFile.segments) {
    if (!pending) {
      pending = { ...seg };
      continue;
    }
    if (
      pending.text.length < MIN_CHUNK_CHARS &&
      pending.speaker === seg.speaker &&
      pending.topic === seg.topic
    ) {
      pending = { ...pending, text: `${pending.text} ${seg.text}` };
    } else {
      merged.push(pending);
      pending = { ...seg };
    }
  }
  if (pending) merged.push(pending);

  // Build chunks: prepend context header, sub-split if oversized
  const chunks: Chunk[] = [];
  for (const seg of merged) {
    const header = `${seg.speaker} on ${seg.topic}: `;
    const maxContent = MAX_CHUNK_CHARS - header.length;

    if (seg.text.length <= maxContent) {
      chunks.push({
        id: `wu-${filenameHash}-s${chunks.length}`,
        text: header + seg.text,
        source_file: filename,
        chunk_index: chunks.length,
        speaker: seg.speaker,
        topic: seg.topic,
      });
    } else {
      for (const part of splitAtSentences(seg.text, maxContent)) {
        chunks.push({
          id: `wu-${filenameHash}-s${chunks.length}`,
          text: header + part,
          source_file: filename,
          chunk_index: chunks.length,
          speaker: seg.speaker,
          topic: seg.topic,
        });
      }
    }
  }

  return chunks;
}

// ── Sentence-aware chunker (fallback) ─────────────────────────────────────────

/**
 * Splits text into chunks of approximately TARGET_CHUNK_CHARS characters,
 * respecting sentence boundaries, with OVERLAP_CHARS of overlap.
 */
function chunkText(text: string, sourceFile: string): Chunk[] {
  // Split into sentences on `. `, `! `, `? `, or paragraph breaks.
  const sentenceRe = /(?<=[.!?])\s+|(?<=\n)\n+/;
  const sentences = text
    .split(sentenceRe)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const chunks: Chunk[] = [];
  let current = '';
  let overlap = '';

  for (const sentence of sentences) {
    const candidate = current ? `${current} ${sentence}` : sentence;

    if (candidate.length <= TARGET_CHUNK_CHARS) {
      current = candidate;
    } else {
      // Flush current chunk
      if (current.length > 0) {
        const filenameHash = createHash('sha256').update(sourceFile).digest('hex').slice(0, 12);
        const chunkId = `wu-${filenameHash}-${chunks.length}`;
        chunks.push({
          id: chunkId,
          text: (overlap ? `${overlap} ` : '') + current,
          source_file: sourceFile,
          chunk_index: chunks.length,
        });
        // Keep last OVERLAP_CHARS of current as overlap for next chunk
        overlap = current.length > OVERLAP_CHARS ? current.slice(-OVERLAP_CHARS) : current;
        current = sentence;
      } else {
        // Single sentence longer than target — emit as-is
        const filenameHash = createHash('sha256').update(sourceFile).digest('hex').slice(0, 12);
        const chunkId = `wu-${filenameHash}-${chunks.length}`;
        chunks.push({
          id: chunkId,
          text: sentence,
          source_file: sourceFile,
          chunk_index: chunks.length,
        });
        overlap = sentence.length > OVERLAP_CHARS ? sentence.slice(-OVERLAP_CHARS) : sentence;
        current = '';
      }
    }
  }

  // Flush remainder
  if (current.length > 0) {
    const filenameHash = createHash('sha256').update(sourceFile).digest('hex').slice(0, 12);
    const chunkId = `wu-${filenameHash}-${chunks.length}`;
    chunks.push({
      id: chunkId,
      text: (overlap ? `${overlap} ` : '') + current,
      source_file: sourceFile,
      chunk_index: chunks.length,
    });
  }

  return chunks;
}

// ── Embed helper ──────────────────────────────────────────────────────────────

async function embedTexts(oai: OpenAI, texts: string[]): Promise<number[][]> {
  const resp = await oai.embeddings.create({ model: EMBED_MODEL, input: texts });
  return resp.data.map((item) => item.embedding);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const requiredEnv = [
    'PINECONE_API_KEY',
    'OPENAI_API_KEY',
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
  ];
  const missing = requiredEnv.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    console.error(`ERROR: Missing env vars: ${missing.join(', ')}`);
    process.exit(1);
  }

  // ── Clients ──────────────────────────────────────────────────────────────────
  const oai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! });
  const index = pc.Index(process.env.PINECONE_INDEX ?? 'convergence-mvp');
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  // ── Read transcript directory ─────────────────────────────────────────────
  console.log(`\nScanning: ${TRANSCRIPT_DIR}`);
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
  console.log(`Found ${txFiles.length} .txt files.`);

  // ── Load manifest ─────────────────────────────────────────────────────────
  const { data: manifestRows, error: manifestErr } = await sb
    .from('corpus_manifest')
    .select('filename, file_hash');
  if (manifestErr) {
    console.error('ERROR: Failed to query corpus_manifest:', manifestErr.message);
    process.exit(1);
  }
  const manifest = new Map<string, string>(
    (manifestRows as Pick<ManifestRow, 'filename' | 'file_hash'>[]).map((r) => [
      r.filename,
      r.file_hash,
    ]),
  );
  console.log(`Manifest: ${manifest.size} files already embedded.`);

  // ── Identify new/changed files ────────────────────────────────────────────
  const toProcess: { path: string; filename: string; hash: string; content: string }[] = [];

  for (const filePath of txFiles) {
    const filename = basename(filePath);
    const content = readFileSync(filePath, 'utf-8');
    const hash = createHash('sha256').update(content).digest('hex');
    const existingHash = manifest.get(filename);
    if (existingHash === hash) continue; // already embedded, same content
    toProcess.push({ path: filePath, filename, hash, content });
  }

  console.log(`\nNew/changed files to embed: ${toProcess.length}`);
  if (toProcess.length === 0) {
    // Get corpus stats and exit
    const stats = await index.describeIndexStats();
    const namespaceStats = (stats.namespaces as Record<string, { vectorCount?: number }>)?.[PINECONE_NAMESPACE];
    const total = namespaceStats?.vectorCount ?? stats.totalRecordCount ?? 0;
    console.log(`\n── Run Report ─────────────────────────────────────────`);
    console.log(`  New files found:  0`);
    console.log(`  Chunks added:     0`);
    console.log(`  Total corpus:     ${total.toLocaleString()} vectors (namespace: ${PINECONE_NAMESPACE})`);
    console.log(`───────────────────────────────────────────────────────\n`);
    return;
  }

  // ── Chunk, embed, upsert ──────────────────────────────────────────────────
  let totalChunksAdded = 0;
  const ns = index.namespace(PINECONE_NAMESPACE);

  for (const file of toProcess) {
    console.log(`\nProcessing: ${file.filename}`);
    const chunks = loadSemanticChunks(file.filename, file.content);
    console.log(`  ${chunks.length} chunks`);

    let fileChunksUpserted = 0;
    let batchTexts: string[] = [];
    let batchChunks: Chunk[] = [];

    const flush = async () => {
      if (batchTexts.length === 0) return;
      const embeddings = await embedTexts(oai, batchTexts);
      const vectors = batchChunks.map((chunk, i) => ({
        id: chunk.id,
        values: embeddings[i],
        metadata: {
          text: chunk.text,
          source_file: chunk.source_file,
          chunk_index: chunk.chunk_index,
          ...(chunk.speaker ? { speaker: chunk.speaker } : {}),
          ...(chunk.topic ? { topic: chunk.topic } : {}),
        },
      }));
      await ns.upsert({ records: vectors });
      fileChunksUpserted += vectors.length;
      totalChunksAdded += vectors.length;
      process.stdout.write(`  Upserted ${fileChunksUpserted}/${chunks.length}...\r`);
      batchTexts = [];
      batchChunks = [];
    };

    for (const chunk of chunks) {
      batchTexts.push(chunk.text);
      batchChunks.push(chunk);
      if (batchTexts.length >= BATCH_SIZE) {
        await flush();
      }
    }
    await flush();
    process.stdout.write('\n');

    // ── Write manifest row ──────────────────────────────────────────────────
    const { error: upsertErr } = await sb.from('corpus_manifest').upsert(
      {
        filename: file.filename,
        file_hash: file.hash,
        chunk_count: fileChunksUpserted,
        embedded_at: new Date().toISOString(),
      },
      { onConflict: 'filename' },
    );
    if (upsertErr) {
      console.error(`  WARNING: Failed to write manifest for ${file.filename}:`, upsertErr.message);
    } else {
      console.log(`  Manifest updated for ${file.filename}.`);
    }
  }

  // ── Final stats ───────────────────────────────────────────────────────────
  const stats = await index.describeIndexStats();
  const namespaceStats = (stats.namespaces as Record<string, { vectorCount?: number }>)?.[PINECONE_NAMESPACE];
  const total = namespaceStats?.vectorCount ?? stats.totalRecordCount ?? 0;

  console.log(`\n── Run Report ─────────────────────────────────────────`);
  console.log(`  New files found:  ${toProcess.length}`);
  console.log(`  Chunks added:     ${totalChunksAdded.toLocaleString()}`);
  console.log(`  Total corpus:     ${total.toLocaleString()} vectors (namespace: ${PINECONE_NAMESPACE})`);
  console.log(`───────────────────────────────────────────────────────\n`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
