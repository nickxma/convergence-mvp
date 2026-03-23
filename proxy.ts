/**
 * proxy.ts — CORS enforcement, preflight handling, and API-wide rate limiting.
 *
 * Execution order (per Next.js 16 docs):
 *   1. CORS: all /api/* requests get CORS response headers based on the
 *      incoming Origin against an allowlist. OPTIONS preflights are short-
 *      circuited here with a 204 response.
 *   2. Rate limiting: per-IP sliding window on GET requests that are not
 *      handled by a tighter per-route limit.
 *
 * CORS allowlist (evaluated at module load, so env vars must be set before startup):
 *   NEXT_PUBLIC_APP_URL   — your production/staging origin (required in prod)
 *   CORS_ALLOWED_ORIGINS  — comma-separated extra origins (e.g. mobile app, staging)
 *   localhost:3000/3001   — always allowed in NODE_ENV !== 'production'
 *
 * Health probes (/api/health, /api/ready) skip rate limiting and get open CORS
 * so monitoring services can reach them without origin restrictions.
 *
 * Rate limiting requires Upstash Redis (UPSTASH_REDIS_REST_URL + TOKEN).
 * When Redis is not configured this is a no-op — per-route limits still apply.
 *
 * Bypass: requests carrying X-Internal-Token: <INTERNAL_API_TOKEN> skip rate limits.
 *
 * NOTE: In Next.js 16 the middleware file is named proxy.ts (renamed from middleware.ts).
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// ── Rate limiting ─────────────────────────────────────────────────────────────

const GET_RL_ANON = 60; // requests per window per IP
const WINDOW_SEC = 60;

/** Routes that enforce their own tighter limits — skip generic proxy check. */
const SKIP_RATE_LIMIT_PATHS = ['/api/ask', '/api/community/posts'];

/** Public probe routes: open CORS + no rate limiting. */
const PUBLIC_PROBE_PATHS = ['/api/health', '/api/ready'];

// ── CORS ──────────────────────────────────────────────────────────────────────

/**
 * Build the set of allowed origins from environment configuration.
 * Called once at module load time; requires env vars set before startup.
 *
 *   NEXT_PUBLIC_APP_URL   — primary production origin
 *   CORS_ALLOWED_ORIGINS  — comma-separated additional origins
 *   localhost             — auto-added in non-production environments
 */
function buildAllowedOrigins(): Set<string> {
  const origins = new Set<string>();

  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (appUrl) origins.add(appUrl.replace(/\/$/, '')); // strip trailing slash

  // Allow localhost in non-production environments only
  if (process.env.NODE_ENV !== 'production') {
    origins.add('http://localhost:3000');
    origins.add('http://localhost:3001');
  }

  const extra = process.env.CORS_ALLOWED_ORIGINS;
  if (extra) {
    extra
      .split(',')
      .map((o) => o.trim().replace(/\/$/, ''))
      .filter(Boolean)
      .forEach((o) => origins.add(o));
  }

  return origins;
}

const ALLOWED_ORIGINS = buildAllowedOrigins();

const CORS_VARY_HEADERS = {
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
} as const;

// ── Utilities ─────────────────────────────────────────────────────────────────

/** Extract best client IP from forwarded headers. */
function clientIp(req: NextRequest): string {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return req.headers.get('x-real-ip') ?? 'unknown';
}

/**
 * Redis-based rate limit check using the Upstash REST API (INCR + EXPIRE NX pipeline).
 * Returns blocked: true when the counter exceeds the limit.
 * Returns blocked: false (pass through) when Redis is unavailable or unconfigured.
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

// ── Proxy ─────────────────────────────────────────────────────────────────────

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Public probe endpoints: open CORS, no rate limiting.
  // Monitoring tools and CDN health checkers don't send an Origin header, so
  // we use * rather than a specific origin.
  if (PUBLIC_PROBE_PATHS.some((p) => pathname.startsWith(p))) {
    const response = NextResponse.next();
    response.headers.set('Access-Control-Allow-Origin', '*');
    return response;
  }

  // Resolve the requesting origin and check against the allowlist.
  const origin = req.headers.get('origin') ?? '';
  const isAllowedOrigin = origin !== '' && ALLOWED_ORIGINS.has(origin);

  // Handle CORS preflight (OPTIONS).
  // Short-circuit before rate limiting — preflights carry no payload.
  if (req.method === 'OPTIONS') {
    const headers: Record<string, string> = { ...CORS_VARY_HEADERS };
    if (isAllowedOrigin) headers['Access-Control-Allow-Origin'] = origin;
    return new NextResponse(null, { status: 204, headers });
  }

  // Rate limiting: applies only to GET requests not handled per-route.
  let rateLimitedResponse: NextResponse | null = null;
  if (req.method === 'GET' && !SKIP_RATE_LIMIT_PATHS.some((p) => pathname.startsWith(p))) {
    const internalToken = process.env.INTERNAL_API_TOKEN;
    const isInternal = internalToken && req.headers.get('x-internal-token') === internalToken;

    if (!isInternal) {
      const ip = clientIp(req);
      const redisKey = `rl:proxy:get:${ip}`;
      const { blocked } = await redisCheck(redisKey, GET_RL_ANON, WINDOW_SEC);

      if (blocked) {
        rateLimitedResponse = NextResponse.json(
          { error: 'Rate limit exceeded', retryAfter: WINDOW_SEC },
          { status: 429, headers: { 'Retry-After': String(WINDOW_SEC) } },
        );
      }
    }
  }

  // Attach CORS headers to the response (pass-through or 429).
  // Always set the headers so the browser can read the response body on error.
  const response = rateLimitedResponse ?? NextResponse.next();
  if (isAllowedOrigin) {
    response.headers.set('Access-Control-Allow-Origin', origin);
    for (const [key, value] of Object.entries(CORS_VARY_HEADERS)) {
      response.headers.set(key, value);
    }
  }

  return response;
}

export const config = {
  matcher: '/api/:path*',
};
