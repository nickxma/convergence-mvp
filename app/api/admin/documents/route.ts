/**
 * GET /api/admin/documents
 *
 * Lists all admin-ingested documents with chunk counts and last-indexed date.
 *
 * Auth: Authorization: Bearer <ADMIN_WALLET>
 *
 * Query params (all optional):
 *   status  — filter by status: pending|processing|done|error
 *   limit   — max results (default 50, max 200)
 *   offset  — pagination offset (default 0)
 *
 * Response:
 *   { documents: DocumentRow[], total: number }
 *
 * DocumentRow:
 *   id, sourceId, title, url, author, publishedAt,
 *   chunkCount, status, errorMessage, indexedAt, createdAt, updatedAt,
 *   tags, authorityScore, citationCount, positiveRatioWhenCited, qualityUpdatedAt
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { isAdminRequest } from '@/lib/admin-auth';

function err(status: number, message: string) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!isAdminRequest(req)) return err(401, 'Admin access required.');

  const params = req.nextUrl.searchParams;
  const status = params.get('status');
  const limit = Math.min(Number(params.get('limit') ?? '50'), 200);
  const offset = Math.max(Number(params.get('offset') ?? '0'), 0);

  const validStatuses = ['pending', 'processing', 'done', 'error'];
  if (status && !validStatuses.includes(status)) {
    return err(400, `Invalid status "${status}". Must be one of: ${validStatuses.join(', ')}`);
  }

  let query = supabase
    .from('documents')
    .select(
      'id, source_id, title, url, author, published_at, chunk_count, status, error_message, indexed_at, created_at, updated_at, tags, authority_score, citation_count, positive_ratio_when_cited, quality_updated_at',
      { count: 'exact' },
    )
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (status) query = query.eq('status', status);

  const { data, error, count } = await query;

  if (error) {
    console.error('[/api/admin/documents] db error:', error.message);
    return err(502, 'Failed to query documents.');
  }

  const documents = (data ?? []).map((row) => ({
    id: row.id as string,
    sourceId: row.source_id as string,
    title: row.title as string | null,
    url: row.url as string | null,
    author: row.author as string | null,
    publishedAt: row.published_at as string | null,
    chunkCount: row.chunk_count as number,
    status: row.status as string,
    errorMessage: row.error_message as string | null,
    indexedAt: row.indexed_at as string | null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    tags: (row.tags as string[]) ?? [],
    authorityScore: row.authority_score as number,
    citationCount: row.citation_count as number,
    positiveRatioWhenCited: row.positive_ratio_when_cited as number | null,
    qualityUpdatedAt: row.quality_updated_at as string | null,
  }));

  return NextResponse.json({ documents, total: count ?? documents.length });
}
