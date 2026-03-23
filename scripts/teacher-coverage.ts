/**
 * scripts/teacher-coverage.ts
 *
 * Analyzes teacher/speaker coverage in the Pinecone corpus to identify
 * underrepresented teachers. Specifically targets the Goldstein and Spira
 * failure modes found in the OLU-596 benchmark (P@3 ≤ 0.17).
 *
 * Strategy:
 * 1. Probe each known teacher with a representative query, retrieve top-50 chunks.
 * 2. Count chunks where speaker metadata matches the teacher.
 * 3. Flag teachers with < 20 substantive chunks as underrepresented.
 * 4. For each flagged teacher, report which source files are represented.
 *
 * Usage:
 *   npx tsx scripts/teacher-coverage.ts              # auto-detect namespace
 *   npx tsx scripts/teacher-coverage.ts --namespace __default__   # force namespace
 *   npx tsx scripts/teacher-coverage.ts --namespace waking-up
 *
 * Requires: PINECONE_API_KEY, PINECONE_INDEX, OPENAI_API_KEY
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

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

import { Pinecone } from '@pinecone-database/pinecone';
import OpenAI from 'openai';

// ── Known teachers in the Waking Up corpus ────────────────────────────────────

const TEACHERS = [
  { name: 'Sam Harris',              probeQuery: 'What does Sam Harris say about the nature of mind and meditation?' },
  { name: 'Adyashanti',              probeQuery: 'How does Adyashanti describe awakening and the end of suffering?' },
  { name: 'Tara Brach',              probeQuery: 'How does Tara Brach teach RAIN and emotional healing in meditation?' },
  { name: 'Joseph Goldstein',        probeQuery: 'What does Joseph Goldstein teach about vipassana and insight meditation?' },
  { name: 'Rupert Spira',            probeQuery: 'How does Rupert Spira describe pure awareness and non-dual experience?' },
  { name: 'Loch Kelly',              probeQuery: 'What does Loch Kelly teach about effortless mindfulness and awake awareness?' },
  { name: 'Mingyur Rinpoche',        probeQuery: 'How does Mingyur Rinpoche teach Tibetan meditation and working with emotions?' },
  { name: 'Diana Winston',           probeQuery: 'What does Diana Winston teach about mindfulness and contemplative practice?' },
  { name: 'Stephan Bodian',          probeQuery: 'What does Stephan Bodian teach about non-dual awareness and resting in being?' },
  { name: 'Henry Shukman',           probeQuery: 'How does Henry Shukman describe Zen awakening and koan practice?' },
  { name: 'Swami Sarvapriyananda',   probeQuery: 'What does Swami Sarvapriyananda teach about Vedanta and non-self?' },
  { name: 'Joan Tollifson',          probeQuery: 'How does Joan Tollifson describe choiceless awareness and present-moment attention?' },
  { name: 'Judson Brewer',           probeQuery: 'What does Judson Brewer teach about craving, addiction, and mindfulness?' },
  { name: 'Kelly Boys',              probeQuery: 'How does Kelly Boys teach resting as awareness and trauma-sensitive mindfulness?' },
];

const SUBSTANTIVE_MIN_LENGTH = 80; // chars; shorter chunks are likely fragments
const UNDERREPRESENTED_THRESHOLD = 20; // < this many substantive chunks = flagged

type PineconeMatch = { id: string; score?: number; metadata?: Record<string, string> };

async function probeTeacher(
  pc: Pinecone,
  oai: OpenAI,
  indexName: string,
  namespace: string,
  teacherName: string,
  probeQuery: string,
  topK: number,
): Promise<{ substantiveChunks: number; totalChunks: number; sources: string[]; sampleFragments: string[] }> {
  // Embed the probe query
  const resp = await oai.embeddings.create({
    model: 'text-embedding-3-small',
    input: probeQuery,
    dimensions: 1536,
  });
  const vector = resp.data[0].embedding;

  // Query with metadata filter for this speaker
  const index = pc.Index(indexName);
  const result = await index.namespace(namespace).query({
    vector,
    topK,
    includeMetadata: true,
    filter: { speaker: { $eq: teacherName } },
  });

  const matches = (result.matches ?? []) as PineconeMatch[];
  const sources = new Set<string>();
  const sampleFragments: string[] = [];
  let substantive = 0;

  for (const m of matches) {
    const meta = m.metadata ?? {};
    const text = (meta.text ?? '').trim();
    const sourceFile = meta.source_file ?? '';
    if (sourceFile) sources.add(sourceFile);
    if (text.length >= SUBSTANTIVE_MIN_LENGTH) {
      substantive++;
    } else if (text.length > 0 && sampleFragments.length < 3) {
      sampleFragments.push(text.slice(0, 120));
    }
  }

  return {
    substantiveChunks: substantive,
    totalChunks: matches.length,
    sources: Array.from(sources),
    sampleFragments,
  };
}

async function main() {
  const required = ['PINECONE_API_KEY', 'OPENAI_API_KEY'];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    console.error(`ERROR: Missing env vars: ${missing.join(', ')}`);
    process.exit(1);
  }

  const indexName = process.env.PINECONE_INDEX ?? 'convergence-mvp';
  const oai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! });

  // ── Detect corpus state ──────────────────────────────────────────────────
  const stats = await pc.Index(indexName).describeIndexStats();
  const namespaces = stats.namespaces as Record<string, { recordCount?: number; vectorCount?: number }> ?? {};
  const wakingUpCount = namespaces['waking-up']?.recordCount ?? namespaces['waking-up']?.vectorCount ?? 0;
  const defaultCount = namespaces['']?.recordCount ?? namespaces['']?.vectorCount ?? namespaces['__default__']?.recordCount ?? 0;

  console.log('\n═══ Pinecone corpus state ══════════════════════════════════');
  console.log(`  waking-up namespace:    ${wakingUpCount.toLocaleString()} vectors`);
  console.log(`  __default__ namespace:  ${defaultCount.toLocaleString()} vectors`);
  console.log(`  Total:                  ${(stats.totalRecordCount ?? 0).toLocaleString()} vectors`);

  // Auto-detect namespace from CLI flag or corpus state
  const nsFlag = process.argv.find((a) => a.startsWith('--namespace='))?.split('=')[1]
    ?? (process.argv.includes('--namespace') ? process.argv[process.argv.indexOf('--namespace') + 1] : null);
  const namespace = nsFlag ?? (wakingUpCount > 0 ? 'waking-up' : '');
  const nsLabel = namespace === '' ? '__default__' : namespace;

  console.log(`\n  Probing namespace: ${nsLabel}`);
  console.log(`  Substantive chunk threshold: ≥ ${SUBSTANTIVE_MIN_LENGTH} chars`);
  console.log(`  Underrepresented if: < ${UNDERREPRESENTED_THRESHOLD} substantive matches`);
  console.log('\n─'.repeat(70));

  const TOP_K = 100; // cast a wide net per teacher probe
  const results: Array<{
    teacher: string;
    substantiveChunks: number;
    totalChunks: number;
    sources: string[];
    sampleFragments: string[];
    underrepresented: boolean;
  }> = [];

  for (const { name, probeQuery } of TEACHERS) {
    process.stdout.write(`  ${name.padEnd(28)} ... `);
    try {
      const r = await probeTeacher(pc, oai, indexName, namespace, name, probeQuery, TOP_K);
      const flagged = r.substantiveChunks < UNDERREPRESENTED_THRESHOLD;
      results.push({ teacher: name, ...r, underrepresented: flagged });
      const flag = flagged ? ' ⚠ SPARSE' : '';
      console.log(`${r.substantiveChunks} substantive / ${r.totalChunks} total  (${r.sources.length} sources)${flag}`);
    } catch (err) {
      console.log(`ERROR: ${(err as Error).message}`);
      results.push({ teacher: name, substantiveChunks: 0, totalChunks: 0, sources: [], sampleFragments: [], underrepresented: true });
    }
    // Small delay to avoid rate limiting
    await new Promise((r) => setTimeout(r, 300));
  }

  // ── Summary ──────────────────────────────────────────────────────────────
  const flagged = results.filter((r) => r.underrepresented);
  const wellCovered = results.filter((r) => !r.underrepresented);

  console.log('\n═══ Coverage Summary ═══════════════════════════════════════');
  console.log(`  Well-covered teachers (≥ ${UNDERREPRESENTED_THRESHOLD} substantive chunks): ${wellCovered.length}`);
  console.log(`  Sparse/underrepresented teachers: ${flagged.length}`);

  if (flagged.length > 0) {
    console.log('\n⚠  SPARSE TEACHERS — Action required:');
    for (const t of flagged) {
      console.log(`\n  ${t.teacher}`);
      console.log(`    Substantive chunks: ${t.substantiveChunks} (threshold: ${UNDERREPRESENTED_THRESHOLD})`);
      console.log(`    Source files (${t.sources.length}): ${t.sources.slice(0, 5).join(', ') || 'none found'}`);
      if (t.sources.length > 5) console.log(`      ... and ${t.sources.length - 5} more`);
      if (t.sampleFragments.length > 0) {
        console.log('    Sample fragments (short non-substantive chunks):');
        for (const f of t.sampleFragments) console.log(`      • "${f}"`);
      }
      console.log('    Recommendation: Re-chunk transcripts with semantic segmentation (merge short turns).');
      console.log('                    Add metadata boost for teacher name in chunk prefix.');
    }
  }

  // ── Action items for benchmark ────────────────────────────────────────────
  console.log('\n═══ Benchmark Action Items ═══════════════════════════════');
  const goldstein = results.find((r) => r.teacher === 'Joseph Goldstein');
  const spira = results.find((r) => r.teacher === 'Rupert Spira');

  if (goldstein) {
    console.log(`\n  Joseph Goldstein (OLU-596 Q04 — P@3=0.17):`);
    console.log(`    Substantive chunks: ${goldstein.substantiveChunks}`);
    console.log(`    Sources: ${goldstein.sources.join(', ') || 'none'}`);
    const root = goldstein.substantiveChunks < UNDERREPRESENTED_THRESHOLD
      ? 'SPARSE — not enough substantive content. Short dialogue turns dominate retrieval.'
      : 'Coverage OK — failure likely from dialogue fragment chunking (short turns without content).';
    console.log(`    Root cause: ${root}`);
    console.log('    Fix: Semantic re-chunking to merge Q&A turns into idea-unit segments.');
  }

  if (spira) {
    console.log(`\n  Rupert Spira (OLU-596 Q05 — P@3=0.17):`);
    console.log(`    Substantive chunks: ${spira.substantiveChunks}`);
    console.log(`    Sources: ${spira.sources.join(', ') || 'none'}`);
    const root = spira.substantiveChunks < UNDERREPRESENTED_THRESHOLD
      ? 'SPARSE — very limited Spira content in corpus. Needs additional transcripts.'
      : 'Coverage OK — failure likely from query-chunk mismatch (abstract query, no dense target chunk).';
    console.log(`    Root cause: ${root}`);
    console.log('    Fix: Index more Rupert Spira source transcripts; apply query expansion for teacher queries.');
  }

  // ── Write JSON output ─────────────────────────────────────────────────────
  const outDir = resolve(process.cwd(), 'research');
  mkdirSync(outDir, { recursive: true });
  const outPath = resolve(outDir, 'teacher-coverage.json');
  writeFileSync(outPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    namespace: nsLabel,
    indexName,
    substantiveMinLength: SUBSTANTIVE_MIN_LENGTH,
    underrepresentedThreshold: UNDERREPRESENTED_THRESHOLD,
    results: results.map(({ teacher, substantiveChunks, totalChunks, sources, underrepresented }) => ({
      teacher, substantiveChunks, totalChunks, sourceCount: sources.length, sources, underrepresented,
    })),
    flagged: flagged.map((r) => r.teacher),
    summary: {
      totalTeachersChecked: results.length,
      wellCovered: wellCovered.length,
      sparse: flagged.length,
    },
  }, null, 2), 'utf-8');

  console.log(`\nJSON output → ${outPath}`);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
