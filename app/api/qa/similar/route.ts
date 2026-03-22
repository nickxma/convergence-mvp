import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { embedOne } from '@/lib/embeddings';

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

  if (!process.env.OPENAI_API_KEY) return NextResponse.json({ similar: [] });

  let queryVector: number[];
  try {
    queryVector = await embedOne(q);
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
