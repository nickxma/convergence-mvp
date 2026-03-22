/**
 * GET /api/admin/corpus/gaps — Q&A corpus gap analysis
 *
 * Auth: Authorization: Bearer <ADMIN_WALLET>
 *
 * Algorithm:
 * 1. Fetch the top 50 questions from qa_pairs ordered by view_count.
 * 2. Batch-embed all questions with text-embedding-3-large (1536 dims).
 * 3. Query Pinecone topK=1 per question in the waking-up namespace; record max match score.
 * 4. Flag questions where max_score < 0.75 (weak retrieval — answer likely fabricated).
 * 5. Group flagged questions by inferred topic via OpenAI gpt-4o-mini classification.
 *
 * Response:
 *   topics          — [{topic, question_count, avg_max_score, sample_questions[]}]
 *   total_flagged   — count of questions below threshold
 *   total_checked   — count of questions analysed
 *   threshold       — the score threshold used (0.75)
 */
import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { Pinecone } from '@pinecone-database/pinecone';
import { supabase } from '@/lib/supabase';
import { isAdminRequest } from '@/lib/admin-auth';
import { embedBatch } from '@/lib/embeddings';
import { logOpenAIUsage } from '@/lib/openai-usage';

const EMBED_MODEL = 'text-embedding-3-large';
const EMBED_DIMENSIONS = 1536;
const PINECONE_NAMESPACE = 'waking-up';
const WEAK_RETRIEVAL_THRESHOLD = 0.75;
const TOP_QUESTIONS_LIMIT = 50;

interface GapTopic {
  topic: string;
  question_count: number;
  avg_max_score: number;
  sample_questions: string[];
}

function errorResponse(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!isAdminRequest(req)) {
    return errorResponse(401, 'UNAUTHORIZED', 'Admin access required.');
  }

  const openaiKey = process.env.OPENAI_API_KEY;
  const pineconeKey = process.env.PINECONE_API_KEY;
  const pineconeIndex = process.env.PINECONE_INDEX ?? 'convergence-mvp';

  if (!openaiKey || !pineconeKey) {
    console.error('[/api/admin/corpus/gaps] missing required env vars');
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Service is not configured.');
  }

  // Step 1: Fetch top 50 questions from qa_pairs by view_count
  const { data: qaPairs, error: dbError } = await supabase
    .from('qa_pairs')
    .select('question, view_count')
    .order('view_count', { ascending: false })
    .limit(TOP_QUESTIONS_LIMIT);

  if (dbError) {
    console.error(`[/api/admin/corpus/gaps] db_error: ${dbError.message}`);
    return errorResponse(502, 'DB_ERROR', 'Failed to query qa_pairs.');
  }

  if (!qaPairs || qaPairs.length === 0) {
    return NextResponse.json({ topics: [], total_flagged: 0, total_checked: 0, threshold: WEAK_RETRIEVAL_THRESHOLD });
  }

  const questions = qaPairs.map((r) => r.question);

  // Step 2: Batch-embed all questions
  let embeddings: number[][];
  try {
    embeddings = await embedBatch(questions, { model: EMBED_MODEL, dimensions: EMBED_DIMENSIONS });
  } catch (err) {
    console.error(`[/api/admin/corpus/gaps] embed_error: ${err instanceof Error ? err.message : String(err)}`);
    return errorResponse(502, 'EMBED_ERROR', 'Failed to embed questions.');
  }

  // Step 3: Query Pinecone topK=1 per question to get max match score
  const pc = new Pinecone({ apiKey: pineconeKey });
  const namespace = pc.Index(pineconeIndex).namespace(PINECONE_NAMESPACE);

  let scores: number[];
  try {
    const results = await Promise.all(
      embeddings.map((vector) => namespace.query({ vector, topK: 1, includeMetadata: false })),
    );
    scores = results.map((r) => r.matches?.[0]?.score ?? 0);
  } catch (err) {
    console.error(`[/api/admin/corpus/gaps] pinecone_error: ${err instanceof Error ? err.message : String(err)}`);
    return errorResponse(502, 'PINECONE_ERROR', 'Failed to query Pinecone.');
  }

  // Step 4: Flag questions where max_score < WEAK_RETRIEVAL_THRESHOLD
  const flagged = questions
    .map((q, i) => ({ question: q, score: scores[i] }))
    .filter((x) => x.score < WEAK_RETRIEVAL_THRESHOLD);

  if (flagged.length === 0) {
    return NextResponse.json({ topics: [], total_flagged: 0, total_checked: questions.length, threshold: WEAK_RETRIEVAL_THRESHOLD });
  }

  // Step 5: Group flagged questions by topic using OpenAI gpt-4o-mini
  const oai = new OpenAI({ apiKey: openaiKey });

  const classificationPrompt = `You are a topic classifier for a mindfulness/meditation Q&A system.

Classify each question into a concise topic label (2-4 words, e.g. "breath awareness", "emotional regulation", "non-dual awareness").
Group semantically similar questions under the same topic. Aim for 4-8 distinct topics.

Return a JSON object in this exact shape:
{"classifications": [{"question": "...", "topic": "..."}]}

Questions to classify:
${flagged.map((x, i) => `${i + 1}. ${x.question}`).join('\n')}`;

  let topicAssignments: { question: string; topic: string }[] = [];
  try {
    const completion = await oai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: classificationPrompt }],
      response_format: { type: 'json_object' },
      temperature: 0,
    });
    logOpenAIUsage({
      model: 'gpt-4o-mini',
      endpoint: 'completion',
      promptTokens: completion.usage?.prompt_tokens ?? 0,
      completionTokens: completion.usage?.completion_tokens ?? 0,
    });
    const raw = JSON.parse(completion.choices[0].message.content ?? '{}');
    topicAssignments = Array.isArray(raw.classifications) ? raw.classifications : [];
  } catch (err) {
    console.error(`[/api/admin/corpus/gaps] classify_error: ${err instanceof Error ? err.message : String(err)}`);
    // Fallback: lump everything under "Unclassified"
    topicAssignments = flagged.map((x) => ({ question: x.question, topic: 'Unclassified' }));
  }

  // Build topic groups, merging scores
  const scoreMap = new Map(flagged.map((x) => [x.question, x.score]));
  const topicMap = new Map<string, { scores: number[]; questions: string[] }>();

  for (const { question, topic } of topicAssignments) {
    const score = scoreMap.get(question) ?? 0;
    if (!topicMap.has(topic)) topicMap.set(topic, { scores: [], questions: [] });
    const entry = topicMap.get(topic)!;
    entry.scores.push(score);
    entry.questions.push(question);
  }

  // Include any flagged questions that the model didn't classify
  for (const { question, score } of flagged) {
    if (!topicAssignments.some((a) => a.question === question)) {
      const topic = 'Unclassified';
      if (!topicMap.has(topic)) topicMap.set(topic, { scores: [], questions: [] });
      const entry = topicMap.get(topic)!;
      entry.scores.push(score);
      entry.questions.push(question);
    }
  }

  const topics: GapTopic[] = Array.from(topicMap.entries())
    .map(([topic, { scores: s, questions: qs }]) => ({
      topic,
      question_count: qs.length,
      avg_max_score: Math.round((s.reduce((a, b) => a + b, 0) / s.length) * 1000) / 1000,
      sample_questions: qs.slice(0, 3),
    }))
    .sort((a, b) => a.avg_max_score - b.avg_max_score); // worst coverage first

  return NextResponse.json({
    topics,
    total_flagged: flagged.length,
    total_checked: questions.length,
    threshold: WEAK_RETRIEVAL_THRESHOLD,
  });
}
