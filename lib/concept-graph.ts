/**
 * lib/concept-graph.ts
 *
 * Runtime utilities for the concept knowledge graph (OLU-443).
 *
 * Used by /api/ask to augment retrieval with concept-level context:
 *   1. Find concepts semantically related to the user's query
 *   2. Load teacher perspectives on those concepts
 *   3. Return a structured preamble for the LLM prompt
 *
 * All functions fail gracefully — a Supabase error here never breaks the Q&A
 * pipeline. The augmentation is purely additive.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export interface ConceptMatch {
  id: string;
  name: string;
  description: string | null;
  similarity: number;
}

export interface TeacherPerspective {
  teacher: string;
  summary: string;
  chunkCount: number;
}

export interface ConceptContext {
  concept: ConceptMatch;
  teachers: TeacherPerspective[];
}

/** Max concepts to surface per query — keep small to avoid prompt bloat. */
const MAX_CONCEPTS = 3;
/** Minimum similarity to include a concept. */
const CONCEPT_THRESHOLD = 0.5;
/** Max teacher perspectives per concept. */
const MAX_TEACHERS_PER_CONCEPT = 4;

/**
 * Find the top concepts most similar to a query embedding.
 * Calls the `match_concepts` RPC defined in migration 037_concept_graph.sql.
 */
export async function findRelatedConcepts(
  db: SupabaseClient,
  queryEmbedding: number[],
): Promise<ConceptMatch[]> {
  try {
    const { data, error } = await db.rpc('match_concepts', {
      query_embedding: queryEmbedding,
      match_threshold: CONCEPT_THRESHOLD,
      match_count: MAX_CONCEPTS,
    });
    if (error || !data) return [];
    return (data as ConceptMatch[]).filter((c) => c.similarity >= CONCEPT_THRESHOLD);
  } catch {
    return [];
  }
}

/**
 * Load teacher perspectives for a set of concept IDs.
 * Returns concept_teachers rows ordered by chunk_count descending.
 */
export async function loadTeacherPerspectives(
  db: SupabaseClient,
  conceptIds: string[],
): Promise<Map<string, TeacherPerspective[]>> {
  if (conceptIds.length === 0) return new Map();

  try {
    const { data, error } = await db
      .from('concept_teachers')
      .select('concept_id, teacher_name, perspective_summary, chunk_count')
      .in('concept_id', conceptIds)
      .not('perspective_summary', 'is', null)
      .order('chunk_count', { ascending: false });

    if (error || !data) return new Map();

    const result = new Map<string, TeacherPerspective[]>();
    for (const row of data as Array<{
      concept_id: string;
      teacher_name: string;
      perspective_summary: string;
      chunk_count: number;
    }>) {
      if (!result.has(row.concept_id)) result.set(row.concept_id, []);
      const perspectives = result.get(row.concept_id)!;
      if (perspectives.length < MAX_TEACHERS_PER_CONCEPT) {
        perspectives.push({
          teacher: row.teacher_name,
          summary: row.perspective_summary,
          chunkCount: row.chunk_count,
        });
      }
    }
    return result;
  } catch {
    return new Map();
  }
}

/**
 * Build a concept context preamble for the LLM prompt.
 *
 * Returns a formatted string like:
 *   Relevant concept: "Non-Self"
 *   - Teacher A: "..."
 *   - Teacher B: "..."
 *
 * Returns null if no concepts found (caller should skip augmentation).
 */
export async function buildConceptPreamble(
  db: SupabaseClient,
  queryEmbedding: number[],
): Promise<string | null> {
  const concepts = await findRelatedConcepts(db, queryEmbedding);
  if (concepts.length === 0) return null;

  const conceptIds = concepts.map((c) => c.id);
  const perspectiveMap = await loadTeacherPerspectives(db, conceptIds);

  const sections: string[] = [];

  for (const concept of concepts) {
    const teachers = perspectiveMap.get(concept.id) ?? [];
    if (teachers.length === 0) continue;

    const teacherLines = teachers
      .map((t) => `  - ${t.teacher}: "${t.summary}"`)
      .join('\n');

    sections.push(`Concept: "${concept.name}"\n${teacherLines}`);
  }

  if (sections.length === 0) return null;

  return `[Cross-teacher context]\n${sections.join('\n\n')}`;
}

/**
 * getConceptContext returns the full structured context for observability/debugging.
 * Use buildConceptPreamble for the LLM-ready string.
 */
export async function getConceptContext(
  db: SupabaseClient,
  queryEmbedding: number[],
): Promise<ConceptContext[]> {
  const concepts = await findRelatedConcepts(db, queryEmbedding);
  if (concepts.length === 0) return [];

  const conceptIds = concepts.map((c) => c.id);
  const perspectiveMap = await loadTeacherPerspectives(db, conceptIds);

  return concepts.map((concept) => ({
    concept,
    teachers: perspectiveMap.get(concept.id) ?? [],
  }));
}
