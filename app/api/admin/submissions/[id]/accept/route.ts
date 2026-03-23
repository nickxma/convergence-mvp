/**
 * POST /api/admin/submissions/[id]/accept
 *
 * Accepts a guest essay submission:
 *   1. Creates a draft essay in the essays table (published = false)
 *   2. Marks the submission status as 'accepted'
 *
 * Auth: Authorization: Bearer <ADMIN_WALLET>
 *
 * Response:
 *   submissionId  string
 *   essayId       string  — newly created essay row id
 *   essaySlug     string  — generated slug
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { isAdminRequest, getAdminWallet } from '@/lib/admin-auth';
import { logAudit } from '@/lib/admin-audit-log';

function errorResponse(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

function toSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!isAdminRequest(req)) {
    return errorResponse(401, 'UNAUTHORIZED', 'Admin access required.');
  }

  const { id } = await params;

  // Fetch the submission
  const { data: submission, error: fetchErr } = await supabase
    .from('submissions')
    .select('id, title, body, name, bio, status')
    .eq('id', id)
    .single();

  if (fetchErr || !submission) {
    if (fetchErr?.code === 'PGRST116') {
      return errorResponse(404, 'NOT_FOUND', 'Submission not found.');
    }
    return errorResponse(500, 'DB_ERROR', 'Failed to fetch submission.');
  }

  if (submission.status === 'accepted') {
    return errorResponse(409, 'ALREADY_ACCEPTED', 'Submission has already been accepted.');
  }

  // Generate a unique slug from the title
  const baseSlug = toSlug(submission.title) || 'guest-essay';
  let slug = baseSlug;
  let attempt = 0;

  // Ensure slug uniqueness
  while (attempt < 10) {
    const { data: existing } = await supabase
      .from('essays')
      .select('id')
      .eq('slug', slug)
      .maybeSingle();

    if (!existing) break;
    attempt += 1;
    slug = `${baseSlug}-${attempt}`;
  }

  // Build essay body: prepend guest author attribution line
  const byLine = submission.bio
    ? `*By ${submission.name} — ${submission.bio}*\n\n`
    : `*By ${submission.name}*\n\n`;
  const bodyMarkdown = byLine + submission.body;

  // Create draft essay (published = false so Nick can review/edit before publishing)
  const { data: essay, error: essayErr } = await supabase
    .from('essays')
    .insert({
      slug,
      title: submission.title,
      body_markdown: bodyMarkdown,
      tags: [],
      published: false,
    })
    .select('id, slug')
    .single();

  if (essayErr || !essay) {
    console.error('[admin/submissions/accept] essay_insert_error:', essayErr?.message);
    return errorResponse(500, 'DB_ERROR', 'Failed to create draft essay.');
  }

  // Mark submission as accepted
  const { error: updateErr } = await supabase
    .from('submissions')
    .update({ status: 'accepted' })
    .eq('id', id);

  if (updateErr) {
    console.error('[admin/submissions/accept] submission_update_error:', updateErr.message);
    // Essay was created — don't roll back, just log and continue
  }

  logAudit({
    actorId: getAdminWallet(req) ?? 'admin',
    actorRole: 'admin',
    action: 'content.publish',
    targetId: id,
    targetType: 'submission',
    metadata: { essayId: essay.id, essaySlug: essay.slug },
  });

  return NextResponse.json({
    submissionId: id,
    essayId: essay.id,
    essaySlug: essay.slug,
  });
}
