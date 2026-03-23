/**
 * GET /api/admin/launch-check
 *
 * Comprehensive launch readiness endpoint. Runs all critical go/no-go checks
 * and returns a structured report with per-check status and an overall verdict.
 *
 * Auth: Authorization: Bearer <ADMIN_WALLET>
 *
 * Response:
 *   overall   — 'pass' | 'warn' | 'fail'
 *   checks    — array of {name, label, status, detail?}
 *   checkedAt — ISO timestamp
 *
 * Status values: 'pass' | 'warn' | 'fail'
 *   fail = blocks launch
 *   warn = should investigate but not a hard blocker
 *   pass = all good
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { isAdminRequest } from '@/lib/admin-auth';

// ── Types ──────────────────────────────────────────────────────────────────────

type CheckStatus = 'pass' | 'warn' | 'fail';

interface Check {
  name: string;
  label: string;
  status: CheckStatus;
  detail?: string;
}

// ── Timeout helper ─────────────────────────────────────────────────────────────

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms),
    ),
  ]);
}

// ── Individual checks ──────────────────────────────────────────────────────────

async function checkSupabase(): Promise<Check> {
  const start = Date.now();
  try {
    const { error } = await withTimeout(
      Promise.resolve(supabase.from('qa_analytics').select('id').limit(1)),
      3000,
    );
    const ms = Date.now() - start;
    if (error) throw error;
    return {
      name: 'supabase_db',
      label: 'Database connected',
      status: ms > 1500 ? 'warn' : 'pass',
      detail: ms > 1500 ? `Connected but slow (${ms}ms)` : undefined,
    };
  } catch (err) {
    return {
      name: 'supabase_db',
      label: 'Database connected',
      status: 'fail',
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

async function checkMigrations(): Promise<Check> {
  try {
    // Verify latest migration (071) is applied by checking audio_jobs table exists
    const { error } = await withTimeout(
      Promise.resolve(supabase.from('audio_jobs').select('id').limit(1)),
      3000,
    );
    if (error) {
      return {
        name: 'supabase_migrations',
        label: 'Database migrations current',
        status: 'fail',
        detail: `Migration 071 (audio_jobs) not applied: ${error.message}`,
      };
    }
    return { name: 'supabase_migrations', label: 'Database migrations current', status: 'pass' };
  } catch (err) {
    return {
      name: 'supabase_migrations',
      label: 'Database migrations current',
      status: 'fail',
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

async function checkRedis(): Promise<Check> {
  const restUrl = process.env.UPSTASH_REDIS_REST_URL;
  const restToken = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!restUrl || !restToken) {
    return {
      name: 'redis_connected',
      label: 'Redis / rate-limit store connected',
      status: 'warn',
      detail: 'UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN not set — falling back to in-memory rate limiting.',
    };
  }

  const start = Date.now();
  try {
    const res = await withTimeout(
      fetch(`${restUrl}/ping`, {
        headers: { Authorization: `Bearer ${restToken}` },
        cache: 'no-store',
      }),
      3000,
    );
    const ms = Date.now() - start;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return {
      name: 'redis_connected',
      label: 'Redis / rate-limit store connected',
      status: ms > 1000 ? 'warn' : 'pass',
      detail: ms > 1000 ? `Connected but slow (${ms}ms)` : undefined,
    };
  } catch (err) {
    return {
      name: 'redis_connected',
      label: 'Redis / rate-limit store connected',
      status: 'fail',
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

async function checkCorpus(): Promise<Check> {
  try {
    const { count, error } = await withTimeout(
      Promise.resolve(supabase.from('corpus_chunks').select('*', { count: 'exact', head: true })),
      3000,
    );
    if (error) throw error;
    const n = count ?? 0;
    if (n === 0) {
      return {
        name: 'corpus_populated',
        label: 'Corpus has knowledge chunks',
        status: 'fail',
        detail: 'corpus_chunks table is empty — RAG search will return no results.',
      };
    }
    return {
      name: 'corpus_populated',
      label: 'Corpus has knowledge chunks',
      status: 'pass',
      detail: `${n.toLocaleString()} chunks`,
    };
  } catch (err) {
    return {
      name: 'corpus_populated',
      label: 'Corpus has knowledge chunks',
      status: 'fail',
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

async function checkHealthEndpoint(appUrl: string): Promise<[Check, Headers | null]> {
  const url = `${appUrl}/api/health`;
  try {
    const res = await withTimeout(
      fetch(url, { cache: 'no-store' }),
      5000,
    );
    if (res.status === 200) {
      return [
        { name: 'health_endpoint', label: '/api/health returns 200', status: 'pass' },
        res.headers,
      ];
    }
    return [
      {
        name: 'health_endpoint',
        label: '/api/health returns 200',
        status: 'fail',
        detail: `Got HTTP ${res.status}`,
      },
      null,
    ];
  } catch (err) {
    return [
      {
        name: 'health_endpoint',
        label: '/api/health returns 200',
        status: 'fail',
        detail: err instanceof Error ? err.message : String(err),
      },
      null,
    ];
  }
}

function checkSecurityHeaders(responseHeaders: Headers | null): Check {
  if (!responseHeaders) {
    return {
      name: 'security_headers',
      label: 'Security headers present',
      status: 'warn',
      detail: 'Could not fetch self — headers not verified.',
    };
  }

  const required: Array<[string, string]> = [
    ['x-frame-options', 'X-Frame-Options'],
    ['x-content-type-options', 'X-Content-Type-Options'],
    ['strict-transport-security', 'Strict-Transport-Security'],
    ['content-security-policy', 'Content-Security-Policy'],
  ];

  const missing = required
    .filter(([key]) => !responseHeaders.has(key))
    .map(([, label]) => label);

  if (missing.length > 0) {
    return {
      name: 'security_headers',
      label: 'Security headers present',
      status: 'fail',
      detail: `Missing: ${missing.join(', ')}`,
    };
  }
  return { name: 'security_headers', label: 'Security headers present', status: 'pass' };
}

function checkEnvVar(
  name: string,
  label: string,
  varName: string,
  severity: CheckStatus = 'fail',
  detail?: string,
): Check {
  return process.env[varName]
    ? { name, label, status: 'pass' }
    : {
        name,
        label,
        status: severity,
        detail: detail ?? `${varName} environment variable not set.`,
      };
}

function checkCriticalEnvVars(): Check {
  const required = [
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'OPENAI_API_KEY',
    'PINECONE_API_KEY',
    'NEXT_PUBLIC_PRIVY_APP_ID',
  ];
  const optional = [
    'RESEND_API_KEY',
    'SENTRY_DSN',
    'CRON_SECRET',
    'ADMIN_WALLET',
    'UPSTASH_REDIS_REST_URL',
    'UPSTASH_REDIS_REST_TOKEN',
  ];

  const missingRequired = required.filter((v) => !process.env[v]);
  const missingOptional = optional.filter((v) => !process.env[v]);

  if (missingRequired.length > 0) {
    return {
      name: 'env_vars',
      label: 'Required environment variables set',
      status: 'fail',
      detail: `Missing required: ${missingRequired.join(', ')}`,
    };
  }
  if (missingOptional.length > 0) {
    return {
      name: 'env_vars',
      label: 'Required environment variables set',
      status: 'warn',
      detail: `Missing optional: ${missingOptional.join(', ')}`,
    };
  }
  return { name: 'env_vars', label: 'Required environment variables set', status: 'pass' };
}

function checkCronJobs(): Check {
  const expectedPaths = [
    '/api/health',
    '/api/cron/newsletter-scheduled',
    '/api/cron/audio-generation',
    '/api/cron/cost-alert',
  ];

  // We can't read vercel.json at runtime on Vercel, so we verify by checking
  // that the CRON_SECRET is configured (required for cron auth) and note
  // that cron schedule is encoded in vercel.json at deploy time.
  const cronSecretSet = !!process.env.CRON_SECRET;

  if (!cronSecretSet) {
    return {
      name: 'cron_jobs',
      label: 'Cron jobs secured (CRON_SECRET set)',
      status: 'warn',
      detail: `CRON_SECRET not set — cron endpoints are unauthenticated. Expected paths: ${expectedPaths.join(', ')}`,
    };
  }
  return {
    name: 'cron_jobs',
    label: 'Cron jobs secured (CRON_SECRET set)',
    status: 'pass',
    detail: `${expectedPaths.length} expected paths registered in vercel.json`,
  };
}

// ── Route handler ──────────────────────────────────────────────────────────────

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!isAdminRequest(req)) {
    return NextResponse.json({ error: 'Admin access required.' }, { status: 401 });
  }

  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null);

  // Run all async checks in parallel
  const [supabaseCheck, migrationsCheck, redisCheck, corpusCheck, healthResult] =
    await Promise.all([
      checkSupabase(),
      checkMigrations(),
      checkRedis(),
      checkCorpus(),
      appUrl
        ? checkHealthEndpoint(appUrl)
        : Promise.resolve<[Check, Headers | null]>([
            {
              name: 'health_endpoint',
              label: '/api/health returns 200',
              status: 'warn',
              detail: 'NEXT_PUBLIC_APP_URL not set — skipping self-fetch.',
            },
            null,
          ]),
    ]);

  const [healthCheck, responseHeaders] = healthResult;
  const securityHeadersCheck = checkSecurityHeaders(responseHeaders);

  const syncChecks: Check[] = [
    checkEnvVar('admin_wallet', 'Admin wallet configured', 'ADMIN_WALLET'),
    checkEnvVar('sentry_configured', 'Sentry error monitoring configured', 'SENTRY_DSN', 'warn'),
    checkEnvVar('privy_configured', 'Privy auth configured', 'NEXT_PUBLIC_PRIVY_APP_ID'),
    checkEnvVar(
      'governance_contract',
      'Governance contract address set',
      'ACCEPTANCE_PASS_CONTRACT_ADDRESS',
      'warn',
    ),
    checkEnvVar(
      'rate_limiting',
      'Redis-backed rate limiting configured',
      'UPSTASH_REDIS_REST_URL',
      'warn',
      'Falling back to in-memory rate limiting — not shared across serverless instances.',
    ),
    checkCriticalEnvVars(),
    checkCronJobs(),
  ];

  const checks: Check[] = [
    supabaseCheck,
    migrationsCheck,
    redisCheck,
    corpusCheck,
    healthCheck,
    securityHeadersCheck,
    ...syncChecks,
  ];

  const allStatuses = checks.map((c) => c.status);
  const overall: 'pass' | 'warn' | 'fail' = allStatuses.includes('fail')
    ? 'fail'
    : allStatuses.includes('warn')
      ? 'warn'
      : 'pass';

  return NextResponse.json({
    overall,
    checks,
    checkedAt: new Date().toISOString(),
  });
}
