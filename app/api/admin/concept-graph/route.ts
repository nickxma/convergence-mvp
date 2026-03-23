/**
 * GET /api/admin/concept-graph — concept graph metadata
 *
 * Auth: Authorization: Bearer <ADMIN_WALLET>
 *
 * Response:
 *   nodeCount    — total number of concept nodes
 *   edgeCount    — total number of concept relations
 *   lastUpdated  — ISO timestamp of most recently updated concept (null if empty)
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

  const [conceptsResult, relationsResult, lastUpdatedResult] = await Promise.all([
    supabase.from('concepts').select('id', { count: 'exact', head: true }),
    supabase.from('concept_relations').select('from_concept_id', { count: 'exact', head: true }),
    supabase.from('concepts').select('updated_at').order('updated_at', { ascending: false }).limit(1),
  ]);

  for (const result of [conceptsResult, relationsResult, lastUpdatedResult]) {
    if (result.error) {
      console.error(`[/api/admin/concept-graph] db_error: ${result.error.message}`);
      return errorResponse(502, 'DB_ERROR', 'Failed to query concept graph data.');
    }
  }

  const lastUpdatedRow = lastUpdatedResult.data?.[0];

  return NextResponse.json({
    nodeCount: conceptsResult.count ?? 0,
    edgeCount: relationsResult.count ?? 0,
    lastUpdated: lastUpdatedRow?.updated_at ?? null,
  });
}
