/**
 * scripts/rag-benchmark.ts
 *
 * RAG retrieval accuracy benchmark for the Waking Up Q&A corpus.
 * Tests two pipeline configurations:
 *   1. NEW (post-OLU-440): text-embedding-3-large, waking-up + waking-up-summaries namespaces
 *   2. BASELINE (pre-OLU-440): text-embedding-3-small, __default__ namespace
 *
 * Runs 20 test queries, captures top-6 retrieved chunks, outputs JSON for scoring.
 *
 * Usage:
 *   npx tsx scripts/rag-benchmark.ts              # auto-detect (tries new, falls back to baseline)
 *   npx tsx scripts/rag-benchmark.ts --new        # force new pipeline
 *   npx tsx scripts/rag-benchmark.ts --baseline   # force baseline pipeline
 *
 * Requires (in .env.local or environment):
 *   PINECONE_API_KEY, PINECONE_INDEX, OPENAI_API_KEY
 * Optional:
 *   COHERE_API_KEY (enables Cohere re-ranking)
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
import { CohereClient } from 'cohere-ai';

// ── Pipeline configs ──────────────────────────────────────────────────────────

const CONFIGS = {
  new: {
    label: 'POST-OLU-440 (text-embedding-3-large, waking-up namespace)',
    embedModel: 'text-embedding-3-large',
    embedDimensions: 1536,
    namespace: 'waking-up',
    summaryNamespace: 'waking-up-summaries',
  },
  baseline: {
    label: 'BASELINE (text-embedding-3-small, __default__ namespace)',
    embedModel: 'text-embedding-3-small',
    embedDimensions: 1536,
    namespace: '',
    summaryNamespace: null,
  },
} as const;

type PipelineMode = keyof typeof CONFIGS;

// ── 20 Benchmark queries ──────────────────────────────────────────────────────
// Covers: teacher-specific, general conceptual, practice-oriented, edge cases.

const QUERIES = [
  // Teacher-specific (5)
  { id: 'Q01', query: 'What does Sam Harris say about the default mode network?' },
  { id: 'Q02', query: 'What does Adyashanti teach about the end of suffering?' },
  { id: 'Q03', query: 'How does Tara Brach describe the practice of RAIN?' },
  { id: 'Q04', query: 'What does Joseph Goldstein say about insight meditation?' },
  { id: 'Q05', query: 'How does Rupert Spira describe the experience of pure awareness?' },

  // General / conceptual (5)
  { id: 'Q06', query: 'What is non-self?' },
  { id: 'Q07', query: 'What is the relationship between love and emptiness in meditation?' },
  { id: 'Q08', query: 'How do you rest in awareness without effort?' },
  { id: 'Q09', query: 'Can you be aware of awareness itself?' },
  { id: 'Q10', query: 'What is the difference between mindfulness and concentration?' },

  // Practice-oriented (5)
  { id: 'Q11', query: 'How do I work with fear and difficult emotions in meditation?' },
  { id: 'Q12', query: 'What is the pointing out instruction in Dzogchen or rigpa?' },
  { id: 'Q13', query: 'How do I integrate meditation insights into daily life?' },
  { id: 'Q14', query: 'What happens at the moment of awakening?' },
  { id: 'Q15', query: 'How can I stop identifying with my thoughts?' },

  // Edge cases / abstract / short (5)
  { id: 'Q16', query: 'What is non-dual awareness?' },
  { id: 'Q17', query: 'Is enlightenment permanent?' },
  { id: 'Q18', query: 'What is consciousness?' },
  { id: 'Q19', query: 'Suffering' },
  { id: 'Q20', query: 'Choiceless awareness vs acceptance — what is the difference?' },
];

const TOP_K = 20;
const RERANK_TOP_N = 6;

// ── Types ─────────────────────────────────────────────────────────────────────

interface RetrievedChunk {
  rank: number;
  text: string;
  speaker: string;
  source: string;
  score: number;
}

interface QueryResult {
  id: string;
  query: string;
  latencyMs: number;
  totalCandidates: number;
  rerankUsed: boolean;
  chunks: RetrievedChunk[];
  error?: string;
}

type PineconeMatch = { id: string; score?: number; metadata?: Record<string, string> };

// ── Helpers ───────────────────────────────────────────────────────────────────

async function embedQuery(oai: OpenAI, text: string, model: string, dimensions: number): Promise<number[]> {
  const resp = await oai.embeddings.create({ model, input: text, dimensions });
  return resp.data[0].embedding;
}

async function pineconeQuery(
  pc: Pinecone,
  indexName: string,
  vector: number[],
  namespace: string,
  topK: number,
): Promise<PineconeMatch[]> {
  const index = pc.Index(indexName);
  const result = await index.namespace(namespace).query({ vector, topK, includeMetadata: true });
  return (result.matches ?? []) as PineconeMatch[];
}

function mergeChunks(matches: PineconeMatch[]): Map<string, { text: string; speaker: string; source: string; score: number }> {
  const map = new Map<string, { text: string; speaker: string; source: string; score: number }>();
  for (const m of matches) {
    const meta = m.metadata ?? {};
    const text = (meta.text ?? '').trim();
    if (!text || (m.score ?? 0) < 0.4) continue;
    const existing = map.get(text);
    if (!existing || (m.score ?? 0) > existing.score) {
      map.set(text, { text, speaker: meta.speaker ?? '', source: meta.source_file ?? '', score: m.score ?? 0 });
    }
  }
  return map;
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
  const cohereKey = process.env.COHERE_API_KEY;

  const oai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! });
  const cohere = cohereKey ? new CohereClient({ token: cohereKey }) : null;

  // ── Detect corpus state ──────────────────────────────────────────────────
  const stats = await pc.Index(indexName).describeIndexStats();
  const namespaces = stats.namespaces as Record<string, { recordCount?: number; vectorCount?: number }> ?? {};
  const wakingUpCount = namespaces['waking-up']?.recordCount ?? namespaces['waking-up']?.vectorCount ?? 0;
  const defaultCount = namespaces['']?.recordCount ?? namespaces['']?.vectorCount ?? namespaces['__default__']?.recordCount ?? 0;

  console.log('\n═══ Pinecone corpus state ══════════════════════════════════');
  console.log(`  waking-up namespace:    ${wakingUpCount.toLocaleString()} vectors`);
  console.log(`  __default__ namespace:  ${defaultCount.toLocaleString()} vectors`);
  console.log(`  Total:                  ${(stats.totalRecordCount ?? 0).toLocaleString()} vectors`);

  // Determine mode from CLI flag or auto-detect
  const forceNew = process.argv.includes('--new');
  const forceBaseline = process.argv.includes('--baseline');
  let mode: PipelineMode;
  if (forceNew) {
    mode = 'new';
  } else if (forceBaseline) {
    mode = 'baseline';
  } else {
    // Auto-detect: use new if waking-up namespace has data, else baseline
    mode = wakingUpCount > 0 ? 'new' : 'baseline';
    console.log(`\nAuto-detected mode: ${mode} (${wakingUpCount > 0 ? 'waking-up namespace populated' : 'waking-up namespace empty, using baseline'})`);
  }

  const cfg = CONFIGS[mode];

  console.log(`\n═══ RAG Benchmark — ${QUERIES.length} queries ══════════════════════════════`);
  console.log(`  Pipeline: ${cfg.label}`);
  console.log(`  Index:    ${indexName}`);
  console.log(`  Re-rank:  ${cohere ? 'Cohere rerank-v3.5' : 'disabled (cosine order)'}`);
  console.log('─'.repeat(75));

  const results: QueryResult[] = [];

  for (const { id, query } of QUERIES) {
    process.stdout.write(`[${id}] ${query.slice(0, 52).padEnd(52)} ... `);
    const t0 = Date.now();

    try {
      const vector = await embedQuery(oai, query, cfg.embedModel, cfg.embedDimensions);

      let allMatches: PineconeMatch[];
      if (cfg.summaryNamespace) {
        const [raw, summary] = await Promise.all([
          pineconeQuery(pc, indexName, vector, cfg.namespace, TOP_K),
          pineconeQuery(pc, indexName, vector, cfg.summaryNamespace, TOP_K).catch(() => [] as PineconeMatch[]),
        ]);
        allMatches = [...raw, ...summary];
      } else {
        allMatches = await pineconeQuery(pc, indexName, vector, cfg.namespace, TOP_K);
      }

      const chunkMap = mergeChunks(allMatches);
      const allChunks = Array.from(chunkMap.values()).sort((a, b) => b.score - a.score);

      let finalChunks: typeof allChunks;
      let rerankUsed = false;
      if (cohere && allChunks.length > 3) {
        try {
          const rerankResult = await cohere.rerank({
            model: 'rerank-v3.5',
            query,
            documents: allChunks.map((c) => ({ text: c.text })),
            topN: Math.min(RERANK_TOP_N, allChunks.length),
            returnDocuments: false,
          });
          finalChunks = rerankResult.results.map((r) => ({ ...allChunks[r.index], score: r.relevanceScore }));
          rerankUsed = true;
        } catch {
          finalChunks = allChunks.slice(0, RERANK_TOP_N);
        }
      } else {
        finalChunks = allChunks.slice(0, RERANK_TOP_N);
      }

      const latencyMs = Date.now() - t0;
      results.push({
        id,
        query,
        latencyMs,
        totalCandidates: allChunks.length,
        rerankUsed,
        chunks: finalChunks.map((c, i) => ({ rank: i + 1, ...c })),
      });

      const summary = finalChunks.length > 0
        ? `${allChunks.length} candidates → ${finalChunks.length} final  top-score=${finalChunks[0]?.score.toFixed(3)}`
        : '0 results';
      console.log(`${latencyMs}ms  ${summary}`);
    } catch (err) {
      const latencyMs = Date.now() - t0;
      console.log(`ERROR: ${(err as Error).message}`);
      results.push({ id, query, latencyMs, totalCandidates: 0, rerankUsed: false, chunks: [], error: (err as Error).message });
    }

    await new Promise((r) => setTimeout(r, 200));
  }

  // ── Summary stats ─────────────────────────────────────────────────────────
  const avgLatency = results.reduce((s, r) => s + r.latencyMs, 0) / results.length;
  const withResults = results.filter((r) => r.chunks.length > 0);
  const avgTopScore = withResults.length > 0
    ? withResults.reduce((s, r) => s + (r.chunks[0]?.score ?? 0), 0) / withResults.length
    : 0;

  console.log('\n─'.repeat(75));
  console.log(`  Queries with results: ${withResults.length}/${results.length}`);
  console.log(`  Avg latency:          ${avgLatency.toFixed(0)}ms`);
  console.log(`  Avg top-1 score:      ${avgTopScore.toFixed(3)}`);

  // ── Write raw results JSON ────────────────────────────────────────────────
  const outDir = resolve(process.cwd(), 'research');
  mkdirSync(outDir, { recursive: true });
  const rawPath = resolve(outDir, 'rag-benchmark-raw.json');
  writeFileSync(rawPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    mode,
    pipeline: cfg.label,
    indexName,
    corpusState: { wakingUpVectors: wakingUpCount, defaultVectors: defaultCount },
    rerankEnabled: !!cohere,
    summary: { totalQueries: results.length, queriesWithResults: withResults.length, avgLatencyMs: Math.round(avgLatency), avgTopScore: Number(avgTopScore.toFixed(4)) },
    results,
  }, null, 2), 'utf-8');

  console.log(`\nRaw results → ${rawPath}`);
  console.log('Next: review chunks in the JSON, add relevance scores, compute precision@3.');
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
