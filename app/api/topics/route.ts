/**
 * GET /api/topics — Question topic clusters
 *
 * Returns the 10 topic clusters with their label, question count, and
 * up to 3 representative example questions (the most central ones).
 *
 * No auth required (public endpoint).
 *
 * Response:
 *   topics — array of { clusterId, label, questionCount, examples }
 *
 * Source: question_clusters table (populated by scripts/cluster-questions.ts).
 */
import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

interface TopicCluster {
  clusterId: number;
  label: string;
  questionCount: number;
  examples: string[];
}

const EXAMPLES_PER_CLUSTER = 3;

export async function GET(): Promise<NextResponse> {
  const { data, error } = await supabase
    .from('question_clusters')
    .select('cluster_id, cluster_label, question_text')
    .order('cluster_id', { ascending: true });

  if (error) {
    console.error('[/api/topics] db_error:', error.message);
    return NextResponse.json(
      { error: { code: 'DB_ERROR', message: 'Failed to fetch topics.' } },
      { status: 502 },
    );
  }

  // Group by cluster_id
  const clusterMap = new Map<
    number,
    { label: string; questions: string[] }
  >();

  for (const row of data ?? []) {
    const id = row.cluster_id as number;
    if (!clusterMap.has(id)) {
      clusterMap.set(id, { label: row.cluster_label as string, questions: [] });
    }
    clusterMap.get(id)!.questions.push(row.question_text as string);
  }

  const topics: TopicCluster[] = Array.from(clusterMap.entries())
    .sort(([a], [b]) => a - b)
    .map(([clusterId, { label, questions }]) => ({
      clusterId,
      label,
      questionCount: questions.length,
      examples: questions.slice(0, EXAMPLES_PER_CLUSTER),
    }));

  return NextResponse.json({ topics });
}
