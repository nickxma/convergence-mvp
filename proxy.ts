/**
 * proxy.ts — API-wide rate limiting for all public routes.
 *
 * Applies a per-IP sliding window limit to every /api/* GET request that is not
 * already handled by a tighter per-route limit (e.g. /api/ask, /api/community/posts).
 *
 * Requires Upstash Redis (UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN).
 * When Redis is not configured this proxy is a no-op — per-route limits still apply.
 *
 * Bypass: requests carrying `X-Internal-Token: <INTERNAL_API_TOKEN>` skip all checks.
 *
 * NOTE: In Next.js 16 the middleware file is named `proxy.ts` (renamed from middleware.ts).
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Generic GET limits (requests per minute, per IP)
const GET_RL_ANON = 60;
const WINDOW_SEC = 60;

/** Extract best client IP. */
function clientIp(req: NextRequest): string {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return req.headers.get('x-real-ip') ?? 'unknown';
}

/**
 * Redis-based rate limit check using the Upstash REST API (INCR + EXPIRE NX pipeline).
 * Returns `blocked: true` when the counter exceeds the limit.
 * Returns `blocked: false` (pass through) when Redis is unavailable or unconfigured.
 */
async function redisCheck(
  key: string,
  limit: number,
  windowSec: number,
): Promise<{ blocked: boolean }> {
  const restUrl = process.env.UPSTASH_REDIS_REST_URL;
  const restToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!restUrl || !restToken) return { blocked: false };

  try {
    const res = await fetch(`${restUrl}/pipeline`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${restToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([
        ['INCR', key],
        ['EXPIRE', key, windowSec, 'NX'],
      ]),
    });
    if (!res.ok) return { blocked: false };
    const results = (await res.json()) as Array<{ result: number }>;
    const count = results[0]?.result ?? 0;
    return { blocked: count > limit };
  } catch {
    return { blocked: false };
  }
}

/** Routes that enforce their own tighter limits — skip generic proxy check. */
const SKIP_PATHS = ['/api/ask', '/api/community/posts'];

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Only rate-limit GET requests to /api/* that aren't handled per-route
  if (req.method !== 'GET') return NextResponse.next();
  if (SKIP_PATHS.some((p) => pathname.startsWith(p))) return NextResponse.next();

  // Internal bypass
  const internalToken = process.env.INTERNAL_API_TOKEN;
  if (internalToken && req.headers.get('x-internal-token') === internalToken) {
    return NextResponse.next();
  }

  const ip = clientIp(req);
  const redisKey = `rl:proxy:get:${ip}`;
  const { blocked } = await redisCheck(redisKey, GET_RL_ANON, WINDOW_SEC);

  if (blocked) {
    return NextResponse.json(
      { error: 'Rate limit exceeded', retryAfter: WINDOW_SEC },
      { status: 429, headers: { 'Retry-After': String(WINDOW_SEC) } },
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: '/api/:path*',
};
