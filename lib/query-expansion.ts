/**
 * lib/query-expansion.ts
 *
 * Short-query expansion + Reciprocal Rank Fusion for RAG retrieval.
 *
 * Problem: single-word and very short abstract queries ("consciousness", "suffering",
 * "What is non-self?") match conversational fragments rather than substantive chunks
 * because the query embedding is too sparse to discriminate.
 *
 * Solution:
 *   1. Detect short queries (≤ 3 words).
 *   2. Expand to 3 richer phrasings via GPT-4o.
 *   3. Embed all phrasings + original query (4 vectors total).
 *   4. Retrieve top-K chunks per vector from Pinecone.
 *   5. Merge with Reciprocal Rank Fusion — boosts chunks that rank well
 *      across multiple phrasings, demoting lucky one-hit fragments.
 */

import OpenAI from 'openai';

export const EXPANSION_WORD_THRESHOLD = 3;

export interface RankedChunk {
  text: string;
  speaker: string;
  source: string;
  score: number;
  chunkId?: string;
  sourceUrl?: string;
}

/**
 * Returns true when the query is short enough to benefit from expansion.
 * Counts whitespace-separated tokens; punctuation-only tokens are ignored.
 */
export function shouldExpandQuery(query: string): boolean {
  const words = query.trim().split(/\s+/).filter((w) => /\w/.test(w));
  return words.length <= EXPANSION_WORD_THRESHOLD;
}

/**
 * Use GPT-4o to rewrite a short/abstract query into 3 richer phrasings.
 * Returns the original query plus the 3 expansions (4 strings total).
 * Falls back to [original] on error so callers can always embed at least one vector.
 */
export async function expandQuery(query: string, oai: OpenAI): Promise<string[]> {
  const prompt = `You are helping improve a semantic search system over mindfulness and meditation transcripts.

The user asked: "${query}"

This query is very short or abstract. Rewrite it as 3 longer, richer phrasings that will retrieve more relevant and substantive content. Each rephrasing should:
- Be a complete question or descriptive phrase (10–20 words)
- Target specific teaching content, not conversational fragments
- Vary in angle (conceptual, practical, teacher-specific)

Return a JSON object with a single key "phrasings" containing an array of 3 strings.
Example: {"phrasings": ["phrasing 1", "phrasing 2", "phrasing 3"]}`;

  try {
    const resp = await oai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.4,
      max_tokens: 250,
      response_format: { type: 'json_object' },
    });
    const raw = resp.choices[0]?.message?.content ?? '{}';
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    // Try common wrapper keys, then fall back to first array value in the object
    const arr: unknown = parsed.phrasings ?? parsed.expansions ?? parsed.results ??
      Object.values(parsed).find((v) => Array.isArray(v));
    if (Array.isArray(arr) && arr.length > 0) {
      const expansions = (arr as unknown[]).slice(0, 3).map(String).filter(Boolean);
      if (expansions.length > 0) return [query, ...expansions];
    }
  } catch (err) {
    console.warn(`[query-expansion] expand_failed query="${query}" err=${err instanceof Error ? err.message : String(err)}`);
  }
  return [query];
}

/**
 * Reciprocal Rank Fusion across multiple ranked lists of chunks.
 *
 * RRF score for a document d = Σ 1/(k + rank_i(d))  for each list i that contains d.
 * k=60 is the standard smoothing constant (prevents over-weighting rank-1 results).
 *
 * Chunks that appear in the top ranks of multiple phrasing retrievals bubble up;
 * conversational fragments that only match one phrasing are demoted.
 *
 * Returns chunks sorted by descending RRF score, normalised to [0, 1].
 */
export function reciprocalRankFusion(
  rankings: RankedChunk[][],
  k = 60,
): RankedChunk[] {
  const rrfScores = new Map<string, number>();
  const chunkByText = new Map<string, RankedChunk>();

  for (const ranking of rankings) {
    ranking.forEach((chunk, idx) => {
      const rank = idx + 1; // 1-indexed
      const prev = rrfScores.get(chunk.text) ?? 0;
      rrfScores.set(chunk.text, prev + 1 / (k + rank));
      if (!chunkByText.has(chunk.text)) {
        chunkByText.set(chunk.text, chunk);
      }
    });
  }

  const sorted = Array.from(rrfScores.entries())
    .sort((a, b) => b[1] - a[1]);

  if (sorted.length === 0) return [];

  // Normalise to [0, 1] using the max RRF score
  const maxScore = sorted[0][1];

  return sorted.map(([text, rrfScore]) => ({
    ...chunkByText.get(text)!,
    score: maxScore > 0 ? rrfScore / maxScore : 0,
  }));
}

/**
 * Multi-query variant generation for any query length (OLU-693).
 *
 * Produces 3 semantically-distinct reformulations:
 *   1. Different perspective — same question reframed from another angle
 *   2. Simpler — plain-language version a beginner would ask
 *   3. More technical — precise meditation / Buddhist / neuroscience terminology
 *
 * Returns exactly 3 variant strings, or [] on error so callers can fall back
 * to single-query retrieval gracefully.
 */
export async function generateQueryVariants(query: string, oai: OpenAI): Promise<string[]> {
  const prompt = `You are improving a semantic search system over mindfulness and meditation transcripts.

Original query: "${query}"

Generate exactly 3 reformulations to improve retrieval coverage:
1. Different perspective: same core question from a different angle or framing
2. Simpler: plain-language version a beginner would ask
3. More technical: version using precise meditation, Buddhist, or neuroscience terminology

Return a JSON object: {"variants": ["different perspective version", "simpler version", "more technical version"]}`;

  try {
    const resp = await oai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.4,
      max_tokens: 300,
      response_format: { type: 'json_object' },
    });
    const raw = resp.choices[0]?.message?.content ?? '{}';
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const arr: unknown = parsed.variants ?? parsed.phrasings ?? parsed.reformulations ??
      Object.values(parsed).find((v) => Array.isArray(v));
    if (Array.isArray(arr) && arr.length > 0) {
      const variants = (arr as unknown[]).slice(0, 3).map(String).filter(Boolean);
      if (variants.length > 0) return variants;
    }
  } catch (err) {
    console.warn(`[query-expansion] generate_variants_failed query="${query}" err=${err instanceof Error ? err.message : String(err)}`);
  }
  return [];
}

/**
 * Reciprocal Rank Fusion keyed by chunkId rather than text (preferred for multi-query).
 *
 * Uses chunkId as the deduplication key so chunks retrieved by different query variants
 * but referencing the same underlying passage are correctly merged. Falls back to text
 * as key when chunkId is absent.
 *
 * Returns chunks sorted by descending RRF score, normalised to [0, 1].
 */
export function reciprocalRankFusionByChunkId(
  rankings: RankedChunk[][],
  k = 60,
): RankedChunk[] {
  const rrfScores = new Map<string, number>();
  const chunkByKey = new Map<string, RankedChunk>();

  for (const ranking of rankings) {
    ranking.forEach((chunk, idx) => {
      const key = chunk.chunkId ?? chunk.text;
      const rank = idx + 1;
      const prev = rrfScores.get(key) ?? 0;
      rrfScores.set(key, prev + 1 / (k + rank));
      if (!chunkByKey.has(key)) {
        chunkByKey.set(key, chunk);
      }
    });
  }

  const sorted = Array.from(rrfScores.entries())
    .sort((a, b) => b[1] - a[1]);

  if (sorted.length === 0) return [];

  const maxScore = sorted[0][1];

  return sorted.map(([key, rrfScore]) => ({
    ...chunkByKey.get(key)!,
    score: maxScore > 0 ? rrfScore / maxScore : 0,
  }));
}

/**
 * HyDE (Hypothetical Document Embedding) — generate a plausible answer document
 * for the given query (OLU-695). The resulting text is embedded instead of the raw
 * query, providing a richer representation that better matches substantive transcript
 * chunks.
 *
 * Key insight: real answer documents live in the same semantic space as retrieved
 * chunks. Embedding a hypothetical answer bridges the vocabulary gap between abstract
 * queries ("consciousness", "non-self") and the concrete language found in teaching
 * transcripts — so the embedding starts in answer-space rather than question-space.
 *
 * Returns null on error so callers can fall back to direct query embedding gracefully.
 */
export async function generateHypotheticalDocument(query: string, oai: OpenAI): Promise<string | null> {
  const prompt = `You are a knowledgeable mindfulness and meditation teacher. A student has asked:

"${query}"

Write a concise, substantive answer (2-3 sentences) as if explaining to an experienced meditator. Use the vocabulary and phrasing found in meditation teaching transcripts — direct, contemplative, specific. Do not use markdown or lists. Return only the answer text.`;

  try {
    const resp = await oai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 120,
    });
    const doc = resp.choices[0]?.message?.content?.trim() ?? '';
    if (doc.length > 10) return doc;
  } catch (err) {
    console.warn(`[query-expansion] hyde_failed query="${query}" err=${err instanceof Error ? err.message : String(err)}`);
  }
  return null;
}

/**
 * Full expanded retrieval pipeline for a single query.
 *
 * 1. Expand query (if short) → up to 4 phrasings
 * 2. Embed all phrasings via the caller-supplied embedFn
 * 3. For each phrasing: retrieve top-K via caller-supplied retrieveFn
 * 4. Apply RRF across all per-phrasing ranked lists
 * 5. Return top-N fused results
 *
 * If expansion is skipped (query is long enough), falls back to single-phrasing retrieval.
 *
 * The caller owns embedding and retrieval so this module has no service dependencies
 * and can be used from both Next.js routes and standalone scripts.
 */
export async function expandedRetrieve(opts: {
  query: string;
  oai: OpenAI;
  embedFn: (texts: string[]) => Promise<number[][]>;
  retrieveFn: (vector: number[]) => Promise<RankedChunk[]>;
  topN: number;
}): Promise<{ chunks: RankedChunk[]; expanded: boolean; phrasings: string[] }> {
  const { query, oai, embedFn, retrieveFn, topN } = opts;

  const phrasings = shouldExpandQuery(query) ? await expandQuery(query, oai) : [query];
  const expanded = phrasings.length > 1;

  // Embed all phrasings via the caller-supplied function
  const vectors = await embedFn(phrasings);

  // Retrieve per-phrasing
  const rankings = await Promise.all(vectors.map((v) => retrieveFn(v)));

  if (!expanded || rankings.length === 1) {
    return { chunks: rankings[0].slice(0, topN), expanded: false, phrasings };
  }

  const fused = reciprocalRankFusion(rankings);
  return { chunks: fused.slice(0, topN), expanded: true, phrasings };
}
