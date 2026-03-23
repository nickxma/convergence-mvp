/**
 * GET /api/debug/sentry-test
 *
 * Development-only route that fires a test exception into Sentry so you can
 * verify the integration end-to-end without deploying a broken feature.
 *
 * Returns 404 in any non-development environment.
 */
import * as Sentry from '@sentry/nextjs';
import { NextResponse } from 'next/server';

export async function GET() {
  if (process.env.NODE_ENV !== 'development') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const testError = new Error('Sentry integration test — intentional error');
  Sentry.withScope((scope) => {
    scope.setTag('debug.test', 'sentry-test-route');
    Sentry.captureException(testError);
  });

  return NextResponse.json({
    ok: true,
    message: 'Test exception sent to Sentry. Check your Sentry project for the event.',
  });
}
