/**
 * GET /api/topics/:clusterId/questions — Paginated questions for a topic cluster
 *
 * Returns questions in the given cluster, joined with answer excerpts from
 * qa_answers where available. Questions are ordered by question_hash for
 * stable pagination.
 *
 * Query params:
 *   page — 1-indexed page number (default 1)
 *
 * Response:
 *   questions — array of { questionHash, questionText, answerExcerpt | null }
 *   page, pageSize, total, hasMore
 *
 * No auth required (public endpoint).
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

const PAGE_SIZE = 20;
const EXCERPT_LENGTH = 220;

interface ClusterQuestion {
  questionHash: string;
  questionText: string;
  answerExcerpt: string | null;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ clusterId: string }> },
): Promise<NextResponse> {
  const { clusterId } = await params;
  const clusterId_num = parseInt(clusterId, 10);

  if (isNaN(clusterId_num) || clusterId_num < 0) {
    return NextResponse.json(
      { error: { code: 'INVALID_CLUSTER', message: 'Invalid cluster ID.' } },
      { status: 400 },
    );
  }

  const { searchParams } = new URL(req.url);
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10));
  const offset = (page - 1) * PAGE_SIZE;

  // 1. Fetch paginated questions for the cluster
  const { data: clusterRows, error: clusterErr, count } = await supabase
    .from('question_clusters')
    .select('question_hash, question_text', { count: 'exact' })
    .eq('cluster_id', clusterId_num)
    .order('question_hash', { ascending: true })
    .range(offset, offset + PAGE_SIZE - 1);

  if (clusterErr) {
    console.error('[/api/topics/:id/questions] db_error:', clusterErr.message);
    return NextResponse.json(
      { error: { code: 'DB_ERROR', message: 'Failed to fetch questions.' } },
      { status: 502 },
    );
  }

  const rows = clusterRows ?? [];
  const total = count ?? 0;

  if (rows.length === 0) {
    return NextResponse.json({
      questions: [],
      page,
      pageSize: PAGE_SIZE,
      total,
      hasMore: false,
    });
  }

  // 2. Fetch answer excerpts for this page's questions
  const questionTexts = rows.map((r) => r.question_text as string);
  const { data: answerRows, error: answerErr } = await supabase
    .from('qa_answers')
    .select('question, answer')
    .in('question', questionTexts);

  if (answerErr) {
    // Non-fatal — return questions without excerpts
    console.error('[/api/topics/:id/questions] answers_error:', answerErr.message);
  }

  const answerMap = new Map<string, string>();
  for (const row of answerRows ?? []) {
    const q = row.question as string;
    const a = row.answer as string;
    if (!answerMap.has(q)) {
      answerMap.set(q, a);
    }
  }

  const questions: ClusterQuestion[] = rows.map((r) => {
    const qText = r.question_text as string;
    const fullAnswer = answerMap.get(qText) ?? null;
    const excerpt = fullAnswer
      ? fullAnswer.slice(0, EXCERPT_LENGTH) + (fullAnswer.length > EXCERPT_LENGTH ? '…' : '')
      : null;
    return {
      questionHash: r.question_hash as string,
      questionText: qText,
      answerExcerpt: excerpt,
    };
  });

  return NextResponse.json({
    questions,
    page,
    pageSize: PAGE_SIZE,
    total,
    hasMore: offset + rows.length < total,
  });
}
