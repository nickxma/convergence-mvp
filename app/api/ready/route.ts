import { NextResponse } from 'next/server';

/**
 * GET /api/ready — container readiness probe.
 *
 * Lightweight check: verifies that the process has started and the required
 * environment variables are present. No external I/O — returns in < 1ms.
 *
 * Use this for Kubernetes/Docker readinessProbe (determines if the container
 * should receive traffic). For liveness checks (dependency health), use
 * /api/health which performs deep dependency checks against Supabase, Pinecone,
 * and OpenAI.
 *
 * Returns:
 *   200 { status: "ready" }                — ready to serve traffic
 *   503 { status: "not_ready", missing: [] } — required config absent
 */

const REQUIRED_VARS = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'OPENAI_API_KEY',
];

export async function GET() {
  const missing = REQUIRED_VARS.filter((v) => !process.env[v]);

  if (missing.length > 0) {
    return NextResponse.json(
      { status: 'not_ready', missing },
      { status: 503 },
    );
  }

  return NextResponse.json({ status: 'ready' });
}
