/**
 * Unit tests for concept graph admin API data transformation logic.
 *
 * Tests the shared-teacher annotation used by the export endpoint and
 * the pagination boundary calculations used by the nodes list endpoint.
 *
 * Route-level DB calls are not tested here (they require a live Supabase).
 * See lib/concept-graph.ts and __tests__/concept-graph.test.ts for
 * runtime utility tests.
 */
import { describe, it, expect } from 'vitest';

// ── Shared-teacher annotation ─────────────────────────────────────────────────
// Extracted from GET /api/admin/concept-graph/export

function buildConceptTeachersMap(
  rows: Array<{ concept_id: string; teacher_name: string }>,
): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const row of rows) {
    const list = map.get(row.concept_id) ?? [];
    if (!list.includes(row.teacher_name)) list.push(row.teacher_name);
    map.set(row.concept_id, list);
  }
  return map;
}

function sharedTeachers(
  map: Map<string, string[]>,
  fromId: string,
  toId: string,
): string[] {
  const fromTeachers = map.get(fromId) ?? [];
  const toTeachers = map.get(toId) ?? [];
  return fromTeachers.filter((t) => toTeachers.includes(t));
}

describe('buildConceptTeachersMap', () => {
  it('groups teachers by concept_id', () => {
    const rows = [
      { concept_id: 'c1', teacher_name: 'Sam Harris' },
      { concept_id: 'c1', teacher_name: 'Tara Brach' },
      { concept_id: 'c2', teacher_name: 'Sam Harris' },
    ];
    const map = buildConceptTeachersMap(rows);
    expect(map.get('c1')).toEqual(['Sam Harris', 'Tara Brach']);
    expect(map.get('c2')).toEqual(['Sam Harris']);
  });

  it('deduplicates teachers within a concept', () => {
    const rows = [
      { concept_id: 'c1', teacher_name: 'Sam Harris' },
      { concept_id: 'c1', teacher_name: 'Sam Harris' },
    ];
    const map = buildConceptTeachersMap(rows);
    expect(map.get('c1')).toHaveLength(1);
  });

  it('returns empty map for empty input', () => {
    const map = buildConceptTeachersMap([]);
    expect(map.size).toBe(0);
  });
});

describe('sharedTeachers', () => {
  const rows = [
    { concept_id: 'c1', teacher_name: 'Sam Harris' },
    { concept_id: 'c1', teacher_name: 'Tara Brach' },
    { concept_id: 'c2', teacher_name: 'Sam Harris' },
    { concept_id: 'c2', teacher_name: 'Adyashanti' },
    { concept_id: 'c3', teacher_name: 'Adyashanti' },
  ];
  const map = buildConceptTeachersMap(rows);

  it('returns teachers present in both concepts', () => {
    // c1 and c2 both have Sam Harris
    expect(sharedTeachers(map, 'c1', 'c2')).toEqual(['Sam Harris']);
  });

  it('returns empty array when no shared teachers', () => {
    // c1 has [Sam Harris, Tara Brach], c3 has [Adyashanti]
    expect(sharedTeachers(map, 'c1', 'c3')).toEqual([]);
  });

  it('returns empty array when concept not in map', () => {
    expect(sharedTeachers(map, 'c1', 'unknown')).toEqual([]);
  });

  it('handles both concepts missing from map', () => {
    expect(sharedTeachers(map, 'x', 'y')).toEqual([]);
  });
});

// ── Pagination math ───────────────────────────────────────────────────────────
// Mirrors the logic in GET /api/admin/concept-graph/nodes

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function parsePaginationParams(
  pageStr: string | null,
  limitStr: string | null,
): { page: number; limit: number; from: number; to: number } {
  const page = Math.max(1, parseInt(pageStr ?? '1', 10) || 1);
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(limitStr ?? String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT));
  const from = (page - 1) * limit;
  const to = from + limit - 1;
  return { page, limit, from, to };
}

describe('parsePaginationParams', () => {
  it('defaults to page 1, limit 50', () => {
    const { page, limit, from, to } = parsePaginationParams(null, null);
    expect(page).toBe(1);
    expect(limit).toBe(50);
    expect(from).toBe(0);
    expect(to).toBe(49);
  });

  it('computes correct range for page 2', () => {
    const { from, to } = parsePaginationParams('2', '50');
    expect(from).toBe(50);
    expect(to).toBe(99);
  });

  it('clamps limit to MAX_LIMIT (200)', () => {
    const { limit } = parsePaginationParams('1', '999');
    expect(limit).toBe(200);
  });

  it('treats limit=0 as invalid, falls back to default', () => {
    // parseInt('0') = 0, which is falsy, so || DEFAULT_LIMIT kicks in
    const { limit } = parsePaginationParams('1', '0');
    expect(limit).toBe(DEFAULT_LIMIT);
  });

  it('clamps page minimum to 1 for zero/negative values', () => {
    expect(parsePaginationParams('0', null).page).toBe(1);
    expect(parsePaginationParams('-5', null).page).toBe(1);
  });

  it('treats non-numeric page as page 1', () => {
    expect(parsePaginationParams('abc', null).page).toBe(1);
  });

  it('treats non-numeric limit as default', () => {
    expect(parsePaginationParams(null, 'abc').limit).toBe(DEFAULT_LIMIT);
  });
});

describe('pages calculation', () => {
  it('computes correct page count', () => {
    expect(Math.ceil(100 / 50)).toBe(2);
    expect(Math.ceil(101 / 50)).toBe(3);
    expect(Math.ceil(0 / 50)).toBe(0);
    expect(Math.ceil(1 / 50)).toBe(1);
  });
});
