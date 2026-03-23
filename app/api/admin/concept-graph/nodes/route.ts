/**
 * GET /api/admin/concept-graph/nodes — paginated concept node browse/search
 *
 * Auth: Authorization: Bearer <ADMIN_WALLET>
 *
 * Query params:
 *   q      — search term matched against concept name (case-insensitive, optional)
 *   page   — 1-based page number (default: 1)
 *   limit  — page size, max 200 (default: 50)
 *
 * Response:
 *   nodes   — array of concept nodes { id, name, normalizedName, description, chunkCount, createdAt, updatedAt }
 *   total   — total matching records
 *   page    — current page
 *   limit   — page size
 *   pages   — total page count
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { isAdminRequest } from '@/lib/admin-auth';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function errorResponse(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!isAdminRequest(req)) {
    return errorResponse(401, 'UNAUTHORIZED', 'Admin access required.');
  }

  const params = req.nextUrl.searchParams;
  const q = params.get('q')?.trim() ?? '';
  const page = Math.max(1, parseInt(params.get('page') ?? '1', 10) || 1);
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(params.get('limit') ?? String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT));
  const from = (page - 1) * limit;
  const to = from + limit - 1;

  let query = supabase
    .from('concepts')
    .select('id, name, normalized_name, description, chunk_count, created_at, updated_at', { count: 'exact' })
    .order('chunk_count', { ascending: false })
    .range(from, to);

  if (q) {
    query = query.ilike('name', `%${q}%`);
  }

  const { data, error, count } = await query;

  if (error) {
    console.error(`[/api/admin/concept-graph/nodes] db_error: ${error.message}`);
    return errorResponse(502, 'DB_ERROR', 'Failed to query concept nodes.');
  }

  const total = count ?? 0;
  const nodes = (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    normalizedName: row.normalized_name,
    description: row.description,
    chunkCount: row.chunk_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));

  return NextResponse.json({
    nodes,
    total,
    page,
    limit,
    pages: Math.ceil(total / limit),
  });
}
