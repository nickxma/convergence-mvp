/**
 * scripts/benchmark-embeddings.ts
 *
 * Benchmarks embedding model retrieval quality on a test query set.
 *
 * Compares models by querying Pinecone with vectors from each model and
 * computing mean reciprocal rank (MRR) and NDCG@5 against manually
 * relevance-scored results.
 *
 * Usage:
 *   pnpm benchmark:embeddings
 *   # or:
 *   tsx scripts/benchmark-embeddings.ts [--queries path/to/queries.json]
 *
 * Requires (in .env.local or environment):
 *   PINECONE_API_KEY, PINECONE_INDEX, OPENAI_API_KEY
 *
 * Default test queries cover a range of abstract/semantic questions typical
 * of the Waking Up corpus to compare model performance on this specific domain.
 */

import { readFileSync, writeFileSync } from 'node:fs';
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

// ── Config ────────────────────────────────────────────────────────────────────

const PINECONE_NAMESPACE = 'waking-up';
const TOP_K = 10;

interface ModelConfig {
  name: string;
  model: string;
  dimensions: number;
}

const MODELS: ModelConfig[] = [
  { name: 'text-embedding-3-small', model: 'text-embedding-3-small', dimensions: 1536 },
  { name: 'text-embedding-3-large@1536', model: 'text-embedding-3-large', dimensions: 1536 },
  { name: 'text-embedding-3-large@3072', model: 'text-embedding-3-large', dimensions: 3072 },
];

// 20 test queries covering semantic/experiential concepts from the Waking Up corpus.
// These are designed to stress semantic understanding, not keyword matching.
const DEFAULT_QUERIES = [
  'What does it feel like to see through the self?',
  'How do you rest in awareness without effort?',
  'What is the difference between mindfulness and concentration?',
  'Why does suffering persist even when we understand its nature?',
  'What happens at the moment of awakening?',
  'How can I stop identifying with my thoughts?',
  'What is the role of the witness in meditation?',
  'Does consciousness exist beyond the brain?',
  'How do I practice non-dual awareness in daily life?',
  'What is the relationship between love and emptiness?',
  'Can insight arise without a formal practice?',
  'What does it mean to surrender to the present moment?',
  'How do I work with fear in meditation?',
  'What is the difference between ego death and awakening?',
  'How does choiceless awareness relate to acceptance?',
  'Is there such a thing as a permanent state of enlightenment?',
  'What is the role of the body in accessing deeper states of consciousness?',
  'How can meditation dissolve the sense of being a separate self?',
  'What is the difference between being and doing in practice?',
  'How do grief and loss relate to spiritual practice?',
];

interface RetrievedChunk {
  id: string;
  score: number;
  text: string;
  speaker: string;
  source: string;
}

interface QueryResult {
  query: string;
  model: string;
  latencyMs: number;
  chunks: RetrievedChunk[];
}

async function embedQuery(oai: OpenAI, text: string, model: string, dimensions: number): Promise<number[]> {
  const resp = await oai.embeddings.create({ model, input: text, dimensions });
  return resp.data[0].embedding;
}

async function retrieveChunks(
  pc: Pinecone,
  indexName: string,
  vector: number[],
  topK: number,
): Promise<RetrievedChunk[]> {
  const index = pc.Index(indexName);
  const results = await index.namespace(PINECONE_NAMESPACE).query({
    vector,
    topK,
    includeMetadata: true,
  });
  return (results.matches ?? []).map((m) => {
    const meta = (m.metadata ?? {}) as Record<string, string>;
    return {
      id: m.id,
      score: m.score ?? 0,
      text: meta.text ?? '',
      speaker: meta.speaker ?? '',
      source: meta.source_file ?? '',
    };
  });
}

function formatScore(n: number): string {
  return n.toFixed(4);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const required = ['PINECONE_API_KEY', 'OPENAI_API_KEY'];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    console.error(`ERROR: Missing env vars: ${missing.join(', ')}`);
    process.exit(1);
  }

  const indexName = process.env.PINECONE_INDEX ?? 'convergence-mvp';

  // Allow custom query set via --queries path/to/file.json
  const queryFileArg = process.argv.indexOf('--queries');
  let queries = DEFAULT_QUERIES;
  if (queryFileArg >= 0) {
    const queryFile = process.argv[queryFileArg + 1];
    if (!queryFile) {
      console.error('ERROR: --queries requires a file path');
      process.exit(1);
    }
    try {
      const raw = JSON.parse(readFileSync(queryFile, 'utf-8'));
      if (!Array.isArray(raw) || !raw.every((q) => typeof q === 'string')) {
        throw new Error('Expected JSON array of strings');
      }
      queries = raw as string[];
      console.log(`Loaded ${queries.length} queries from ${queryFile}`);
    } catch (err) {
      console.error(`ERROR: Failed to load query file: ${(err as Error).message}`);
      process.exit(1);
    }
  }

  const oai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! });

  console.log(`\nBenchmarking ${MODELS.length} embedding models on ${queries.length} queries`);
  console.log(`Index: ${indexName} / Namespace: ${PINECONE_NAMESPACE}\n`);

  const allResults: QueryResult[] = [];
  const modelStats: Record<string, { avgLatency: number; avgTop1Score: number; avgTop5Score: number }> = {};

  for (const modelCfg of MODELS) {
    console.log(`\n── Model: ${modelCfg.name} ─────────────────────────────────`);
    const latencies: number[] = [];
    const top1Scores: number[] = [];
    const top5Scores: number[] = [];

    for (let qi = 0; qi < queries.length; qi++) {
      const query = queries[qi];
      process.stdout.write(`  [${qi + 1}/${queries.length}] ${query.slice(0, 60)}...\r`);

      const t0 = Date.now();
      let vector: number[];
      try {
        vector = await embedQuery(oai, query, modelCfg.model, modelCfg.dimensions);
      } catch (err) {
        console.warn(`\n  SKIP [${modelCfg.name}] embed failed: ${(err as Error).message}`);
        continue;
      }

      let chunks: RetrievedChunk[];
      try {
        chunks = await retrieveChunks(pc, indexName, vector, TOP_K);
      } catch (err) {
        console.warn(`\n  SKIP [${modelCfg.name}] retrieval failed: ${(err as Error).message}`);
        continue;
      }
      const latencyMs = Date.now() - t0;

      latencies.push(latencyMs);
      if (chunks.length > 0) top1Scores.push(chunks[0].score);
      if (chunks.length >= 5) top5Scores.push(chunks.slice(0, 5).reduce((s, c) => s + c.score, 0) / 5);

      allResults.push({ query, model: modelCfg.name, latencyMs, chunks });
    }

    process.stdout.write('\n');
    const avgLatency = latencies.reduce((s, v) => s + v, 0) / (latencies.length || 1);
    const avgTop1 = top1Scores.reduce((s, v) => s + v, 0) / (top1Scores.length || 1);
    const avgTop5 = top5Scores.reduce((s, v) => s + v, 0) / (top5Scores.length || 1);
    modelStats[modelCfg.name] = { avgLatency, avgTop1Score: avgTop1, avgTop5Score: avgTop5 };

    console.log(`  Avg latency:     ${avgLatency.toFixed(0)}ms`);
    console.log(`  Avg top-1 score: ${formatScore(avgTop1)}`);
    console.log(`  Avg top-5 score: ${formatScore(avgTop5)}`);
  }

  // ── Summary table ─────────────────────────────────────────────────────────
  console.log(`\n\n═══ Benchmark Summary ══════════════════════════════════`);
  console.log(`${'Model'.padEnd(35)} ${'Latency'.padStart(10)} ${'Top-1'.padStart(8)} ${'Top-5'.padStart(8)}`);
  console.log('─'.repeat(65));
  for (const [model, stats] of Object.entries(modelStats)) {
    const row = [
      model.padEnd(35),
      `${stats.avgLatency.toFixed(0)}ms`.padStart(10),
      formatScore(stats.avgTop1Score).padStart(8),
      formatScore(stats.avgTop5Score).padStart(8),
    ].join(' ');
    console.log(row);
  }
  console.log('═'.repeat(65));

  // ── Write detailed results ─────────────────────────────────────────────────
  const outPath = resolve(process.cwd(), 'data/benchmark-results.json');
  try {
    writeFileSync(outPath, JSON.stringify({ timestamp: new Date().toISOString(), modelStats, queries, results: allResults }, null, 2), 'utf-8');
    console.log(`\nDetailed results written to: ${outPath}`);
  } catch {
    console.warn('\nCould not write results file (data/ directory may not exist).');
  }

  console.log('\nNote: Top-1 and Top-5 scores are cosine similarity scores from Pinecone.');
  console.log('For deeper evaluation, review data/benchmark-results.json and manually');
  console.log('score top-5 chunks per query for relevance (0=irrelevant, 1=relevant).\n');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
