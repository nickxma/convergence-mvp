import { NextResponse } from 'next/server';
import { Pinecone } from '@pinecone-database/pinecone';
import { supabase } from '@/lib/supabase';

type CheckStatus = 'ok' | 'degraded' | 'down';

interface BaseCheck {
  status: CheckStatus;
  latencyMs?: number;
}

interface CacheCheck extends BaseCheck {
  hitRate: number;
}

/** Race a promise against a timeout; rejects with Error('timeout') if exceeded. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), ms),
    ),
  ]);
}

/** SELECT 1 equivalent — validates Supabase connectivity. 2s timeout. */
async function checkSupabase(): Promise<BaseCheck> {
  const start = Date.now();
  try {
    const { error } = await withTimeout(
      // Wrap in Promise.resolve so TypeScript sees a full Promise (not just thenable).
      Promise.resolve(supabase.from('qa_analytics').select('id').limit(1)),
      2000,
    );
    if (error) throw error;
    const latencyMs = Date.now() - start;
    return { status: latencyMs > 1000 ? 'degraded' : 'ok', latencyMs };
  } catch {
    return { status: 'down', latencyMs: Date.now() - start };
  }
}

/** describeIndexStats() — validates Pinecone connectivity. 3s timeout. */
async function checkPinecone(): Promise<BaseCheck> {
  const pineconeKey = process.env.PINECONE_API_KEY;
  if (!pineconeKey) return { status: 'down' };

  const start = Date.now();
  try {
    const pc = new Pinecone({ apiKey: pineconeKey });
    const index = pc.Index(process.env.PINECONE_INDEX ?? 'convergence-mvp');
    await withTimeout(index.describeIndexStats(), 3000);
    const latencyMs = Date.now() - start;
    return { status: latencyMs > 1000 ? 'degraded' : 'ok', latencyMs };
  } catch {
    return { status: 'down', latencyMs: Date.now() - start };
  }
}

/** Env-var presence only — no token cost. */
function checkOpenAI(): BaseCheck {
  return { status: process.env.OPENAI_API_KEY ? 'ok' : 'down' };
}

/** Cache hit rate over the last 1 hour from qa_analytics. */
async function checkCache(): Promise<CacheCheck> {
  try {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from('qa_analytics')
      .select('cache_hit')
      .gte('created_at', oneHourAgo);

    if (error || !data || data.length === 0) {
      return { status: 'ok', hitRate: 0 };
    }

    const hits = data.filter((r) => r.cache_hit).length;
    const hitRate = Math.round((hits / data.length) * 100) / 100;
    return { status: 'ok', hitRate };
  } catch {
    return { status: 'ok', hitRate: 0 };
  }
}

export async function GET() {
  const checkedAt = new Date().toISOString();

  // Git SHA injected by Vercel at build time; fall back to 'dev'.
  const version =
    (process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ?? 'dev').slice(0, 7);

  const [supabaseCheck, pineconeCheck, cacheCheck] = await Promise.all([
    checkSupabase(),
    checkPinecone(),
    checkCache(),
  ]);

  const openaiCheck = checkOpenAI();

  const checks = {
    supabase: supabaseCheck,
    pinecone: pineconeCheck,
    openai: openaiCheck,
    cache: { status: cacheCheck.status, hitRate: cacheCheck.hitRate },
  };

  const allStatuses = Object.values(checks).map((c) => c.status);
  const status: 'ok' | 'degraded' | 'down' = allStatuses.includes('down')
    ? 'down'
    : allStatuses.includes('degraded')
      ? 'degraded'
      : 'ok';

  return NextResponse.json(
    { status, version, checks, checkedAt },
    { status: status === 'down' ? 503 : 200 },
  );
}
