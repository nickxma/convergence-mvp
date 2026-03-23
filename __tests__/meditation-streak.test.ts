/**
 * Unit tests for meditation habit tracking logic.
 * Tests calcCurrentStreak and BADGE_THRESHOLDS from the complete route.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock heavy dependencies so pure logic can be imported without env vars
vi.mock('@/lib/supabase', () => ({ supabase: {} }));
vi.mock('@/lib/privy-auth', () => ({ verifyRequest: vi.fn() }));
vi.mock('@/lib/embeddings', () => ({ embedOne: vi.fn() }));
vi.mock('@pinecone-database/pinecone', () => ({ Pinecone: vi.fn() }));

// We import the pure helpers directly — no DB or Pinecone involved.
import { calcCurrentStreak, BADGE_THRESHOLDS } from '../app/api/meditations/[id]/complete/route';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Produce a YYYY-MM-DD string offset by `delta` days from a reference date. */
function dateOffset(base: Date, delta: number): string {
  return new Date(base.getTime() + delta * 86_400_000).toISOString().slice(0, 10);
}

/** Build a continuous run of daily dates ending on `anchor`. */
function streak(anchor: Date, length: number): string[] {
  return Array.from({ length }, (_, i) => dateOffset(anchor, -(length - 1 - i)));
}

// ── calcCurrentStreak ─────────────────────────────────────────────────────────

describe('calcCurrentStreak', () => {
  let now: Date;

  beforeEach(() => {
    // Pin "today" to a known date so tests are deterministic
    now = new Date('2025-06-15T12:00:00Z');
    vi.useFakeTimers();
    vi.setSystemTime(now);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns 0 for an empty array', () => {
    expect(calcCurrentStreak([])).toBe(0);
  });

  it('returns 1 for only today', () => {
    expect(calcCurrentStreak(['2025-06-15'])).toBe(1);
  });

  it('returns 1 for only yesterday', () => {
    expect(calcCurrentStreak(['2025-06-14'])).toBe(1);
  });

  it('returns 0 when last practice was 2 days ago', () => {
    expect(calcCurrentStreak(['2025-06-13'])).toBe(0);
  });

  it('counts a continuous streak ending today', () => {
    // 7 consecutive days ending today
    const dates = streak(now, 7);
    expect(calcCurrentStreak(dates)).toBe(7);
  });

  it('counts a continuous streak ending yesterday', () => {
    const yesterday = new Date(now.getTime() - 86_400_000);
    const dates = streak(yesterday, 5);
    expect(calcCurrentStreak(dates)).toBe(5);
  });

  it('breaks streak on a gap', () => {
    // 3 days ending today, then a gap of 2 days, then 5 more days
    const recent = streak(now, 3); // 2025-06-13, 14, 15
    const old    = streak(new Date('2025-06-10'), 5); // 2025-06-06..10
    expect(calcCurrentStreak([...old, ...recent])).toBe(3);
  });

  it('deduplicates multiple completions on the same day', () => {
    // Three completions today + six more on previous days = 7-day streak
    const dates = [
      ...streak(now, 6).slice(0, 6), // 2025-06-10..15 minus today
      '2025-06-15',
      '2025-06-15',
      '2025-06-15',
    ];
    expect(calcCurrentStreak(dates)).toBe(6);
  });

  it('handles a single-element array with yesterday', () => {
    expect(calcCurrentStreak(['2025-06-14'])).toBe(1);
  });

  it('handles unsorted input', () => {
    const dates = ['2025-06-13', '2025-06-15', '2025-06-14'];
    expect(calcCurrentStreak(dates)).toBe(3);
  });

  it('returns 0 when all dates are old', () => {
    const dates = ['2025-01-01', '2025-01-02', '2025-01-03'];
    expect(calcCurrentStreak(dates)).toBe(0);
  });

  it('handles a 100-day streak', () => {
    const dates = streak(now, 100);
    expect(calcCurrentStreak(dates)).toBe(100);
  });
});

// ── BADGE_THRESHOLDS ──────────────────────────────────────────────────────────

describe('BADGE_THRESHOLDS', () => {
  it('defines the three required badges in ascending order', () => {
    const slugs = BADGE_THRESHOLDS.map((t) => t.slug);
    expect(slugs).toContain('consistent');
    expect(slugs).toContain('devoted');
    expect(slugs).toContain('enlightened');
  });

  it('consistent threshold is 7 days', () => {
    const t = BADGE_THRESHOLDS.find((b) => b.slug === 'consistent');
    expect(t?.days).toBe(7);
  });

  it('devoted threshold is 30 days', () => {
    const t = BADGE_THRESHOLDS.find((b) => b.slug === 'devoted');
    expect(t?.days).toBe(30);
  });

  it('enlightened threshold is 100 days', () => {
    const t = BADGE_THRESHOLDS.find((b) => b.slug === 'enlightened');
    expect(t?.days).toBe(100);
  });

  it('thresholds are ordered ascending', () => {
    for (let i = 1; i < BADGE_THRESHOLDS.length; i++) {
      expect(BADGE_THRESHOLDS[i].days).toBeGreaterThan(BADGE_THRESHOLDS[i - 1].days);
    }
  });
});
