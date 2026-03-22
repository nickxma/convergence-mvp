/**
 * Unit tests for lib/db-monitor.ts
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

// Mock @sentry/nextjs before importing the module under test
const addBreadcrumb = vi.fn();
const captureMessage = vi.fn();
const captureException = vi.fn();

vi.mock('@sentry/nextjs', () => ({
  addBreadcrumb,
  captureMessage,
  captureException,
}));

const { monitoredQuery, SLOW_THRESHOLD_MS, CRITICAL_THRESHOLD_MS } = await import('../lib/db-monitor');

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

// ── Fast queries ──────────────────────────────────────────────────────────────

describe('fast queries (under threshold)', () => {
  it('returns the result unchanged', async () => {
    const result = await monitoredQuery('test.fast', () => Promise.resolve({ data: [1, 2, 3], error: null }));
    expect(result).toEqual({ data: [1, 2, 3], error: null });
  });

  it('does not call addBreadcrumb or captureMessage', async () => {
    await monitoredQuery('test.fast', () => Promise.resolve('ok'));
    expect(addBreadcrumb).not.toHaveBeenCalled();
    expect(captureMessage).not.toHaveBeenCalled();
  });
});

// ── Slow queries (100–500ms) ──────────────────────────────────────────────────

describe('slow queries (over SLOW_THRESHOLD_MS, under CRITICAL_THRESHOLD_MS)', () => {
  it('adds a breadcrumb at warning level', async () => {
    vi.useFakeTimers();
    const promise = monitoredQuery('test.slow', () => {
      return new Promise<string>((resolve) => {
        setTimeout(() => resolve('done'), SLOW_THRESHOLD_MS + 50);
      });
    });
    vi.advanceTimersByTime(SLOW_THRESHOLD_MS + 50);
    await promise;

    expect(addBreadcrumb).toHaveBeenCalledOnce();
    const call = addBreadcrumb.mock.calls[0][0];
    expect(call.category).toBe('db.slow');
    expect(call.level).toBe('warning');
    expect(call.data.label).toBe('test.slow');
    expect(call.data.duration).toBeGreaterThan(SLOW_THRESHOLD_MS);
  });

  it('does NOT call captureMessage for sub-critical queries', async () => {
    vi.useFakeTimers();
    const promise = monitoredQuery('test.slow', () => {
      return new Promise<string>((resolve) => {
        setTimeout(() => resolve('done'), SLOW_THRESHOLD_MS + 50);
      });
    });
    vi.advanceTimersByTime(SLOW_THRESHOLD_MS + 50);
    await promise;

    expect(captureMessage).not.toHaveBeenCalled();
  });
});

// ── Critical queries (>500ms) ─────────────────────────────────────────────────

describe('critical queries (over CRITICAL_THRESHOLD_MS)', () => {
  it('adds a breadcrumb at error level', async () => {
    vi.useFakeTimers();
    const promise = monitoredQuery('test.critical', () => {
      return new Promise<string>((resolve) => {
        setTimeout(() => resolve('done'), CRITICAL_THRESHOLD_MS + 50);
      });
    });
    vi.advanceTimersByTime(CRITICAL_THRESHOLD_MS + 50);
    await promise;

    expect(addBreadcrumb).toHaveBeenCalledOnce();
    expect(addBreadcrumb.mock.calls[0][0].level).toBe('error');
  });

  it('calls captureMessage with warning severity', async () => {
    vi.useFakeTimers();
    const promise = monitoredQuery('test.critical', () => {
      return new Promise<string>((resolve) => {
        setTimeout(() => resolve('done'), CRITICAL_THRESHOLD_MS + 50);
      });
    });
    vi.advanceTimersByTime(CRITICAL_THRESHOLD_MS + 50);
    await promise;

    expect(captureMessage).toHaveBeenCalledOnce();
    const [msg, level] = captureMessage.mock.calls[0];
    expect(msg).toContain('test.critical');
    expect(level).toBe('warning');
  });
});

// ── Error handling ────────────────────────────────────────────────────────────

describe('query errors', () => {
  it('re-throws errors', async () => {
    const boom = new Error('db connection failed');
    await expect(monitoredQuery('test.err', () => Promise.reject(boom))).rejects.toThrow('db connection failed');
  });

  it('calls captureException with the db_query tag', async () => {
    const boom = new Error('timeout');
    try {
      await monitoredQuery('test.err', () => Promise.reject(boom));
    } catch {
      // expected
    }
    expect(captureException).toHaveBeenCalledOnce();
    const [err, opts] = captureException.mock.calls[0];
    expect(err).toBe(boom);
    expect(opts.tags.db_query).toBe('test.err');
  });

  it('does not call addBreadcrumb or captureMessage on error', async () => {
    try {
      await monitoredQuery('test.err', () => Promise.reject(new Error('x')));
    } catch {
      // expected
    }
    expect(addBreadcrumb).not.toHaveBeenCalled();
    expect(captureMessage).not.toHaveBeenCalled();
  });
});

// ── Wrapper overhead ──────────────────────────────────────────────────────────

describe('wrapper overhead', () => {
  it('adds less than 5ms overhead for an instant query', async () => {
    const start = Date.now();
    await monitoredQuery('test.instant', () => Promise.resolve(null));
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(5);
  });
});
