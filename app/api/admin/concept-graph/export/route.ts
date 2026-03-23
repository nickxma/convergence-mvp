/**
 * GET /api/admin/concept-graph/export — full graph export as JSON
 *
 * Auth: Authorization: Bearer <ADMIN_WALLET>
 *
 * Returns the complete concept graph (nodes + edges) in a format compatible
 * with Gephi and D3.js. Embeddings are excluded (large, not needed for viz).
 *
 * Response:
 *   meta   — { nodeCount, edgeCount, exportedAt }
 *   nodes  — [{ id, name, normalizedName, description, chunkCount }]
 *   edges  — [{ from, to, relationType, strength, teachers }]
 *            where 'teachers' lists teachers who co-mention both concepts
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { isAdminRequest } from '@/lib/admin-auth';

function errorResponse(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!isAdminRequest(req)) {
    return errorResponse(401, 'UNAUTHORIZED', 'Admin access required.');
  }

  const [nodesResult, edgesResult, teachersResult] = await Promise.all([
    supabase
      .from('concepts')
      .select('id, name, normalized_name, description, chunk_count')
      .order('chunk_count', { ascending: false }),

    supabase
      .from('concept_relations')
      .select('from_concept_id, to_concept_id, relation_type, strength')
      .order('strength', { ascending: false }),

    // Load teacher×concept associations to annotate edges with which teachers
    // co-mention both concepts (aids visualization and analysis).
    supabase
      .from('concept_teachers')
      .select('concept_id, teacher_name')
      .not('perspective_summary', 'is', null),
  ]);

  for (const result of [nodesResult, edgesResult, teachersResult]) {
    if (result.error) {
      console.error(`[/api/admin/concept-graph/export] db_error: ${result.error.message}`);
      return errorResponse(502, 'DB_ERROR', 'Failed to export concept graph.');
    }
  }

  // Build concept→teachers lookup for edge annotation
  const conceptTeachers = new Map<string, string[]>();
  for (const row of teachersResult.data ?? []) {
    const list = conceptTeachers.get(row.concept_id) ?? [];
    if (!list.includes(row.teacher_name)) list.push(row.teacher_name);
    conceptTeachers.set(row.concept_id, list);
  }

  const nodes = (nodesResult.data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    normalizedName: row.normalized_name,
    description: row.description,
    chunkCount: row.chunk_count,
  }));

  const edges = (edgesResult.data ?? []).map((row) => {
    const fromTeachers = conceptTeachers.get(row.from_concept_id) ?? [];
    const toTeachers = conceptTeachers.get(row.to_concept_id) ?? [];
    const sharedTeachers = fromTeachers.filter((t) => toTeachers.includes(t));
    return {
      from: row.from_concept_id,
      to: row.to_concept_id,
      relationType: row.relation_type,
      strength: row.strength,
      teachers: sharedTeachers,
    };
  });

  return NextResponse.json({
    meta: {
      nodeCount: nodes.length,
      edgeCount: edges.length,
      exportedAt: new Date().toISOString(),
    },
    nodes,
    edges,
  });
}
