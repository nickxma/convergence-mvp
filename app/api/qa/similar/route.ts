import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { supabase } from '@/lib/supabase';
import { logOpenAIUsage } from '@/lib/openai-usage';

const EMBED_MODEL = 'text-embedding-3-small';
const SIMILAR_THRESHOLD = 0.92;
const SIMILAR_TOP_K = 3;
const ANSWER_SNIPPET_LEN = 100;

type SimilarRow = { question: string; answer: string; similarity: number };

export async function GET(req: NextRequest): Promise<NextResponse> {
  const q = req.nextUrl.searchParams.get('q')?.trim() ?? '';

  if (!q) return NextResponse.json({ similar: [] });
  if (q.length > 1000) {
    return NextResponse.json({ error: { code: 'QUESTION_TOO_LONG', message: 'q must be 1000 characters or fewer.' } }, { status: 400 });
  }

  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) return NextResponse.json({ similar: [] });

  const oai = new OpenAI({ apiKey: openaiKey });
  let queryVector: number[];
  try {
    const embedResp = await oai.embeddings.create({ model: EMBED_MODEL, input: q });
    queryVector = embedResp.data[0].embedding;
    logOpenAIUsage({ model: EMBED_MODEL, endpoint: 'embedding', promptTokens: embedResp.usage.total_tokens });
  } catch (err) {
    console.error(`[/api/qa/similar] embed_error err=${err instanceof Error ? err.message : String(err)}`);
    return NextResponse.json({ similar: [] });
  }

  try {
    const { data, error } = await supabase.rpc('match_qa_related', {
      query_embedding: queryVector,
      match_threshold: SIMILAR_THRESHOLD,
      match_count: SIMILAR_TOP_K,
    });
    if (error) throw error;

    const rows = (data ?? []) as SimilarRow[];
    const similar = rows.map((r) => ({
      question: r.question,
      answer_snippet: r.answer.slice(0, ANSWER_SNIPPET_LEN),
      similarity: Math.round(r.similarity * 1000) / 1000,
    }));

    return NextResponse.json({ similar });
  } catch (err) {
    console.error(`[/api/qa/similar] pgvector_error err=${err instanceof Error ? err.message : String(err)}`);
    return NextResponse.json({ similar: [] });
  }
}
