/**
 * PATCH /api/admin/documents/[id]
 *   Update document tags and/or authority score.
 *   Body: { tags?: string[], authorityScore?: number }
 *
 * DELETE /api/admin/documents/[id]
 *   Remove document from DB and delete its vectors from Pinecone.
 *
 * Auth: Authorization: Bearer <ADMIN_WALLET>
 */

import { NextRequest, NextResponse } from 'next/server';
import { Pinecone } from '@pinecone-database/pinecone';
import { supabase } from '@/lib/supabase';
import { isAdminRequest } from '@/lib/admin-auth';

const PINECONE_NAMESPACE = 'documents';

function err(status: number, message: string) {
  return NextResponse.json({ error: message }, { status });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!isAdminRequest(req)) return err(401, 'Admin access required.');

  const { id } = await params;

  let body: { tags?: unknown; authorityScore?: unknown };
  try {
    body = await req.json();
  } catch {
    return err(400, 'Request body must be JSON.');
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (body.tags !== undefined) {
    if (!Array.isArray(body.tags) || !body.tags.every((t) => typeof t === 'string')) {
      return err(400, '"tags" must be an array of strings.');
    }
    updates.tags = (body.tags as string[]).map((t) => t.trim()).filter(Boolean);
  }

  if (body.authorityScore !== undefined) {
    const score = Number(body.authorityScore);
    if (!Number.isFinite(score) || score < 0 || score > 1) {
      return err(400, '"authorityScore" must be a number between 0 and 1.');
    }
    updates.authority_score = Math.round(score * 100) / 100;
  }

  if (Object.keys(updates).length === 1) {
    return err(400, 'Provide at least one of: tags, authorityScore.');
  }

  const { data, error } = await supabase
    .from('documents')
    .update(updates)
    .eq('id', id)
    .select('id, tags, authority_score')
    .single();

  if (error) {
    if (error.code === 'PGRST116') return err(404, 'Document not found.');
    console.error('[/api/admin/documents/[id]] patch error:', error.message);
    return err(502, 'Failed to update document.');
  }

  return NextResponse.json({ id: data.id, tags: data.tags, authorityScore: data.authority_score });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!isAdminRequest(req)) return err(401, 'Admin access required.');

  const { id } = await params;

  // Fetch the document first to get its sourceId for Pinecone deletion
  const { data: doc, error: fetchErr } = await supabase
    .from('documents')
    .select('id, source_id')
    .eq('id', id)
    .single();

  if (fetchErr) {
    if (fetchErr.code === 'PGRST116') return err(404, 'Document not found.');
    console.error('[/api/admin/documents/[id]] fetch error:', fetchErr.message);
    return err(502, 'Failed to fetch document.');
  }

  // Delete vectors from Pinecone
  try {
    const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! });
    const ns = pc.Index(process.env.PINECONE_INDEX ?? 'convergence-mvp').namespace(PINECONE_NAMESPACE);
    await ns.deleteMany({ filter: { sourceId: doc.source_id } });
  } catch (e) {
    // Log but don't fail — DB record deletion proceeds regardless
    console.error('[/api/admin/documents/[id]] pinecone delete error:', (e as Error).message);
  }

  // Delete from DB
  const { error: deleteErr } = await supabase.from('documents').delete().eq('id', id);

  if (deleteErr) {
    console.error('[/api/admin/documents/[id]] db delete error:', deleteErr.message);
    return err(502, 'Failed to delete document from database.');
  }

  return new NextResponse(null, { status: 204 });
}
