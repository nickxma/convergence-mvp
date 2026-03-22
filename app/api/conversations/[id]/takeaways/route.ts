/**
 * GET  /api/conversations/:id/takeaways — returns stored takeaways or 404.
 * POST /api/conversations/:id/takeaways — triggers async generation (202) or returns 200 if already done.
 *                                         Admin can POST to regenerate even if takeaways exist.
 *
 * Auth: Bearer token (Privy JWT) required. Session must belong to the authenticated user.
 * Admin (ADMIN_WALLET bearer) may POST to regenerate takeaways for any session.
 */
import { after, NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { verifyRequest } from '@/lib/privy-auth';
import { isAdminRequest } from '@/lib/admin-auth';
import { supabase } from '@/lib/supabase';
import { logOpenAIUsage } from '@/lib/openai-usage';

const TAKEAWAY_MODEL = 'gpt-4o-mini';
const UUID_RE = /^[0-9a-f-]{36}$/i;

function badId() {
  return NextResponse.json({ error: { code: 'BAD_REQUEST', message: 'Invalid conversation id.' } }, { status: 400 });
}

function unauthorized() {
  return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required.' } }, { status: 401 });
}

function notFound() {
  return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Not found.' } }, { status: 404 });
}

/** Generate 3-point takeaways from session history and store in DB. */
async function generateAndStore(
  sessionId: string,
  history: Array<{ role: string; content: string }>,
): Promise<void> {
  const sessionText = history
    .map((m) => `${m.role === 'user' ? 'Q' : 'A'}: ${m.content}`)
    .join('\n\n')
    .trim();

  if (!sessionText) return;

  const oai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  let takeaways: string[] = [];
  try {
    const resp = await oai.chat.completions.create({
      model: TAKEAWAY_MODEL,
      messages: [
        {
          role: 'system',
          content:
            'You generate key takeaways from mindfulness Q&A sessions. Return exactly 3 key takeaways as a JSON array of strings. Each takeaway must be one clear, insightful sentence capturing a core idea from the session. Output only the JSON array, no other text.',
        },
        {
          role: 'user',
          content: `Generate exactly 3 key takeaways from this mindfulness session content. Each takeaway should be one clear sentence. Return as JSON array.\n\n${sessionText}`,
        },
      ],
      temperature: 0.4,
      max_tokens: 200,
    });

    logOpenAIUsage({
      model: TAKEAWAY_MODEL,
      endpoint: 'completion',
      promptTokens: resp.usage?.prompt_tokens ?? 0,
      completionTokens: resp.usage?.completion_tokens ?? 0,
      cachedTokens: resp.usage?.prompt_tokens_details?.cached_tokens ?? 0,
    });

    const raw = resp.choices[0]?.message?.content ?? '[]';
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        takeaways = parsed.slice(0, 3).map(String);
      }
    } catch {
      // Fallback: treat newline-separated lines as takeaways
      takeaways = raw.split('\n').map((l) => l.replace(/^[\d.\-\s*]+/, '').trim()).filter(Boolean).slice(0, 3);
    }
  } catch (err) {
    console.error(`[takeaways] openai_error session=${sessionId} err=${err instanceof Error ? err.message : String(err)}`);
    return;
  }

  if (takeaways.length === 0) return;

  const { error } = await supabase
    .from('session_takeaways')
    .upsert(
      { session_id: sessionId, takeaways, model: TAKEAWAY_MODEL, generated_at: new Date().toISOString() },
      { onConflict: 'session_id' },
    );

  if (error) {
    console.warn(`[takeaways] db_write_error session=${sessionId} err=${error.message}`);
  }
}

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authResult = await verifyRequest(req);
  if (!authResult) return unauthorized();

  const { id } = await params;
  if (!UUID_RE.test(id)) return badId();

  // Verify session ownership
  const { data: session } = await supabase
    .from('conversation_sessions')
    .select('id')
    .eq('id', id)
    .eq('user_id', authResult.userId)
    .single();

  if (!session) return notFound();

  const { data } = await supabase
    .from('session_takeaways')
    .select('takeaways, generated_at, model')
    .eq('session_id', id)
    .single();

  if (!data) return notFound();

  return NextResponse.json({
    sessionId: id,
    takeaways: data.takeaways as string[],
    generatedAt: data.generated_at as string,
    model: data.model as string,
  });
}

// ── POST ──────────────────────────────────────────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authResult = await verifyRequest(req);
  const adminReq = isAdminRequest(req);

  if (!authResult && !adminReq) return unauthorized();

  const { id } = await params;
  if (!UUID_RE.test(id)) return badId();

  // Fetch session — admin can access any session, users only their own
  let sessionQuery = supabase
    .from('conversation_sessions')
    .select('id, history, user_id, message_count')
    .eq('id', id);

  if (!adminReq && authResult) {
    sessionQuery = sessionQuery.eq('user_id', authResult.userId);
  }

  const { data: session } = await sessionQuery.single();
  if (!session) return notFound();

  // Require at least 2 turns (4 messages: 2 user + 2 assistant)
  if ((session.message_count as number) < 4 && !adminReq) {
    return NextResponse.json(
      { error: { code: 'TOO_SHORT', message: 'Session needs at least 2 Q&A turns for takeaways.' } },
      { status: 422 },
    );
  }

  // Non-admin: skip if already generated
  if (!adminReq) {
    const { data: existing } = await supabase
      .from('session_takeaways')
      .select('session_id')
      .eq('session_id', id)
      .single();

    if (existing) {
      return NextResponse.json({ status: 'already_generated' });
    }
  }

  const history = session.history as Array<{ role: string; content: string }>;

  // Fire generation after response is sent (Next.js `after`)
  after(async () => {
    await generateAndStore(id, history);
  });

  return NextResponse.json({ status: 'generating' }, { status: 202 });
}
