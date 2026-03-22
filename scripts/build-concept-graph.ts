/**
 * scripts/build-concept-graph.ts
 *
 * Builds a lightweight concept knowledge graph from chunks.jsonl.
 * Populates the `concepts`, `concept_teachers`, `concept_relations`, and
 * `chunk_concepts` tables in Supabase (migration 037_concept_graph.sql).
 *
 * What it does:
 *   1. Reads chunks from chunks.jsonl (or a subset via --max-chunks flag)
 *   2. Batches chunks and calls GPT-4o-mini to extract concepts per chunk
 *   3. Deduplicates concepts by normalized name, upserts into `concepts`
 *   4. Embeds concept names with text-embedding-3-small for semantic search
 *   5. Writes chunk→concept edges into `chunk_concepts`
 *   6. Generates teacher×concept perspective summaries
 *   7. Detects inter-concept relationships via co-occurrence + LLM judgment
 *
 * Usage:
 *   tsx scripts/build-concept-graph.ts
 *   tsx scripts/build-concept-graph.ts --max-chunks 500   # prototype subset
 *   tsx scripts/build-concept-graph.ts --skip-relations    # skip relation extraction
 *
 * Requires (in .env.local or environment):
 *   OPENAI_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

import { readFileSync, existsSync } from 'node:fs';
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

const EMBED_MODEL = 'text-embedding-3-small';
const CHAT_MODEL = 'gpt-4o-mini';
const EMBED_BATCH_SIZE = 100;   // concept names per embedding call
const EXTRACT_BATCH_SIZE = 20;  // chunks per concept-extraction LLM call
const PERSPECTIVE_BATCH_SIZE = 10; // chunks per perspective-summary LLM call
const CHUNKS_FILE = resolve(process.cwd(), 'scripts/chunks.jsonl');
const MAX_CONCEPTS_PER_CHUNK = 7;

// CLI flags
const args = process.argv.slice(2);
const maxChunks = (() => {
  const idx = args.indexOf('--max-chunks');
  return idx !== -1 ? parseInt(args[idx + 1], 10) : Infinity;
})();
const skipRelations = args.includes('--skip-relations');

// ── Types ─────────────────────────────────────────────────────────────────────

interface RawChunk {
  id?: string;              // Pinecone vector ID (source_file#chunk_index)
  text: string;
  speaker: string;
  source_file: string;
  chunk_index: number;
  metadata?: Record<string, unknown>;
}

interface ExtractedConcept {
  name: string;
  relevance: number; // 0.0–1.0
}

interface ConceptRow {
  id: string;
  name: string;
  normalized_name: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function normalize(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, ' ');
}

function chunkId(c: RawChunk): string {
  return c.id ?? `${c.source_file}#${c.chunk_index}`;
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Extract concepts from a batch of chunks via a single GPT-4o-mini call. */
async function extractConceptsForBatch(
  oai: OpenAI,
  chunks: RawChunk[],
): Promise<Array<{ chunkId: string; concepts: ExtractedConcept[] }>> {
  const prompt = chunks
    .map(
      (c, i) =>
        `[Chunk ${i + 1}] Speaker: ${c.speaker}\n"${c.text.slice(0, 600)}"`,
    )
    .join('\n\n---\n\n');

  const systemMsg = `You extract philosophical/contemplative concepts from meditation teacher transcripts.
For each chunk, return a JSON array of the most relevant concepts (${MAX_CONCEPTS_PER_CHUNK} max).
Focus on: states of consciousness, practices, teachings, psychological concepts, metaphysical ideas.
Examples: "non-self", "awareness", "impermanence", "free will", "suffering", "meditation", "mindfulness", "equanimity"

Return ONLY valid JSON in this exact format:
[
  { "chunkIndex": 1, "concepts": [{"name": "...", "relevance": 0.9}, ...] },
  ...
]
No explanation, no markdown fences.`;

  let raw: string;
  try {
    const resp = await oai.chat.completions.create({
      model: CHAT_MODEL,
      messages: [
        { role: 'system', content: systemMsg },
        { role: 'user', content: `Extract concepts from these ${chunks.length} chunks:\n\n${prompt}` },
      ],
      temperature: 0,
      response_format: { type: 'json_object' },
    });
    raw = resp.choices[0]?.message?.content ?? '[]';
  } catch (err) {
    console.warn(`  [extract] LLM call failed: ${err instanceof Error ? err.message : String(err)}`);
    return chunks.map((c) => ({ chunkId: chunkId(c), concepts: [] }));
  }

  try {
    // Model sometimes wraps in {"result": [...]} or returns array directly
    const parsed = JSON.parse(raw);
    const arr: Array<{ chunkIndex: number; concepts: ExtractedConcept[] }> =
      Array.isArray(parsed) ? parsed : (parsed.result ?? parsed.chunks ?? Object.values(parsed)[0] ?? []);

    return arr.map((item) => ({
      chunkId: chunkId(chunks[item.chunkIndex - 1] ?? chunks[0]),
      concepts: (item.concepts ?? []).filter(
        (c: ExtractedConcept) => c.name && typeof c.relevance === 'number',
      ),
    }));
  } catch {
    console.warn(`  [extract] JSON parse failed, skipping batch`);
    return chunks.map((c) => ({ chunkId: chunkId(c), concepts: [] }));
  }
}

/** Generate a 2-sentence perspective summary for a teacher×concept pair. */
async function generatePerspectiveSummary(
  oai: OpenAI,
  concept: string,
  teacher: string,
  sampleChunks: RawChunk[],
): Promise<string> {
  const excerpts = sampleChunks
    .slice(0, PERSPECTIVE_BATCH_SIZE)
    .map((c) => `"${c.text.slice(0, 400)}"`)
    .join('\n\n');

  try {
    const resp = await oai.chat.completions.create({
      model: CHAT_MODEL,
      messages: [
        {
          role: 'system',
          content: `You write concise 1-2 sentence summaries of how a specific teacher discusses a concept.
Be specific, grounded in the excerpts. Avoid generic platitudes.`,
        },
        {
          role: 'user',
          content: `Concept: "${concept}"\nTeacher: "${teacher}"\n\nExcerpts:\n${excerpts}\n\nWrite a 1-2 sentence summary of how ${teacher} discusses "${concept}".`,
        },
      ],
      temperature: 0.3,
      max_tokens: 150,
    });
    return resp.choices[0]?.message?.content?.trim() ?? '';
  } catch {
    return '';
  }
}

/** Detect concept relations from high-co-occurrence pairs via LLM. */
async function detectRelations(
  oai: OpenAI,
  conceptPairs: Array<{ a: string; b: string; coOccurrences: number }>,
): Promise<Array<{ fromName: string; toName: string; relationType: string; strength: number }>> {
  if (conceptPairs.length === 0) return [];

  const pairList = conceptPairs
    .slice(0, 30) // cap to avoid huge prompts
    .map((p, i) => `${i + 1}. "${p.a}" ↔ "${p.b}" (co-occurrences: ${p.coOccurrences})`)
    .join('\n');

  const systemMsg = `You analyze relationships between contemplative/philosophical concepts.
For each concept pair, determine the primary relationship type:
- "subtopic_of": one concept is a specific instance of the other (e.g., "vipassana" subtopic_of "meditation")
- "builds_on": understanding A typically requires or follows B
- "contrasts_with": concepts are commonly discussed as opposing or complementary
- "agrees_with": concepts are consistently discussed as reinforcing the same insight

Return ONLY valid JSON array:
[{"fromConcept": "...", "toConcept": "...", "relationType": "...", "strength": 0.0-1.0}, ...]
Only include pairs where you're confident in the relationship. Omit unclear pairs.`;

  try {
    const resp = await oai.chat.completions.create({
      model: CHAT_MODEL,
      messages: [
        { role: 'system', content: systemMsg },
        { role: 'user', content: `Analyze these concept pairs:\n${pairList}` },
      ],
      temperature: 0,
      response_format: { type: 'json_object' },
    });
    const raw = resp.choices[0]?.message?.content ?? '[]';
    const parsed = JSON.parse(raw);
    const arr = Array.isArray(parsed) ? parsed : (Object.values(parsed)[0] as unknown[] ?? []);
    return (arr as Array<{ fromConcept: string; toConcept: string; relationType: string; strength: number }>)
      .filter(
        (r) =>
          r.fromConcept &&
          r.toConcept &&
          ['subtopic_of', 'builds_on', 'contrasts_with', 'agrees_with'].includes(r.relationType),
      )
      .map((r) => ({
        fromName: normalize(r.fromConcept),
        toName: normalize(r.toConcept),
        relationType: r.relationType,
        strength: Math.min(1, Math.max(0, r.strength ?? 0.7)),
      }));
  } catch {
    return [];
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error('ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
    process.exit(1);
  }
  if (!openaiKey) {
    console.error('ERROR: OPENAI_API_KEY is required');
    process.exit(1);
  }

  if (!existsSync(CHUNKS_FILE)) {
    console.error(`ERROR: chunks.jsonl not found at ${CHUNKS_FILE}`);
    process.exit(1);
  }

  const db = createClient(supabaseUrl, supabaseKey);
  const oai = new OpenAI({ apiKey: openaiKey });

  // ── Load chunks ──────────────────────────────────────────────────────────
  console.log(`Loading chunks from ${CHUNKS_FILE}...`);
  const allChunks: RawChunk[] = readFileSync(CHUNKS_FILE, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as RawChunk);

  const chunks = isFinite(maxChunks) ? allChunks.slice(0, maxChunks) : allChunks;
  console.log(`Processing ${chunks.length.toLocaleString()} chunks (total: ${allChunks.length.toLocaleString()})`);

  // ── Phase 1: Concept extraction ──────────────────────────────────────────
  console.log('\n── Phase 1: Extracting concepts ──────────────────────────────');

  // Map: normalized concept name → { name, chunks: [{chunkId, speaker, relevance}] }
  const conceptMap = new Map<string, { name: string; chunks: Array<{ chunkId: string; speaker: string; relevance: number }> }>();

  for (let i = 0; i < chunks.length; i += EXTRACT_BATCH_SIZE) {
    const batch = chunks.slice(i, i + EXTRACT_BATCH_SIZE);
    const pct = ((i / chunks.length) * 100).toFixed(1);
    process.stdout.write(`  Extracting: ${i + batch.length}/${chunks.length} (${pct}%)...\r`);

    const results = await extractConceptsForBatch(oai, batch);

    for (let j = 0; j < results.length; j++) {
      const { chunkId: cId, concepts } = results[j];
      const chunk = batch[j];
      for (const concept of concepts) {
        const key = normalize(concept.name);
        if (!key) continue;
        if (!conceptMap.has(key)) {
          conceptMap.set(key, { name: concept.name, chunks: [] });
        }
        conceptMap.get(key)!.chunks.push({
          chunkId: cId,
          speaker: chunk.speaker,
          relevance: concept.relevance,
        });
      }
    }

    // Small rate-limit pause every 10 batches
    if ((i / EXTRACT_BATCH_SIZE) % 10 === 9) await sleep(1000);
  }

  console.log(`\n  Extracted ${conceptMap.size} unique concepts`);

  // ── Phase 2: Upsert concepts + embed ────────────────────────────────────
  console.log('\n── Phase 2: Upserting concepts + generating embeddings ───────');

  const conceptNames = Array.from(conceptMap.keys());
  const nameToId = new Map<string, string>();

  // Batch embed all concept names
  for (let i = 0; i < conceptNames.length; i += EMBED_BATCH_SIZE) {
    const batch = conceptNames.slice(i, i + EMBED_BATCH_SIZE);
    const pct = ((i / conceptNames.length) * 100).toFixed(1);
    process.stdout.write(`  Embedding: ${i + batch.length}/${conceptNames.length} (${pct}%)...\r`);

    const resp = await oai.embeddings.create({ model: EMBED_MODEL, input: batch });
    const embeddings = resp.data.map((d) => d.embedding);

    for (let j = 0; j < batch.length; j++) {
      const normalizedName = batch[j];
      const entry = conceptMap.get(normalizedName)!;
      const embedding = embeddings[j];

      const { data, error } = await db
        .from('concepts')
        .upsert(
          {
            name: entry.name,
            normalized_name: normalizedName,
            chunk_count: entry.chunks.length,
            embedding: embedding as unknown as string, // pgvector stored as text array
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'normalized_name' },
        )
        .select('id')
        .single();

      if (error) {
        console.warn(`\n  [upsert] concept="${normalizedName}" err=${error.message}`);
      } else if (data) {
        nameToId.set(normalizedName, data.id);
      }
    }
  }

  console.log(`\n  Upserted ${nameToId.size} concepts`);

  // ── Phase 3: Write chunk→concept edges ───────────────────────────────────
  console.log('\n── Phase 3: Writing chunk→concept edges ──────────────────────');

  const chunkConceptRows: Array<{ chunk_id: string; concept_id: string; relevance: number }> = [];

  for (const [normalizedName, entry] of conceptMap) {
    const conceptId = nameToId.get(normalizedName);
    if (!conceptId) continue;
    for (const c of entry.chunks) {
      chunkConceptRows.push({ chunk_id: c.chunkId, concept_id: conceptId, relevance: c.relevance });
    }
  }

  // Batch upsert in groups of 500
  for (let i = 0; i < chunkConceptRows.length; i += 500) {
    const batch = chunkConceptRows.slice(i, i + 500);
    const pct = ((i / chunkConceptRows.length) * 100).toFixed(1);
    process.stdout.write(`  Writing chunk edges: ${i + batch.length}/${chunkConceptRows.length} (${pct}%)...\r`);

    const { error } = await db
      .from('chunk_concepts')
      .upsert(batch, { onConflict: 'chunk_id,concept_id' });

    if (error) console.warn(`\n  [chunk_concepts] batch err=${error.message}`);
  }

  console.log(`\n  Wrote ${chunkConceptRows.length} chunk→concept edges`);

  // ── Phase 4: Teacher×concept perspective summaries ────────────────────────
  console.log('\n── Phase 4: Generating teacher×concept perspectives ──────────');

  // Build teacher×concept → chunks map
  const teacherConceptChunks = new Map<string, RawChunk[]>();

  for (const [normalizedName, entry] of conceptMap) {
    const conceptId = nameToId.get(normalizedName);
    if (!conceptId) continue;

    const teacherChunkMap = new Map<string, RawChunk[]>();
    for (const c of entry.chunks) {
      const teacher = c.speaker || 'Unknown';
      if (!teacherChunkMap.has(teacher)) teacherChunkMap.set(teacher, []);
      // Find the actual chunk text
      const rawChunk = chunks.find((ch) => chunkId(ch) === c.chunkId);
      if (rawChunk) teacherChunkMap.get(teacher)!.push(rawChunk);
    }

    for (const [teacher, teacherChunks] of teacherChunkMap) {
      if (teacherChunks.length < 2) continue; // only summarize if teacher has ≥2 chunks for this concept
      const key = `${normalizedName}::${teacher}`;
      teacherConceptChunks.set(key, teacherChunks);
    }
  }

  let perspectiveCount = 0;
  const perspectiveKeys = Array.from(teacherConceptChunks.keys());

  for (let i = 0; i < perspectiveKeys.length; i++) {
    const key = perspectiveKeys[i];
    const [normalizedName, teacher] = key.split('::');
    const conceptId = nameToId.get(normalizedName);
    if (!conceptId) continue;

    const entry = conceptMap.get(normalizedName)!;
    const teacherChunks = teacherConceptChunks.get(key)!;

    const pct = ((i / perspectiveKeys.length) * 100).toFixed(1);
    process.stdout.write(`  Perspectives: ${i + 1}/${perspectiveKeys.length} (${pct}%)...\r`);

    const summary = await generatePerspectiveSummary(oai, entry.name, teacher, teacherChunks);

    const { error } = await db.from('concept_teachers').upsert(
      {
        concept_id: conceptId,
        teacher_name: teacher,
        chunk_count: teacherChunks.length,
        perspective_summary: summary,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'concept_id,teacher_name' },
    );

    if (error) console.warn(`\n  [perspective] concept="${normalizedName}" teacher="${teacher}" err=${error.message}`);
    else perspectiveCount++;

    // Pace the LLM calls
    if (i % 20 === 19) await sleep(500);
  }

  console.log(`\n  Generated ${perspectiveCount} teacher×concept perspectives`);

  // ── Phase 5: Concept relations ────────────────────────────────────────────
  if (!skipRelations) {
    console.log('\n── Phase 5: Detecting concept relations ──────────────────────');

    // Find high co-occurrence pairs: concepts that appear in many of the same chunks
    const chunkConceptIndex = new Map<string, Set<string>>(); // chunkId → set of normalized concept names
    for (const [normalizedName, entry] of conceptMap) {
      for (const c of entry.chunks) {
        if (!chunkConceptIndex.has(c.chunkId)) chunkConceptIndex.set(c.chunkId, new Set());
        chunkConceptIndex.get(c.chunkId)!.add(normalizedName);
      }
    }

    const pairCoOccurrences = new Map<string, number>();
    for (const concepts of chunkConceptIndex.values()) {
      const arr = Array.from(concepts);
      for (let a = 0; a < arr.length; a++) {
        for (let b = a + 1; b < arr.length; b++) {
          const pair = [arr[a], arr[b]].sort().join('||');
          pairCoOccurrences.set(pair, (pairCoOccurrences.get(pair) ?? 0) + 1);
        }
      }
    }

    // Take top 50 most co-occurring pairs that have IDs
    const topPairs = Array.from(pairCoOccurrences.entries())
      .filter(([pair]) => {
        const [a, b] = pair.split('||');
        return nameToId.has(a) && nameToId.has(b);
      })
      .sort((x, y) => y[1] - x[1])
      .slice(0, 50)
      .map(([pair, count]) => {
        const [a, b] = pair.split('||');
        return { a, b, coOccurrences: count };
      });

    console.log(`  Analyzing ${topPairs.length} high co-occurrence pairs...`);

    const relations = await detectRelations(oai, topPairs);

    let relCount = 0;
    for (const rel of relations) {
      const fromId = nameToId.get(rel.fromName);
      const toId = nameToId.get(rel.toName);
      if (!fromId || !toId) continue;

      const { error } = await db.from('concept_relations').upsert(
        {
          from_concept_id: fromId,
          to_concept_id: toId,
          relation_type: rel.relationType,
          strength: rel.strength,
        },
        { onConflict: 'from_concept_id,to_concept_id,relation_type' },
      );

      if (error) console.warn(`  [relation] err=${error.message}`);
      else relCount++;
    }

    console.log(`  Wrote ${relCount} concept relations`);
  }

  console.log('\n✓ Concept graph build complete.');
  console.log(`  Concepts: ${nameToId.size}`);
  console.log(`  Chunk edges: ${chunkConceptRows.length}`);
  console.log(`  Run again with --max-chunks for a smaller prototype batch.`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
