/**
 * Tests for lib/concept-graph.ts
 *
 * All functions accept a SupabaseClient — we mock the minimal interface
 * (rpc, from/select/in/not/order chains) to test transformation logic
 * and graceful degradation without a live database.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  findRelatedConcepts,
  loadTeacherPerspectives,
  buildConceptPreamble,
  getConceptContext,
} from '../lib/concept-graph';
import type { SupabaseClient } from '@supabase/supabase-js';

// ── Supabase mock helpers ──────────────────────────────────────────────────────

function rpcMock(data: unknown, error: unknown = null) {
  return {
    rpc: vi.fn().mockResolvedValue({ data, error }),
  } as unknown as SupabaseClient;
}

function fromMock(data: unknown, error: unknown = null) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    not: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue({ data, error }),
  };
  return { from: vi.fn().mockReturnValue(chain) } as unknown as SupabaseClient;
}

function fullMock(rpcData: unknown, fromData: unknown, rpcError: unknown = null, fromError: unknown = null) {
  const fromChain = {
    select: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    not: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue({ data: fromData, error: fromError }),
  };
  return {
    rpc: vi.fn().mockResolvedValue({ data: rpcData, error: rpcError }),
    from: vi.fn().mockReturnValue(fromChain),
  } as unknown as SupabaseClient;
}

// ── findRelatedConcepts ───────────────────────────────────────────────────────

describe('findRelatedConcepts', () => {
  const queryEmbedding = Array(1536).fill(0.1);

  it('returns matched concepts above threshold', async () => {
    const db = rpcMock([
      { id: 'a', name: 'Non-Self', normalized_name: 'non-self', description: 'Absence of persistent self', similarity: 0.85 },
      { id: 'b', name: 'Awareness', normalized_name: 'awareness', description: 'Open presence', similarity: 0.72 },
    ]);
    const result = await findRelatedConcepts(db, queryEmbedding);
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('Non-Self');
    expect(result[0].similarity).toBe(0.85);
  });

  it('returns empty array when RPC returns null', async () => {
    const db = rpcMock(null);
    const result = await findRelatedConcepts(db, queryEmbedding);
    expect(result).toEqual([]);
  });

  it('returns empty array on RPC error', async () => {
    const db = rpcMock(null, { message: 'connection refused' });
    const result = await findRelatedConcepts(db, queryEmbedding);
    expect(result).toEqual([]);
  });

  it('returns empty array when RPC throws', async () => {
    const db = {
      rpc: vi.fn().mockRejectedValue(new Error('network error')),
    } as unknown as SupabaseClient;
    const result = await findRelatedConcepts(db, queryEmbedding);
    expect(result).toEqual([]);
  });

  it('filters out concepts below similarity threshold', async () => {
    const db = rpcMock([
      { id: 'a', name: 'Non-Self', normalized_name: 'non-self', description: null, similarity: 0.45 },
    ]);
    // similarity 0.45 < threshold 0.5 → filtered out
    const result = await findRelatedConcepts(db, queryEmbedding);
    expect(result).toEqual([]);
  });

  it('passes correct args to rpc', async () => {
    const db = rpcMock([]);
    await findRelatedConcepts(db, queryEmbedding);
    expect((db as { rpc: ReturnType<typeof vi.fn> }).rpc).toHaveBeenCalledWith('match_concepts', {
      query_embedding: queryEmbedding,
      match_threshold: 0.5,
      match_count: 3,
    });
  });
});

// ── loadTeacherPerspectives ───────────────────────────────────────────────────

describe('loadTeacherPerspectives', () => {
  it('returns empty map for empty concept id list', async () => {
    const db = fromMock([]);
    const result = await loadTeacherPerspectives(db, []);
    expect(result.size).toBe(0);
  });

  it('groups perspectives by concept_id', async () => {
    const rows = [
      { concept_id: 'c1', teacher_name: 'Sam Harris', perspective_summary: 'Views non-self as...', chunk_count: 12 },
      { concept_id: 'c1', teacher_name: 'Tara Brach', perspective_summary: 'Emphasizes radical acceptance', chunk_count: 8 },
      { concept_id: 'c2', teacher_name: 'Adyashanti', perspective_summary: 'Uses direct inquiry', chunk_count: 5 },
    ];
    const db = fromMock(rows);
    const result = await loadTeacherPerspectives(db, ['c1', 'c2']);
    expect(result.get('c1')).toHaveLength(2);
    expect(result.get('c2')).toHaveLength(1);
    expect(result.get('c1')![0].teacher).toBe('Sam Harris');
  });

  it('caps perspectives at MAX_TEACHERS_PER_CONCEPT (4)', async () => {
    const rows = Array.from({ length: 6 }, (_, i) => ({
      concept_id: 'c1',
      teacher_name: `Teacher ${i}`,
      perspective_summary: `Summary ${i}`,
      chunk_count: 10 - i,
    }));
    const db = fromMock(rows);
    const result = await loadTeacherPerspectives(db, ['c1']);
    expect(result.get('c1')).toHaveLength(4);
  });

  it('excludes rows with null perspective_summary (via DB filter)', async () => {
    // The query filters nulls at DB level; this tests that the returned rows are used as-is
    const rows = [
      { concept_id: 'c1', teacher_name: 'Sam Harris', perspective_summary: 'Present-moment awareness', chunk_count: 5 },
    ];
    const db = fromMock(rows);
    const result = await loadTeacherPerspectives(db, ['c1']);
    expect(result.get('c1')).toHaveLength(1);
    expect(result.get('c1')![0].summary).toBe('Present-moment awareness');
  });

  it('returns empty map on query error', async () => {
    const db = fromMock(null, { message: 'permission denied' });
    const result = await loadTeacherPerspectives(db, ['c1']);
    expect(result.size).toBe(0);
  });

  it('returns empty map when from throws', async () => {
    const db = {
      from: vi.fn().mockImplementation(() => { throw new Error('unexpected'); }),
    } as unknown as SupabaseClient;
    const result = await loadTeacherPerspectives(db, ['c1']);
    expect(result.size).toBe(0);
  });
});

// ── buildConceptPreamble ──────────────────────────────────────────────────────

describe('buildConceptPreamble', () => {
  const queryEmbedding = Array(1536).fill(0.1);

  it('returns null when no concepts found', async () => {
    const db = fullMock([], []);
    const result = await buildConceptPreamble(db, queryEmbedding);
    expect(result).toBeNull();
  });

  it('returns null when concepts found but no teacher perspectives', async () => {
    const concepts = [{ id: 'c1', name: 'Non-Self', normalized_name: 'non-self', description: null, similarity: 0.8 }];
    const db = fullMock(concepts, []); // no perspectives
    const result = await buildConceptPreamble(db, queryEmbedding);
    expect(result).toBeNull();
  });

  it('formats preamble correctly with concept and teacher data', async () => {
    const concepts = [
      { id: 'c1', name: 'Non-Self', normalized_name: 'non-self', description: 'Absence of persistent self', similarity: 0.85 },
    ];
    const perspectives = [
      { concept_id: 'c1', teacher_name: 'Sam Harris', perspective_summary: 'Harris argues that the sense of self is an illusion.', chunk_count: 10 },
      { concept_id: 'c1', teacher_name: 'Tara Brach', perspective_summary: 'Brach connects non-self to radical acceptance.', chunk_count: 7 },
    ];
    const db = fullMock(concepts, perspectives);
    const result = await buildConceptPreamble(db, queryEmbedding);
    expect(result).not.toBeNull();
    expect(result).toContain('[Cross-teacher context]');
    expect(result).toContain('"Non-Self"');
    expect(result).toContain('Sam Harris');
    expect(result).toContain('Tara Brach');
    expect(result).toContain('Harris argues that');
  });

  it('handles multiple concepts in preamble', async () => {
    const concepts = [
      { id: 'c1', name: 'Non-Self', normalized_name: 'non-self', description: null, similarity: 0.85 },
      { id: 'c2', name: 'Awareness', normalized_name: 'awareness', description: null, similarity: 0.75 },
    ];
    const perspectives = [
      { concept_id: 'c1', teacher_name: 'Teacher A', perspective_summary: 'Summary A for non-self.', chunk_count: 5 },
      { concept_id: 'c2', teacher_name: 'Teacher B', perspective_summary: 'Summary B for awareness.', chunk_count: 3 },
    ];
    const db = fullMock(concepts, perspectives);
    const result = await buildConceptPreamble(db, queryEmbedding);
    expect(result).toContain('"Non-Self"');
    expect(result).toContain('"Awareness"');
    expect(result).toContain('Teacher A');
    expect(result).toContain('Teacher B');
  });

  it('returns null when rpc throws (graceful degradation)', async () => {
    const db = {
      rpc: vi.fn().mockRejectedValue(new Error('network error')),
      from: vi.fn(),
    } as unknown as SupabaseClient;
    const result = await buildConceptPreamble(db, queryEmbedding);
    expect(result).toBeNull();
  });
});

// ── getConceptContext ─────────────────────────────────────────────────────────

describe('getConceptContext', () => {
  const queryEmbedding = Array(1536).fill(0.1);

  it('returns empty array when no concepts match', async () => {
    const db = fullMock([], []);
    const result = await getConceptContext(db, queryEmbedding);
    expect(result).toEqual([]);
  });

  it('returns structured context with concept and teachers', async () => {
    const concepts = [
      { id: 'c1', name: 'Equanimity', normalized_name: 'equanimity', description: 'Balanced mind', similarity: 0.9 },
    ];
    const perspectives = [
      { concept_id: 'c1', teacher_name: 'Shinzen Young', perspective_summary: 'Equanimity as non-interference.', chunk_count: 15 },
    ];
    const db = fullMock(concepts, perspectives);
    const result = await getConceptContext(db, queryEmbedding);
    expect(result).toHaveLength(1);
    expect(result[0].concept.name).toBe('Equanimity');
    expect(result[0].teachers).toHaveLength(1);
    expect(result[0].teachers[0].teacher).toBe('Shinzen Young');
    expect(result[0].teachers[0].chunkCount).toBe(15);
  });

  it('returns empty teachers array when no perspectives exist for matched concept', async () => {
    const concepts = [
      { id: 'c1', name: 'Impermanence', normalized_name: 'impermanence', description: null, similarity: 0.7 },
    ];
    const db = fullMock(concepts, []);
    const result = await getConceptContext(db, queryEmbedding);
    expect(result).toHaveLength(1);
    expect(result[0].concept.name).toBe('Impermanence');
    expect(result[0].teachers).toEqual([]);
  });
});
