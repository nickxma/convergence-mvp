/**
 * Slow query monitor — wraps Supabase calls and logs any that exceed the
 * 100ms threshold to Sentry as breadcrumbs (or as a dedicated Sentry issue
 * when the query takes over 500ms).
 *
 * Usage:
 *   const { data, error } = await monitoredQuery("community_posts.feed", () =>
 *     supabase.from("posts").select("*").limit(20)
 *   );
 */
import * as Sentry from '@sentry/nextjs';

export const SLOW_THRESHOLD_MS = 100;
export const CRITICAL_THRESHOLD_MS = 500;

export async function monitoredQuery<T>(
  label: string,
  fn: () => Promise<T>,
): Promise<T> {
  const start = Date.now();
  try {
    const result = await fn();
    const duration = Date.now() - start;
    if (duration > SLOW_THRESHOLD_MS) {
      Sentry.addBreadcrumb({
        category: 'db.slow',
        message: `Slow query: ${label} took ${duration}ms`,
        level: duration > CRITICAL_THRESHOLD_MS ? 'error' : 'warning',
        data: { label, duration },
      });
      if (duration > CRITICAL_THRESHOLD_MS) {
        Sentry.captureMessage(`Slow DB query: ${label} (${duration}ms)`, 'warning');
      }
    }
    return result;
  } catch (err) {
    Sentry.captureException(err, { tags: { db_query: label } });
    throw err;
  }
}
