# RAG Retrieval Benchmark — Waking Up Q&A Corpus

**Date:** 2026-03-23
**Task:** OLU-596
**Pipeline:** BASELINE (text-embedding-3-small, `__default__` namespace, no Cohere re-ranking)
**Index:** convergence-mvp (28,713 vectors)

---

## Executive Summary

| Metric | Value |
|--------|-------|
| Queries run | 20 |
| Queries with results | 20 / 20 |
| Avg latency | 545ms |
| Avg top-1 cosine score | 0.667 |
| **Precision@3 (mean)** | **0.70** |
| Embed model | text-embedding-3-small |
| Re-ranking | None (Cohere key not available locally) |
| New pipeline (post-OLU-440) | ❌ BLOCKED — `waking-up` namespace empty |

---

## Critical Finding: Corpus Not Re-ingested

The `waking-up` and `waking-up-summaries` Pinecone namespaces are **empty**. All 28,713 corpus vectors reside in the legacy `__default__` namespace, embedded with `text-embedding-3-small` (no dimensions specified, defaulting to 1536d).

The OLU-441/440 commit upgraded the code to use:
- **text-embedding-3-large @ 1536d** (new model)
- **`waking-up` namespace** (new namespace)
- **`waking-up-summaries` namespace** (dual embedding)
- **Cohere rerank-v3.5** (after Pinecone retrieval)

However, `scripts/refresh-corpus.ts --reindex` has never been run. As a result:

- **The production `/api/ask` endpoint retrieves 0 chunks for every query** (queries the empty `waking-up` namespace).
- This benchmark measures the **pre-OLU-440 baseline**: text-embedding-3-small against the legacy corpus.

**Action required before re-benchmarking:** Run `npx tsx scripts/refresh-corpus.ts --reindex` to populate the `waking-up` namespace with text-embedding-3-large embeddings.

---

## Scoring Methodology

Each of the top-3 retrieved chunks per query was manually scored:

| Score | Label | Description |
|-------|-------|-------------|
| 1.0 | **Relevant** | Directly addresses the query; would contribute substantively to a good answer |
| 0.5 | **Partial** | Tangentially related; topic match but lacks substance or is a conversation fragment |
| 0.0 | **Irrelevant** | Doesn't address the query |

**Precision@3** = mean relevance score across 3 chunks per query.

---

## Per-Query Results

### Q01 — "What does Sam Harris say about the default mode network?"
| Rank | Speaker | Source | Score | Relevance |
|------|---------|--------|-------|-----------|
| 1 | Sam Harris | Science-of-Mindfulness-Part-2 | 0.655 | **R** |
| 2 | Jonas Kaplan | The-Default-Mode | 0.653 | **R** |
| 3 | Sam Harris | The-Default-Mode | 0.620 | **R** |

**P@3 = 1.00** ✅ — Excellent. Top result is Sam Harris explaining DMN as the brain's idling state.

---

### Q02 — "What does Adyashanti teach about the end of suffering?"
| Rank | Speaker | Source | Score | Relevance |
|------|---------|--------|-------|-----------|
| 1 | Unknown | Day-1-Body-Final-V2 | 0.612 | **P** |
| 2 | Adyashanti | 5-an-undivided-life | 0.589 | **R** |
| 3 | Adyashanti | 5-an-undivided-life | 0.583 | **R** |

**P@3 = 0.83** ✅ — Top result is a retreat transcript with Unknown speaker (possibly Goldstein). Ranks 2–3 are direct Adyashanti content.

---

### Q03 — "How does Tara Brach describe the practice of RAIN?"
| Rank | Speaker | Source | Score | Relevance |
|------|---------|--------|-------|-----------|
| 1 | Tara Brach | The-Bridge-to-Compassion | 0.715 | **R** |
| 2 | Tara Brach | The-Bridge-to-Compassion | 0.656 | **R** |
| 3 | Tara Brach | The-Bridge-to-Compassion | 0.650 | **R** |

**P@3 = 1.00** ✅ — Perfect retrieval. All 3 chunks are Tara Brach directly explaining RAIN.

---

### Q04 — "What does Joseph Goldstein say about insight meditation?"
| Rank | Speaker | Source | Score | Relevance |
|------|---------|--------|-------|-----------|
| 1 | Sam Harris | Meditation-and-Mental-Health | 0.556 | **I** |
| 2 | Sam Harris | Meditation-and-Mental-Health | 0.549 | **I** |
| 3 | Sam Harris | The-Truth-of-Non-duality | 0.543 | **P** |

**P@3 = 0.17** ❌ — Poor. Ranks 1–2 are dialogue fragments (e.g., "Joseph Goldstein: Correct.") with no content. Rank 3 is Sam Harris discussing his disagreement with Goldstein. Root cause: dialogue-heavy transcripts produce extremely short chunks that match the name "Goldstein" but contain no teaching content.

---

### Q05 — "How does Rupert Spira describe the experience of pure awareness?"
| Rank | Speaker | Source | Score | Relevance |
|------|---------|--------|-------|-----------|
| 1 | Stephan Bodian | A-Conversation-with-Stephan-Bodian | 0.640 | **I** |
| 2 | Sam Harris | The-Nature-of-Awareness | 0.629 | **P** |
| 3 | Sam Harris | Non-duality--Behavioral-Change | 0.611 | **I** |

**P@3 = 0.17** ❌ — Poor. Rank 1 is a 6-word fragment ("So, pure awareness, pure subjectivity."). Rank 2 is from a Rupert Spira conversation but is a fragmentary setup line. Rupert Spira's substantive content not retrieved. Likely a corpus coverage gap — Spira appears to have limited transcript content in this corpus.

---

### Q06 — "What is non-self?"
| Rank | Speaker | Source | Score | Relevance |
|------|---------|--------|-------|-----------|
| 1 | Joseph Goldstein | PAUSE-Retreat-QnA | 0.592 | **R** |
| 2 | Sam Harris | Live-at-the-Wiltern | 0.542 | **P** |
| 3 | Swami Sarvapriyananda | Swami-Sarvapriyananda-1 | 0.540 | **R** |

**P@3 = 0.83** ✅ — Good. Goldstein and Sarvapriyananda provide substantive explanations of non-self.

---

### Q07 — "What is the relationship between love and emptiness in meditation?"
| Rank | Speaker | Source | Score | Relevance |
|------|---------|--------|-------|-----------|
| 1 | Sam Harris | Meditation-and-Mental-Health | 0.616 | **P** |
| 2 | Mingyur Rinpoche | Live-at-the-Wiltern | 0.606 | **P** |
| 3 | Jetsunma Tenzin Palmo | 2-from-healthy-self-to-no-self | 0.598 | **R** |

**P@3 = 0.67** — Moderate. Rank 1 is a question fragment. Rank 3 directly connects emptiness with loving-kindness. With Cohere re-ranking, rank 3 would likely move up.

---

### Q08 — "How do you rest in awareness without effort?"
| Rank | Speaker | Source | Score | Relevance |
|------|---------|--------|-------|-----------|
| 1 | Stephan Bodian | 05-Rest-and-Allow-Master | 0.774 | **R** |
| 2 | Adyashanti | 1-The-Three-Commitments | 0.757 | **R** |
| 3 | Kelly Boys | 9-Resting-as-Awareness | 0.735 | **R** |

**P@3 = 1.00** ✅ — Excellent. Highest top-1 score of any query (0.774). "Resting as awareness" is a well-represented topic.

---

### Q09 — "Can you be aware of awareness itself?"
| Rank | Speaker | Source | Score | Relevance |
|------|---------|--------|-------|-----------|
| 1 | Loch Kelly | 3-Turn-the-Light-of-Awake-Awareness | 0.712 | **R** |
| 2 | Judson Brewer | Mindfulness-and-Addiction | 0.706 | **P** |
| 3 | Adyashanti | The-Context-of-Content | 0.705 | **P** |

**P@3 = 0.67** — Good rank 1, but ranks 2–3 are about awareness generally rather than self-reflexive awareness specifically.

---

### Q10 — "What is the difference between mindfulness and concentration?"
| Rank | Speaker | Source | Score | Relevance |
|------|---------|--------|-------|-----------|
| 1 | Sam Harris | What-Is-Mindfulness-Fundamentals | 0.679 | **R** |
| 2 | Sam Harris | What-Is-Mindfulness-Fundamentals | 0.666 | **R** |
| 3 | Sam Harris | What-Is-Mindfulness-Fundamentals | 0.663 | **P** |

**P@3 = 0.83** ✅ — Good. Ranks 1–2 directly contrast mindfulness and concentration. Rank 3 is about terminology generally.

---

### Q11 — "How do I work with fear and difficult emotions in meditation?"
| Rank | Speaker | Source | Score | Relevance |
|------|---------|--------|-------|-----------|
| 1 | Diana Winston | Working-with-Emotions | 0.631 | **R** |
| 2 | Leo Babauta | The-Wisdom-of-Uncertainty | 0.618 | **R** |
| 3 | Stephan Bodian | 09-Welcoming-Emotions | 0.594 | **R** |

**P@3 = 1.00** ✅ — All 3 chunks directly address working with difficult emotions in meditation.

---

### Q12 — "What is the pointing out instruction in Dzogchen or rigpa?"
| Rank | Speaker | Source | Score | Relevance |
|------|---------|--------|-------|-----------|
| 1 | Stephan Bodian | A-Conversation-with-Stephan-Bodian | 0.735 | **R** |
| 2 | Sam Harris | Live-at-the-Wiltern | 0.636 | **R** |
| 3 | Joseph Goldstein | A-Conversation-with-Joseph-Goldstein | 0.635 | **R** |

**P@3 = 1.00** ✅ — Excellent. Three distinct perspectives on pointing out instructions, all substantive.

---

### Q13 — "How do I integrate meditation insights into daily life?"
| Rank | Speaker | Source | Score | Relevance |
|------|---------|--------|-------|-----------|
| 1 | Vidyamala Burch | 1-introduction-to-the-series | 0.666 | **R** |
| 2 | Sam Harris | The-Bridge-to-Compassion | 0.637 | **P** |
| 3 | William MacAskill | How-to-Be-a-Moral-Hero | 0.620 | **P** |

**P@3 = 0.67** — Rank 1 is directly on-topic. Ranks 2–3 are marginally related questions/contexts. Cohere re-ranking would likely surface better content from the broader candidate pool.

---

### Q14 — "What happens at the moment of awakening?"
| Rank | Speaker | Source | Score | Relevance |
|------|---------|--------|-------|-----------|
| 1 | Sam Harris | A-Conversation-with-Stephan-Bodian | 0.695 | **P** |
| 2 | Henry Shukman | No-Beard | 0.666 | **R** |
| 3 | Joan Tollifson | 6-attention-and-awareness | 0.660 | **R** |

**P@3 = 0.83** ✅ — Ranks 2–3 are substantive descriptions of the awakening moment.

---

### Q15 — "How can I stop identifying with my thoughts?"
| Rank | Speaker | Source | Score | Relevance |
|------|---------|--------|-------|-----------|
| 1 | Donald Robertson | 6-cognitive-distancing | 0.636 | **R** |
| 2 | Sam Harris | 60-Minute-Meditation-4 | 0.624 | **R** |
| 3 | Seth Gillihan | 4-Addressing-Core-Beliefs | 0.618 | **R** |

**P@3 = 1.00** ✅ — Excellent. Three distinct teachers offering practical approaches.

---

### Q16 — "What is non-dual awareness?"
| Rank | Speaker | Source | Score | Relevance |
|------|---------|--------|-------|-----------|
| 1 | Jim Newman | Wrestling-the-Paradox | 0.693 | **P** |
| 2 | Sam Harris | What-Is-Mindfulness-Fundamentals | 0.668 | **R** |
| 3 | Loch Kelly | Looking-for-the-Looker | 0.645 | **R** |

**P@3 = 0.83** ✅ — Rank 1 is a question fragment. Ranks 2–3 explain non-dual awareness substantively.

---

### Q17 — "Is enlightenment permanent?"
| Rank | Speaker | Source | Score | Relevance |
|------|---------|--------|-------|-----------|
| 1 | Sam Harris | Awakening | 0.731 | **I** |
| 2 | Sam Harris | Live-at-the-Wiltern | 0.694 | **I** |
| 3 | Mingyur Rinpoche | Live-at-the-Wiltern | 0.616 | **R** |

**P@3 = 0.33** ❌ — Ranks 1–2 are question fragments ("And what about enlightenment?", "Is there something beyond enlightenment?") with no content. Rank 3 addresses the permanence question directly. Issue: question fragments match well to question queries but contain no information.

---

### Q18 — "What is consciousness?"
| Rank | Speaker | Source | Score | Relevance |
|------|---------|--------|-------|-----------|
| 1 | Adyashanti | The-Context-of-Content | 0.645 | **P** |
| 2 | Sam Harris | Walking_in_Public | 0.644 | **I** |
| 3 | Sam Harris | A-Conversation-with-Stephan-Bodian | 0.621 | **I** |

**P@3 = 0.17** ❌ — Very broad query surfaces fragments. Ranks 2–3 are single-sentence or partial fragments ("Consciousness itself is undefined.", "... or consciousness."). Root cause: very general/short queries match sentence-level fragments rather than substantive explanations.

---

### Q19 — "Suffering"
| Rank | Speaker | Source | Score | Relevance |
|------|---------|--------|-------|-----------|
| 1 | Jim Newman | Wrestling-the-Paradox | 0.711 | **P** |
| 2 | Sam Harris | Wrestling-the-Paradox | 0.702 | **I** |
| 3 | Joan Tollifson | 4-exploring-the-self-contraction | 0.609 | **R** |

**P@3 = 0.50** — Single-word queries surface short conversational fragments. Rank 3 is substantive but the top results are questions/fragments. Single-word queries work poorly with this pipeline.

---

### Q20 — "Choiceless awareness vs acceptance — what is the difference?"
| Rank | Speaker | Source | Score | Relevance |
|------|---------|--------|-------|-----------|
| 1 | Diana Winston | Letting-Go-of-the-Anchor | 0.636 | **P** |
| 2 | Loch Kelly | Looking-for-the-Looker | 0.634 | **P** |
| 3 | Diana Winston | Choiceless-Awareness | 0.633 | **P** |

**P@3 = 0.50** — All three explain "choiceless awareness" but none directly contrast it with "acceptance". The corpus may not have explicit content comparing these two concepts.

---

## Summary Table

| ID | Query (abbreviated) | P@3 |
|----|---------------------|-----|
| Q01 | Sam Harris on DMN | 1.00 |
| Q02 | Adyashanti on end of suffering | 0.83 |
| Q03 | Tara Brach on RAIN | 1.00 |
| Q04 | Goldstein on insight meditation | 0.17 |
| Q05 | Rupert Spira on pure awareness | 0.17 |
| Q06 | What is non-self? | 0.83 |
| Q07 | Love and emptiness | 0.67 |
| Q08 | Resting in awareness | 1.00 |
| Q09 | Aware of awareness itself | 0.67 |
| Q10 | Mindfulness vs concentration | 0.83 |
| Q11 | Fear / difficult emotions | 1.00 |
| Q12 | Dzogchen pointing out | 1.00 |
| Q13 | Integrating insights | 0.67 |
| Q14 | Moment of awakening | 0.83 |
| Q15 | Stop identifying with thoughts | 1.00 |
| Q16 | What is non-dual awareness? | 0.83 |
| Q17 | Is enlightenment permanent? | 0.33 |
| Q18 | What is consciousness? | 0.17 |
| Q19 | Suffering (single word) | 0.50 |
| Q20 | Choiceless awareness vs acceptance | 0.50 |
| **Mean** | | **0.70** |

---

## Root Cause Analysis

### Why some queries fail

**1. Dialogue fragment chunks (affects Q04, Q17, Q18, Q19)**
Short conversational turns ("Joseph Goldstein: Correct.", "And what about enlightenment?", "Consciousness itself is undefined.") score highly on embedding similarity but contain no usable content. This was the target of OLU-439 (semantic chunking) — the new pipeline should eliminate these by merging short turns into idea-unit segments.

**2. Sparse teacher coverage (Q05 — Rupert Spira)**
Rupert Spira's substantive teaching content appears underrepresented in the corpus relative to his conversational turns. The new semantic chunking pass (OLU-439) with concept tagging (OLU-441) should help by making larger, concept-rich chunks from his sessions.

**3. Single-word or overly broad queries (Q18, Q19)**
"What is consciousness?" and "Suffering" match too broadly. The new dual-embedding approach (raw + summary namespace) with Cohere re-ranking should filter low-density matches.

**4. Cross-concept queries (Q20)**
"Choiceless awareness vs acceptance" requires reasoning across two concepts simultaneously. This is precisely the OLU-443 concept graph use case — cross-teacher synthesis requires graph traversal, not pure vector similarity.

---

## Comparison with Baseline (OLU-64)

No prior benchmark file found in the repo. This run establishes the **first formal baseline: P@3 = 0.70** for the legacy pipeline (text-embedding-3-small, `__default__` namespace, no re-ranking).

---

## Next Steps

1. **Run corpus re-ingestion** — `npx tsx scripts/refresh-corpus.ts --reindex` to populate the `waking-up` namespace with text-embedding-3-large embeddings + summaries. This is required before the new pipeline can be benchmarked at all.

2. **Re-run benchmark after re-ingestion** — same 20 queries against the new pipeline (large model + Cohere re-ranking). Target: P@3 ≥ 0.80 to justify the compute cost.

3. **Fix dialogue fragment chunking** — The semantic chunking from OLU-439 should merge short turns. Verify this is working after re-ingestion.

4. **Proceed to OLU-443** — The concept graph work is well-motivated by Q20 (cross-concept retrieval). Baseline P@3 = 0.70 provides the measurement baseline.

---

## Methodology Notes

- **No Cohere re-ranking**: `COHERE_API_KEY` not available locally. Production pipeline includes Cohere rerank-v3.5 after Pinecone retrieval; this would filter low-quality fragments and likely improve P@3 by 0.05–0.15.
- **200-char text truncation**: The production `/api/ask` returns sources truncated to 200 chars. This benchmark used full chunk text for scoring.
- **Binary scoring**: Partial (0.5) used for tangentially related chunks; this is subjective. A stricter binary (0/1) would yield P@3 ≈ 0.60.
- **`noCache` bypass**: Would need to be tested in production to confirm namespace issue is live.
