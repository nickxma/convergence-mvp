/**
 * GET /api/admin/concept-graph/nodes/:id — concept node detail with edges
 *
 * Auth: Authorization: Bearer <ADMIN_WALLET>
 *
 * Response:
 *   concept     — { id, name, normalizedName, description, chunkCount, createdAt, updatedAt }
 *   teachers    — teacher perspectives [{ teacher, summary, chunkCount }]
 *   edges       — outgoing + incoming relations [{ direction, relationType, strength, concept: { id, name } }]
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { isAdminRequest } from '@/lib/admin-auth';

function errorResponse(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!isAdminRequest(req)) {
    return errorResponse(401, 'UNAUTHORIZED', 'Admin access required.');
  }

  const { id } = await params;

  const [conceptResult, teachersResult, outEdgesResult, inEdgesResult] = await Promise.all([
    supabase
      .from('concepts')
      .select('id, name, normalized_name, description, chunk_count, created_at, updated_at')
      .eq('id', id)
      .single(),

    supabase
      .from('concept_teachers')
      .select('teacher_name, perspective_summary, chunk_count')
      .eq('concept_id', id)
      .not('perspective_summary', 'is', null)
      .order('chunk_count', { ascending: false }),

    supabase
      .from('concept_relations')
      .select('to_concept_id, relation_type, strength, concepts!concept_relations_to_concept_id_fkey(id, name)')
      .eq('from_concept_id', id)
      .order('strength', { ascending: false }),

    supabase
      .from('concept_relations')
      .select('from_concept_id, relation_type, strength, concepts!concept_relations_from_concept_id_fkey(id, name)')
      .eq('to_concept_id', id)
      .order('strength', { ascending: false }),
  ]);

  if (conceptResult.error) {
    if (conceptResult.error.code === 'PGRST116') {
      return errorResponse(404, 'NOT_FOUND', 'Concept not found.');
    }
    console.error(`[/api/admin/concept-graph/nodes/${id}] db_error: ${conceptResult.error.message}`);
    return errorResponse(502, 'DB_ERROR', 'Failed to query concept.');
  }

  if (teachersResult.error) {
    console.error(`[/api/admin/concept-graph/nodes/${id}] teachers_error: ${teachersResult.error.message}`);
    return errorResponse(502, 'DB_ERROR', 'Failed to query teacher perspectives.');
  }

  if (outEdgesResult.error || inEdgesResult.error) {
    const msg = outEdgesResult.error?.message ?? inEdgesResult.error?.message;
    console.error(`[/api/admin/concept-graph/nodes/${id}] edges_error: ${msg}`);
    return errorResponse(502, 'DB_ERROR', 'Failed to query concept relations.');
  }

  const concept = conceptResult.data;

  const teachers = (teachersResult.data ?? []).map((row) => ({
    teacher: row.teacher_name,
    summary: row.perspective_summary,
    chunkCount: row.chunk_count,
  }));

  type EdgeRow = { relation_type: string; strength: number; concepts: { id: string; name: string } | null };

  const outEdges = ((outEdgesResult.data ?? []) as unknown as EdgeRow[]).map((row) => ({
    direction: 'out' as const,
    relationType: row.relation_type,
    strength: row.strength,
    concept: row.concepts ? { id: row.concepts.id, name: row.concepts.name } : null,
  }));

  const inEdges = ((inEdgesResult.data ?? []) as unknown as EdgeRow[]).map((row) => ({
    direction: 'in' as const,
    relationType: row.relation_type,
    strength: row.strength,
    concept: row.concepts ? { id: row.concepts.id, name: row.concepts.name } : null,
  }));

  return NextResponse.json({
    concept: {
      id: concept.id,
      name: concept.name,
      normalizedName: concept.normalized_name,
      description: concept.description,
      chunkCount: concept.chunk_count,
      createdAt: concept.created_at,
      updatedAt: concept.updated_at,
    },
    teachers,
    edges: [...outEdges, ...inEdges],
  });
}
