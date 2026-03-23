import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';

/**
 * POST /api/qa/chat/stream
 *
 * SSE-streaming wrapper over the core /api/ask RAG pipeline.
 *
 * When the client sends `Accept: text/event-stream` the response is a
 * Server-Sent Events stream:
 *   - Each delta event: `data: {"delta":"<token>","session_id":"<id>"}\n\n`
 *   - Final metadata event: `data: {"done":true,"session_id":"<id>","answerId":"...", ...}\n\n`
 *   - Sentinel: `data: [DONE]\n\n`
 *
 * When the client omits `Accept: text/event-stream` the response is a
 * plain JSON object (identical to /api/ask?stream=false) with an added
 * `session_id` field.
 *
 * Request body fields:
 *   question       string  required
 *   session_id     string  optional – conversation UUID; created if absent
 *   history        array   optional – prior turns for multi-turn context
 *   answerStyle    string  optional
 *   teacher        string  optional
 *   essaySlug      string  optional
 *   courseSlug     string  optional
 */
export async function POST(req: NextRequest) {
  const accept = req.headers.get('accept') ?? '';
  const wantsStream = accept.includes('text/event-stream');

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON.' } },
      { status: 400 },
    );
  }

  // Normalise session_id → conversationId for /api/ask
  const sessionId: string =
    (typeof body.session_id === 'string' && body.session_id.trim()) ||
    (typeof body.conversationId === 'string' && body.conversationId.trim()) ||
    randomUUID();

  const { session_id: _drop, ...rest } = body as { session_id?: unknown } & Record<string, unknown>;
  const forwardBody = { ...rest, conversationId: sessionId };

  // Build internal URL (same origin)
  const askUrl = new URL('/api/ask', req.url);
  if (!wantsStream) {
    askUrl.searchParams.set('stream', 'false');
  }

  // Forward auth + client-IP headers so /api/ask can authenticate and
  // rate-limit the caller correctly
  const forwardHeaders = new Headers();
  forwardHeaders.set('content-type', 'application/json');
  const auth = req.headers.get('authorization');
  if (auth) forwardHeaders.set('authorization', auth);
  const cookie = req.headers.get('cookie');
  if (cookie) forwardHeaders.set('cookie', cookie);
  const xff = req.headers.get('x-forwarded-for');
  if (xff) forwardHeaders.set('x-forwarded-for', xff);
  const xri = req.headers.get('x-real-ip');
  if (xri) forwardHeaders.set('x-real-ip', xri);

  let upstream: Response;
  try {
    upstream = await fetch(askUrl.toString(), {
      method: 'POST',
      headers: forwardHeaders,
      body: JSON.stringify(forwardBody),
    });
  } catch (err) {
    console.error(
      `[/api/qa/chat/stream] upstream_fetch_error err=${err instanceof Error ? err.message : String(err)}`,
    );
    return NextResponse.json(
      { error: { code: 'UPSTREAM_ERROR', message: 'Failed to reach Q&A service.' } },
      { status: 502 },
    );
  }

  // ── Non-streaming path ──────────────────────────────────────────────────
  if (!wantsStream) {
    let data: Record<string, unknown>;
    try {
      data = await upstream.json();
    } catch {
      return NextResponse.json(
        { error: { code: 'UPSTREAM_ERROR', message: 'Invalid response from Q&A service.' } },
        { status: 502 },
      );
    }
    return NextResponse.json(
      { ...data, session_id: data.conversationId ?? sessionId },
      { status: upstream.status },
    );
  }

  // ── Streaming path ──────────────────────────────────────────────────────
  if (!upstream.body) {
    return NextResponse.json(
      { error: { code: 'UPSTREAM_ERROR', message: 'No stream body from Q&A service.' } },
      { status: 502 },
    );
  }

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const transformedStream = new ReadableStream({
    async start(controller) {
      const reader = upstream.body!.getReader();
      let buffer = '';

      const emit = (payload: object) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // SSE events are delimited by double newline
          const parts = buffer.split('\n\n');
          // The last element may be an incomplete event — keep it in buffer
          buffer = parts.pop() ?? '';

          for (const part of parts) {
            const trimmed = part.trim();
            if (!trimmed.startsWith('data: ')) continue;
            const raw = trimmed.slice(6);

            try {
              const event = JSON.parse(raw) as Record<string, unknown>;
              // Inject session_id into every event
              emit({ ...event, session_id: sessionId });

              if (event.done === true) {
                // Emit the standard [DONE] sentinel after the final metadata event
                controller.enqueue(encoder.encode('data: [DONE]\n\n'));
              }
            } catch {
              // Non-JSON event (e.g. upstream comments) — pass through as-is
              controller.enqueue(encoder.encode(`${part}\n\n`));
            }
          }
        }
      } catch (err) {
        console.error(
          `[/api/qa/chat/stream] transform_error err=${err instanceof Error ? err.message : String(err)}`,
        );
        try {
          emit({ error: 'Stream error — please retry.' });
        } catch { /* stream already closing */ }
      } finally {
        try { controller.close(); } catch { /* already closed */ }
      }
    },
  });

  return new Response(transformedStream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
