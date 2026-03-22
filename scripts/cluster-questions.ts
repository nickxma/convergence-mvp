/**
 * scripts/cluster-questions.ts
 *
 * Groups Q&A questions into topic clusters using k-means on OpenAI embeddings.
 *
 * What it does:
 *   1. Fetches all unique questions from `qa_answers`.
 *   2. Embeds each question using OpenAI text-embedding-3-small.
 *   3. Runs k-means clustering (k=10) using k-means++ initialization.
 *   4. For each cluster, takes the 5 most central questions and asks
 *      GPT-4o-mini to generate a 2-3 word topic label.
 *   5. Upserts results into `question_clusters` (idempotent — safe to re-run).
 *
 * Usage:
 *   pnpm cluster:questions
 *   # or directly:
 *   tsx scripts/cluster-questions.ts
 *
 * Requires (in .env.local or environment):
 *   OPENAI_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
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

import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';

// ── Config ────────────────────────────────────────────────────────────────────

const K = 10;            // number of clusters
const MAX_ITER = 100;    // k-means iteration cap
const EMBED_MODEL = 'text-embedding-3-small';
const LABEL_MODEL = 'gpt-4o-mini';
const EMBED_BATCH = 100; // questions per OpenAI embed call
const CENTROID_EXAMPLES = 5; // questions used to generate each label

// ── Helpers ───────────────────────────────────────────────────────────────────

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function distSq(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return sum;
}

// ── k-means++ initialization ──────────────────────────────────────────────────

function kMeansPlusPlusInit(points: number[][], k: number): number[][] {
  const centroids: number[][] = [];
  centroids.push(points[Math.floor(Math.random() * points.length)]);

  for (let ci = 1; ci < k; ci++) {
    const dists = points.map((p) => {
      let minD = Infinity;
      for (const c of centroids) {
        const d = distSq(p, c);
        if (d < minD) minD = d;
      }
      return minD;
    });

    const total = dists.reduce((a, b) => a + b, 0);
    let rand = Math.random() * total;
    let chosen = points.length - 1;
    for (let i = 0; i < points.length; i++) {
      rand -= dists[i];
      if (rand <= 0) {
        chosen = i;
        break;
      }
    }
    centroids.push(points[chosen]);
  }

  return centroids;
}

// ── k-means ───────────────────────────────────────────────────────────────────

function kMeans(
  points: number[][],
  k: number,
): { assignments: number[]; centroids: number[][] } {
  const dim = points[0].length;
  const centroids = kMeansPlusPlusInit(points, k);
  let assignments = new Array(points.length).fill(0);

  for (let iter = 0; iter < MAX_ITER; iter++) {
    // Assign each point to its nearest centroid
    const newAssignments = points.map((p) => {
      let best = 0;
      let bestDist = Infinity;
      for (let ci = 0; ci < k; ci++) {
        const d = distSq(p, centroids[ci]);
        if (d < bestDist) {
          bestDist = d;
          best = ci;
        }
      }
      return best;
    });

    // Check convergence
    let changed = false;
    for (let i = 0; i < points.length; i++) {
      if (newAssignments[i] !== assignments[i]) {
        changed = true;
        break;
      }
    }
    assignments = newAssignments;
    if (!changed) break;

    // Recompute centroids
    for (let ci = 0; ci < k; ci++) {
      const members = points.filter((_, i) => assignments[i] === ci);
      if (members.length === 0) continue; // keep stale centroid for empty cluster
      const newCentroid = new Array(dim).fill(0);
      for (const m of members) {
        for (let d = 0; d < dim; d++) newCentroid[d] += m[d];
      }
      for (let d = 0; d < dim; d++) newCentroid[d] /= members.length;
      centroids[ci] = newCentroid;
    }
  }

  return { assignments, centroids };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL ?? '';
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  }
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is required');
  }

  const db = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });
  const openai = new OpenAI();

  // 1. Fetch unique questions from qa_answers
  console.log('Fetching questions from qa_answers...');
  const { data: rows, error: fetchError } = await db
    .from('qa_answers')
    .select('question')
    .order('created_at', { ascending: false });

  if (fetchError) throw new Error(`DB fetch error: ${fetchError.message}`);

  const seen = new Set<string>();
  const questions: string[] = [];
  for (const row of rows ?? []) {
    const q = (row.question as string).trim();
    if (q && !seen.has(q)) {
      seen.add(q);
      questions.push(q);
    }
  }

  console.log(`Found ${questions.length} unique questions`);

  if (questions.length < K) {
    console.warn(
      `Only ${questions.length} questions — need at least ${K} to form ${K} clusters. Aborting.`,
    );
    process.exit(0);
  }

  // 2. Embed questions in batches
  console.log(
    `Embedding ${questions.length} questions (batch size ${EMBED_BATCH})...`,
  );
  const embeddings: number[][] = [];
  for (let start = 0; start < questions.length; start += EMBED_BATCH) {
    const batch = questions.slice(start, start + EMBED_BATCH);
    const resp = await openai.embeddings.create({ model: EMBED_MODEL, input: batch });
    // OpenAI returns embeddings in the same order as input
    for (const item of resp.data.sort((a, b) => a.index - b.index)) {
      embeddings.push(item.embedding);
    }
    process.stdout.write(
      `  ${Math.min(start + EMBED_BATCH, questions.length)}/${questions.length}\r`,
    );
  }
  console.log('\nEmbeddings complete.');

  // 3. k-means clustering
  console.log(`Running k-means (k=${K}, max_iter=${MAX_ITER})...`);
  const { assignments, centroids } = kMeans(embeddings, K);

  // 4. Generate a label for each cluster
  console.log('Generating cluster labels...');
  const clusterLabels: string[] = [];

  for (let ci = 0; ci < K; ci++) {
    const memberIndices = assignments
      .map((a, i) => (a === ci ? i : -1))
      .filter((i) => i >= 0);

    if (memberIndices.length === 0) {
      clusterLabels.push(`Cluster ${ci}`);
      continue;
    }

    // Pick the N questions closest to the centroid
    const centroid = centroids[ci];
    const ranked = memberIndices
      .map((idx) => ({ idx, dist: distSq(embeddings[idx], centroid) }))
      .sort((a, b) => a.dist - b.dist)
      .slice(0, CENTROID_EXAMPLES);

    const examples = ranked.map(({ idx }) => `- ${questions[idx]}`).join('\n');

    const completion = await openai.chat.completions.create({
      model: LABEL_MODEL,
      messages: [
        {
          role: 'user',
          content:
            'These questions share a common theme. Create a concise 2-3 word topic label that captures their essence.\n\n' +
            `Questions:\n${examples}\n\n` +
            'Respond with ONLY the label, nothing else. Examples of good labels: "Meditation practice", "Nature of self", "Managing anxiety".',
        },
      ],
      max_tokens: 20,
      temperature: 0.3,
    });

    const label =
      completion.choices[0]?.message?.content?.trim() ?? `Cluster ${ci}`;
    clusterLabels.push(label);
    console.log(`  [${ci}] "${label}" — ${memberIndices.length} questions`);
  }

  // 5. Upsert into question_clusters (idempotent)
  console.log('\nUpserting into question_clusters...');

  const upsertRows = questions.map((q, i) => ({
    question_hash: sha256(q),
    question_text: q,
    cluster_id: assignments[i],
    cluster_label: clusterLabels[assignments[i]],
    updated_at: new Date().toISOString(),
  }));

  const { error: upsertError } = await db
    .from('question_clusters')
    .upsert(upsertRows, { onConflict: 'question_hash' });

  if (upsertError) throw new Error(`Upsert failed: ${upsertError.message}`);

  console.log(`\nDone. ${questions.length} questions upserted across ${K} clusters.`);
  console.log('\nCluster summary:');
  for (let ci = 0; ci < K; ci++) {
    const count = assignments.filter((a) => a === ci).length;
    console.log(`  [${ci}] "${clusterLabels[ci]}" — ${count} questions`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
