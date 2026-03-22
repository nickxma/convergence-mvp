/**
 * GET  /api/reading-list          — fetch the user's reading list (with enriched qa_answer data)
 * POST /api/reading-list          — add an item { type, refId }
 * DELETE /api/reading-list        — remove an item (body: { type, refId })
 *
 * Auth: Authorization: Bearer <privy-access-token>
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { verifyRequest } from '@/lib/privy-auth';

function errorResponse(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const authResult = await verifyRequest(req);
  if (!authResult?.userId) {
    return errorResponse(401, 'UNAUTHORIZED', 'Authentication required.');
  }

  const { data: items, error } = await supabase
    .from('reading_list')
    .select('id, type, ref_id, created_at')
    .eq('user_id', authResult.userId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[/api/reading-list] GET db_error:', error.message);
    return errorResponse(502, 'DB_ERROR', 'Failed to fetch reading list.');
  }

  if (!items || items.length === 0) {
    return NextResponse.json({ items: [] });
  }

  // Enrich qa_answer entries with question/answer/sources from qa_answers table
  const qaIds = items
    .filter((item) => item.type === 'qa_answer')
    .map((item) => item.ref_id);

  let qaAnswersMap: Record<string, { question: string; answer: string; sources: { speaker: string }[] }> = {};

  if (qaIds.length > 0) {
    const { data: qaRows, error: qaError } = await supabase
      .from('qa_answers')
      .select('id, question, answer, sources')
      .in('id', qaIds);

    if (!qaError && qaRows) {
      for (const row of qaRows) {
        qaAnswersMap[row.id] = {
          question: row.question,
          answer: row.answer,
          sources: Array.isArray(row.sources) ? row.sources : [],
        };
      }
    }
  }

  const enriched = items.map((item) => {
    if (item.type === 'qa_answer') {
      const qa = qaAnswersMap[item.ref_id];
      if (!qa) return null; // answer deleted, skip
      const excerpt = qa.answer.replace(/\[\d+\]/g, '').trim().slice(0, 100);
      const teachers = Array.from(
        new Set(
          qa.sources
            .map((s) => s.speaker)
            .filter(Boolean)
        )
      );
      return {
        id: item.id,
        type: item.type,
        refId: item.ref_id,
        createdAt: item.created_at,
        question: qa.question,
        excerpt,
        teachers,
        url: `/qa/${item.ref_id}`,
      };
    }
    // essay (future): return minimal shape
    return {
      id: item.id,
      type: item.type,
      refId: item.ref_id,
      createdAt: item.created_at,
    };
  }).filter(Boolean);

  return NextResponse.json({ items: enriched });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const authResult = await verifyRequest(req);
  if (!authResult?.userId) {
    return errorResponse(401, 'UNAUTHORIZED', 'Authentication required.');
  }

  let body: Record<string, unknown> | null = null;
  try {
    body = await req.json();
  } catch {
    return errorResponse(400, 'INVALID_JSON', 'Request body must be valid JSON.');
  }

  const type = typeof body?.type === 'string' ? body.type.trim() : '';
  const refId = typeof body?.refId === 'string' ? body.refId.trim() : '';

  if (!type || !['essay', 'qa_answer'].includes(type)) {
    return errorResponse(400, 'INVALID_TYPE', 'type must be "essay" or "qa_answer".');
  }
  if (!refId) {
    return errorResponse(400, 'MISSING_REF_ID', 'refId is required.');
  }

  const { data, error } = await supabase
    .from('reading_list')
    .upsert(
      { user_id: authResult.userId, type, ref_id: refId },
      { onConflict: 'user_id,type,ref_id' },
    )
    .select('id')
    .single();

  if (error) {
    console.error('[/api/reading-list] POST db_error:', error.message);
    return errorResponse(502, 'DB_ERROR', 'Failed to save to reading list.');
  }

  return NextResponse.json({ id: data.id }, { status: 201 });
}

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  const authResult = await verifyRequest(req);
  if (!authResult?.userId) {
    return errorResponse(401, 'UNAUTHORIZED', 'Authentication required.');
  }

  let body: Record<string, unknown> | null = null;
  try {
    body = await req.json();
  } catch {
    return errorResponse(400, 'INVALID_JSON', 'Request body must be valid JSON.');
  }

  const type = typeof body?.type === 'string' ? body.type.trim() : '';
  const refId = typeof body?.refId === 'string' ? body.refId.trim() : '';

  if (!type || !refId) {
    return errorResponse(400, 'MISSING_FIELDS', 'type and refId are required.');
  }

  const { error } = await supabase
    .from('reading_list')
    .delete()
    .eq('user_id', authResult.userId)
    .eq('type', type)
    .eq('ref_id', refId);

  if (error) {
    console.error('[/api/reading-list] DELETE db_error:', error.message);
    return errorResponse(502, 'DB_ERROR', 'Failed to remove from reading list.');
  }

  return NextResponse.json({ ok: true });
}
