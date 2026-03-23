/**
 * scripts/eval-concept-graph.ts
 *
 * Phase 2 prototype evaluation for the concept knowledge graph (OLU-443).
 * Runs entirely in memory — no Supabase migration required.
 *
 * What it does:
 *   1. Reads a subset of chunks from chunks.jsonl
 *   2. Extracts concepts via GPT-4o-mini (batched)
 *   3. Builds teacher×concept perspective summaries
 *   4. Answers 8 test questions with and without concept augmentation
 *   5. Outputs a markdown evaluation report for decision-gate review
 *
 * Usage:
 *   pnpm eval:concept-graph
 *   # or directly:
 *   tsx scripts/eval-concept-graph.ts [--chunks N] [--questions-only]
 *
 * Requires:
 *   OPENAI_API_KEY in .env.local
 *   scripts/chunks.jsonl (or set CHUNKS_PATH env var)
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
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
  } catch { /* rely on process env */ }
}
loadEnvLocal();

import OpenAI from 'openai';

// ── Config ─────────────────────────────────────────────────────────────────────
const EMBED_MODEL = 'text-embedding-3-small';
const CHAT_MODEL = 'gpt-4o-mini';
const EXTRACT_BATCH = 15;       // chunks per extraction call
const MAX_CONCEPTS_PER_CHUNK = 6;
const PERSPECTIVE_MIN_CHUNKS = 2; // min chunks to generate a perspective
const PERSPECTIVE_SAMPLE = 6;

const args = process.argv.slice(2);
const EVAL_CHUNKS = (() => {
  const idx = args.indexOf('--chunks');
  return idx !== -1 ? parseInt(args[idx + 1], 10) : 200;
})();
const QUESTIONS_ONLY = args.includes('--questions-only');

const CHUNKS_PATH = process.env.CHUNKS_PATH
  ?? resolve('/Users/nick/.openclaw/workspace/convergence-mvp', 'chunks.jsonl');

// 8 evaluation questions spanning cross-teacher concepts
const EVAL_QUESTIONS = [
  'What is the relationship between meditation and the sense of self?',
  'How do different teachers approach the concept of awareness?',
  'What is non-dual awareness and how does it differ from ordinary consciousness?',
  'How should someone deal with difficult emotions during meditation?',
  'What is the role of suffering in spiritual practice?',
  'How do teachers describe the nature of thoughts and thinking?',
  'What is impermanence and why does it matter for practice?',
  'How do different teachers describe the relationship between mind and body?',
];

// ── Types ──────────────────────────────────────────────────────────────────────
interface Chunk {
  id: string;
  text: string;
  speaker: string;
  source_file: string;
  chunk_index: number;
}

interface ConceptEntry {
  name: string;
  normalizedName: string;
  chunks: Array<{ chunkId: string; speaker: string; text: string; relevance: number }>;
}

interface TeacherPerspective {
  teacher: string;
  summary: string;
}

interface EvalResult {
  question: string;
  answerWithout: string;
  answerWith: string;
  conceptsMatched: string[];
  teacherPerspectives: TeacherPerspective[];
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function normalize(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, ' ');
}

function cosineSim(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-10);
}

async function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

// ── Phase 1: Extract concepts ──────────────────────────────────────────────────
async function extractConcepts(
  oai: OpenAI,
  chunks: Chunk[],
): Promise<Map<string, ConceptEntry>> {
  const conceptMap = new Map<string, ConceptEntry>();

  console.log(`\nExtracting concepts from ${chunks.length} chunks in batches of ${EXTRACT_BATCH}...`);

  for (let i = 0; i < chunks.length; i += EXTRACT_BATCH) {
    const batch = chunks.slice(i, i + EXTRACT_BATCH);
    process.stdout.write(`  Batch ${Math.ceil(i / EXTRACT_BATCH) + 1}/${Math.ceil(chunks.length / EXTRACT_BATCH)}...\r`);

    const prompt = batch
      .map((c, j) => `[${j + 1}] Speaker: ${c.speaker}\n"${c.text.slice(0, 500)}"`)
      .join('\n\n---\n\n');

    try {
      const resp = await oai.chat.completions.create({
        model: CHAT_MODEL,
        messages: [
          {
            role: 'system',
            content: `Extract philosophical/contemplative concepts from meditation teacher transcripts.
For each chunk, list up to ${MAX_CONCEPTS_PER_CHUNK} concepts (states of mind, practices, teachings, psychological ideas).
Examples: "non-self", "awareness", "impermanence", "free will", "suffering", "equanimity"
Return JSON only: {"chunks": [{"index": 1, "concepts": [{"name": "...", "relevance": 0.0-1.0}, ...]}, ...]}`,
          },
          { role: 'user', content: prompt },
        ],
        temperature: 0,
        response_format: { type: 'json_object' },
      });

      const parsed = JSON.parse(resp.choices[0]?.message?.content ?? '{}');
      const chunks_result: Array<{ index: number; concepts: Array<{ name: string; relevance: number }> }> =
        parsed.chunks ?? [];

      for (const item of chunks_result) {
        const chunk = batch[item.index - 1];
        if (!chunk) continue;
        for (const concept of item.concepts ?? []) {
          const key = normalize(concept.name);
          if (!key || key.length < 3) continue;
          if (!conceptMap.has(key)) {
            conceptMap.set(key, { name: concept.name, normalizedName: key, chunks: [] });
          }
          conceptMap.get(key)!.chunks.push({
            chunkId: chunk.id,
            speaker: chunk.speaker,
            text: chunk.text,
            relevance: concept.relevance ?? 0.7,
          });
        }
      }
    } catch (err) {
      console.warn(`\n  Batch error: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (i > 0 && (i / EXTRACT_BATCH) % 5 === 0) await sleep(800);
  }

  console.log(`\n  Extracted ${conceptMap.size} unique concepts`);
  return conceptMap;
}

// ── Phase 2: Embed concepts ────────────────────────────────────────────────────
async function embedConcepts(
  oai: OpenAI,
  conceptMap: Map<string, ConceptEntry>,
): Promise<Map<string, number[]>> {
  const names = Array.from(conceptMap.keys());
  const embeddings = new Map<string, number[]>();

  console.log(`\nEmbedding ${names.length} concept names...`);

  for (let i = 0; i < names.length; i += 100) {
    const batch = names.slice(i, i + 100);
    const resp = await oai.embeddings.create({ model: EMBED_MODEL, input: batch });
    for (let j = 0; j < batch.length; j++) {
      embeddings.set(batch[j], resp.data[j].embedding);
    }
  }

  return embeddings;
}

// ── Phase 3: Generate teacher perspectives ────────────────────────────────────
async function generatePerspectives(
  oai: OpenAI,
  conceptMap: Map<string, ConceptEntry>,
): Promise<Map<string, TeacherPerspective[]>> {
  // Build concept → teacher → chunks mapping
  const ctMap = new Map<string, Map<string, string[]>>();
  for (const [key, entry] of conceptMap) {
    const teachers = new Map<string, string[]>();
    for (const c of entry.chunks) {
      if (!teachers.has(c.speaker)) teachers.set(c.speaker, []);
      teachers.get(c.speaker)!.push(c.text);
    }
    ctMap.set(key, teachers);
  }

  const result = new Map<string, TeacherPerspective[]>();

  // Only process concepts with ≥2 teachers (cross-teacher synthesis)
  const multiTeacherConcepts = Array.from(ctMap.entries())
    .filter(([, teachers]) => {
      let count = 0;
      for (const texts of teachers.values()) if (texts.length >= PERSPECTIVE_MIN_CHUNKS) count++;
      return count >= 2;
    })
    .slice(0, 30); // cap for prototype

  console.log(`\nGenerating perspectives for ${multiTeacherConcepts.length} cross-teacher concepts...`);

  for (let i = 0; i < multiTeacherConcepts.length; i++) {
    const [conceptKey, teachers] = multiTeacherConcepts[i];
    const entry = conceptMap.get(conceptKey)!;
    const perspectives: TeacherPerspective[] = [];

    for (const [teacher, texts] of teachers) {
      if (texts.length < PERSPECTIVE_MIN_CHUNKS) continue;
      const sample = texts.slice(0, PERSPECTIVE_SAMPLE).map(t => `"${t.slice(0, 350)}"`).join('\n');
      try {
        const resp = await oai.chat.completions.create({
          model: CHAT_MODEL,
          messages: [
            {
              role: 'system',
              content: 'Write a 1-2 sentence summary of how this teacher discusses this concept. Be specific and grounded in the excerpts.',
            },
            {
              role: 'user',
              content: `Concept: "${entry.name}"\nTeacher: "${teacher}"\n\nExcerpts:\n${sample}`,
            },
          ],
          temperature: 0.3,
          max_tokens: 120,
        });
        const summary = resp.choices[0]?.message?.content?.trim() ?? '';
        if (summary) perspectives.push({ teacher, summary });
      } catch { /* skip */ }
    }

    if (perspectives.length >= 2) {
      result.set(conceptKey, perspectives);
    }

    process.stdout.write(`  Progress: ${i + 1}/${multiTeacherConcepts.length} concepts\r`);
    if (i % 10 === 9) await sleep(300);
  }

  console.log(`\n  Generated perspectives for ${result.size} concepts`);
  return result;
}

// ── Phase 4: Find concepts for a query ────────────────────────────────────────
function findRelatedConcepts(
  queryEmbedding: number[],
  conceptEmbeddings: Map<string, number[]>,
  topK = 3,
  threshold = 0.45,
): Array<{ conceptKey: string; similarity: number }> {
  const scores: Array<{ conceptKey: string; similarity: number }> = [];
  for (const [key, emb] of conceptEmbeddings) {
    const sim = cosineSim(queryEmbedding, emb);
    if (sim >= threshold) scores.push({ conceptKey: key, similarity: sim });
  }
  return scores.sort((a, b) => b.similarity - a.similarity).slice(0, topK);
}

// ── Phase 5: Build preamble ────────────────────────────────────────────────────
function buildPreamble(
  relatedConcepts: Array<{ conceptKey: string; similarity: number }>,
  conceptMap: Map<string, ConceptEntry>,
  perspectives: Map<string, TeacherPerspective[]>,
): string | null {
  const sections: string[] = [];

  for (const { conceptKey } of relatedConcepts) {
    const persp = perspectives.get(conceptKey);
    if (!persp || persp.length < 2) continue;
    const entry = conceptMap.get(conceptKey);
    if (!entry) continue;

    const lines = persp.map(p => `  - ${p.teacher}: "${p.summary}"`).join('\n');
    sections.push(`Concept: "${entry.name}"\n${lines}`);
  }

  if (sections.length === 0) return null;
  return `[Cross-teacher context]\n${sections.join('\n\n')}`;
}

// ── Phase 6: Answer a question with/without concept context ───────────────────
const SYSTEM_PROMPT = `You are a knowledgeable mindfulness guide with deep expertise in meditation, consciousness, and contemplative traditions.
Answer questions concisely (2-3 short paragraphs). Be warm and direct. Never name specific teachers or brands.`;

async function answerQuestion(
  oai: OpenAI,
  question: string,
  preamble: string | null,
): Promise<string> {
  const userContent = preamble
    ? `${preamble}\n\nQuestion: ${question}`
    : `Question: ${question}`;

  const resp = await oai.chat.completions.create({
    model: CHAT_MODEL,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userContent },
    ],
    temperature: 0.7,
    max_tokens: 400,
  });

  return resp.choices[0]?.message?.content?.trim() ?? '(no response)';
}

// ── Main ───────────────────────────────────────────────────────────────────────
async function main() {
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) { console.error('ERROR: OPENAI_API_KEY not set'); process.exit(1); }
  if (!existsSync(CHUNKS_PATH)) { console.error(`ERROR: chunks.jsonl not found at ${CHUNKS_PATH}`); process.exit(1); }

  const oai = new OpenAI({ apiKey: openaiKey });

  // Load chunks
  console.log(`Loading ${EVAL_CHUNKS} chunks from ${CHUNKS_PATH}...`);
  const chunks: Chunk[] = readFileSync(CHUNKS_PATH, 'utf-8')
    .split('\n').filter(Boolean)
    .slice(0, EVAL_CHUNKS)
    .map(line => JSON.parse(line) as Chunk);

  const speakers = new Set(chunks.map(c => c.speaker));
  console.log(`  ${chunks.length} chunks from ${speakers.size} speakers: ${Array.from(speakers).slice(0, 5).join(', ')}${speakers.size > 5 ? '...' : ''}`);

  let conceptMap: Map<string, ConceptEntry>;
  let conceptEmbeddings: Map<string, number[]>;
  let perspectives: Map<string, TeacherPerspective[]>;

  if (!QUESTIONS_ONLY) {
    // Phase 1: Extract
    conceptMap = await extractConcepts(oai, chunks);

    // Filter to concepts seen in ≥3 chunks for quality
    for (const [key, entry] of conceptMap) {
      if (entry.chunks.length < 2) conceptMap.delete(key);
    }
    console.log(`  After filtering: ${conceptMap.size} concepts with ≥2 chunk mentions`);

    // Phase 2: Embed
    conceptEmbeddings = await embedConcepts(oai, conceptMap);

    // Phase 3: Perspectives
    perspectives = await generatePerspectives(oai, conceptMap);
  } else {
    conceptMap = new Map();
    conceptEmbeddings = new Map();
    perspectives = new Map();
  }

  // Phase 4+5+6: Evaluate questions
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Evaluating ${EVAL_QUESTIONS.length} questions...`);
  console.log(`${'─'.repeat(60)}`);

  const results: EvalResult[] = [];

  for (let i = 0; i < EVAL_QUESTIONS.length; i++) {
    const question = EVAL_QUESTIONS[i];
    console.log(`\n[${i + 1}/${EVAL_QUESTIONS.length}] "${question.slice(0, 60)}..."`);

    // Embed question
    const qEmbResp = await oai.embeddings.create({ model: EMBED_MODEL, input: question });
    const qEmb = qEmbResp.data[0].embedding;

    // Find related concepts
    const related = findRelatedConcepts(qEmb, conceptEmbeddings);
    const preamble = buildPreamble(related, conceptMap, perspectives);
    const conceptNames = related.map(r => conceptMap.get(r.conceptKey)?.name ?? r.conceptKey);
    const teacherPersp = related.flatMap(r => perspectives.get(r.conceptKey) ?? []).slice(0, 4);

    console.log(`  Concepts matched: ${conceptNames.join(', ') || '(none)'}`);
    console.log(`  Preamble: ${preamble ? `${preamble.slice(0, 80)}...` : '(none)'}`);

    // Answer without concept context
    process.stdout.write('  Generating answer WITHOUT concept context...\r');
    const answerWithout = await answerQuestion(oai, question, null);

    // Answer with concept context
    process.stdout.write('  Generating answer WITH concept context...    \r');
    const answerWith = preamble
      ? await answerQuestion(oai, question, preamble)
      : answerWithout + ' [no concept context available]';

    console.log('  Done.');

    results.push({
      question,
      answerWithout,
      answerWith,
      conceptsMatched: conceptNames,
      teacherPerspectives: teacherPersp,
    });

    await sleep(200);
  }

  // Generate report
  console.log(`\n${'─'.repeat(60)}`);
  console.log('Generating evaluation report...');

  const report = generateReport(results, conceptMap, perspectives, chunks.length);
  const reportPath = resolve(process.cwd(), 'scripts/concept-graph-eval-report.md');
  writeFileSync(reportPath, report);
  console.log(`\n✓ Report written to: ${reportPath}`);
  console.log('\n' + '═'.repeat(60));
  console.log(report.slice(0, 2000));
  if (report.length > 2000) console.log(`\n... (${report.length - 2000} more characters in file)`);
}

function generateReport(
  results: EvalResult[],
  conceptMap: Map<string, ConceptEntry>,
  perspectives: Map<string, TeacherPerspective[]>,
  chunksProcessed: number,
): string {
  const topConcepts = Array.from(conceptMap.entries())
    .sort((a, b) => b[1].chunks.length - a[1].chunks.length)
    .slice(0, 20);

  const crossTeacherConcepts = Array.from(perspectives.entries())
    .map(([key, persp]) => ({
      name: conceptMap.get(key)?.name ?? key,
      teacherCount: persp.length,
      teachers: persp.map(p => p.teacher).join(', '),
    }))
    .sort((a, b) => b.teacherCount - a.teacherCount);

  const questionsWithConcepts = results.filter(r => r.conceptsMatched.length > 0 && !r.answerWith.includes('[no concept context')).length;

  const lines: string[] = [
    '# Concept Graph Phase 2 Evaluation Report',
    '',
    `**Date**: ${new Date().toISOString().split('T')[0]}`,
    `**Chunks analyzed**: ${chunksProcessed}`,
    `**Unique concepts extracted**: ${conceptMap.size}`,
    `**Cross-teacher concepts** (≥2 teachers): ${perspectives.size}`,
    `**Questions with concept augmentation**: ${questionsWithConcepts}/${results.length}`,
    '',
    '## Top 20 Concepts by Mention Count',
    '',
    '| Concept | Chunk Mentions | Unique Speakers |',
    '|---------|---------------|-----------------|',
    ...topConcepts.map(([, e]) => {
      const speakers = new Set(e.chunks.map(c => c.speaker));
      return `| ${e.name} | ${e.chunks.length} | ${speakers.size} |`;
    }),
    '',
    '## Cross-Teacher Concepts (with Perspective Summaries)',
    '',
    ...crossTeacherConcepts.slice(0, 15).map(c =>
      `- **${c.name}** — ${c.teacherCount} teachers: ${c.teachers}`
    ),
    '',
    '## Question-by-Question Evaluation',
    '',
  ];

  for (const r of results) {
    const hasContext = !r.answerWith.includes('[no concept context');
    lines.push(`### Q: ${r.question}`, '');

    if (r.conceptsMatched.length > 0) {
      lines.push(`**Concepts matched**: ${r.conceptsMatched.join(', ')}`);
    } else {
      lines.push('**Concepts matched**: none (similarity below threshold)');
    }

    if (r.teacherPerspectives.length > 0) {
      lines.push('', '**Teacher perspectives injected**:');
      for (const p of r.teacherPerspectives) {
        lines.push(`- ${p.teacher}: "${p.summary}"`);
      }
    }

    lines.push(
      '',
      '**Answer WITHOUT concept context**:',
      '',
      r.answerWithout,
      '',
      `**Answer WITH concept context** ${hasContext ? '' : '(same — no context available)'}:`,
      '',
      hasContext ? r.answerWith : '*(same as above)*',
      '',
      '---',
      '',
    );
  }

  lines.push(
    '## Decision Gate Assessment',
    '',
    `Out of ${results.length} evaluation questions:`,
    `- **${questionsWithConcepts}** received concept augmentation`,
    `- **${results.length - questionsWithConcepts}** had no matching concepts (threshold too high or concepts not extracted from this chunk subset)`,
    '',
    '### Recommendation',
    '',
    questionsWithConcepts >= 5
      ? '✅ **Proceed with full corpus build.** The concept graph surfaces relevant cross-teacher context for the majority of test questions. Run `pnpm build:concept-graph` after applying migration 037.'
      : questionsWithConcepts >= 3
        ? '⚠️ **Borderline — expand prototype.** Some questions benefit from concept context but coverage is low. Consider running against more chunks (500-1000) before deciding.'
        : '❌ **Close task.** Too few questions benefit from concept augmentation. The OLU-439–442 baseline improvements are likely sufficient.',
    '',
    '### To apply the Supabase migration and run the full pipeline:',
    '',
    '```bash',
    '# 1. Apply migration in Supabase SQL Editor:',
    '#    Copy supabase/migrations/037_concept_graph.sql and run in Supabase Dashboard → SQL Editor',
    '',
    '# 2. Build concept graph for full corpus:',
    'CHUNKS_PATH=/path/to/chunks.jsonl pnpm build:concept-graph',
    '',
    '# 3. Verify the /api/ask integration is working (already wired in):',
    '#    Ask any cross-teacher question and check the response quality',
    '```',
  );

  return lines.join('\n');
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
