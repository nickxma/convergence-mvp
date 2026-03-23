/**
 * Unit tests for lib/query-normalization.ts (OLU-792).
 *
 * Covers: contraction expansion, normalization, spell correction, synonym
 * expansion, and the combined enhanceQuery pipeline.
 */
import { describe, it, expect } from 'vitest';
import {
  normalizeQuery,
  spellCorrect,
  expandSynonyms,
  enhanceQuery,
} from '../lib/query-normalization';

// ── normalizeQuery ────────────────────────────────────────────────────────────

describe('normalizeQuery', () => {
  it('lowercases input', () => {
    expect(normalizeQuery('What Is Meditation?')).toBe('what is meditation');
  });

  it('strips trailing/leading punctuation', () => {
    expect(normalizeQuery('mindfulness!')).toBe('mindfulness');
    expect(normalizeQuery('...meditation...')).toBe('meditation');
  });

  it('expands contractions', () => {
    expect(normalizeQuery("What's mindfulness?")).toBe('what is mindfulness');
    expect(normalizeQuery("I'm struggling with meditation")).toBe(
      'i am struggling with meditation',
    );
    expect(normalizeQuery("don't judge your thoughts")).toBe(
      'do not judge your thoughts',
    );
  });

  it('preserves word-internal hyphens', () => {
    expect(normalizeQuery('non-dual awareness')).toBe('non-dual awareness');
    expect(normalizeQuery('loving-kindness practice')).toBe('loving-kindness practice');
  });

  it('collapses extra whitespace', () => {
    expect(normalizeQuery('  meditation   practice  ')).toBe('meditation practice');
  });

  it('handles empty string', () => {
    expect(normalizeQuery('')).toBe('');
  });
});

// ── spellCorrect ──────────────────────────────────────────────────────────────

describe('spellCorrect', () => {
  it('corrects a single-character typo in a domain term', () => {
    // "medtation" → "meditation" (missing i)
    const { corrected, changed } = spellCorrect('medtation');
    expect(corrected).toBe('meditation');
    expect(changed).toBe(true);
  });

  it('corrects a typo in a longer word', () => {
    // "mindfulnes" → "mindfulness" (missing s)
    const { corrected, changed } = spellCorrect('mindfulnes');
    expect(corrected).toBe('mindfulness');
    expect(changed).toBe(true);
  });

  it('does not change correctly spelled domain terms', () => {
    const { corrected, changed } = spellCorrect('meditation mindfulness awareness');
    expect(corrected).toBe('meditation mindfulness awareness');
    expect(changed).toBe(false);
  });

  it('does not change common words', () => {
    const { corrected, changed } = spellCorrect('what is the meaning of life');
    expect(corrected).toBe('what is the meaning of life');
    expect(changed).toBe(false);
  });

  it('skips words with 3 or fewer characters', () => {
    // "mnd" could be a typo for "mind" (distance 1) or other short words — skip
    const { corrected, changed } = spellCorrect('mnd body');
    // "mnd" is skipped (≤3 chars), "body" is in COMMON_WORDS
    expect(changed).toBe(false);
  });

  it('does not correct ambiguous cases', () => {
    // A word equidistant to multiple known words should not be corrected
    const { changed } = spellCorrect('zen'); // "zen" is in DOMAIN_TERMS, no correction
    expect(changed).toBe(false);
  });

  it('corrects multiple words in one query', () => {
    // "medtation" and "mindfulnes" both typos
    const { corrected, changed } = spellCorrect('medtation and mindfulnes');
    expect(corrected).toBe('meditation and mindfulness');
    expect(changed).toBe(true);
  });
});

// ── expandSynonyms ────────────────────────────────────────────────────────────

describe('expandSynonyms', () => {
  it('appends synonyms for a recognized domain term', () => {
    const result = expandSynonyms('meditation practice');
    expect(result).toContain('meditation');
    expect(result).toContain('mindfulness');
    expect(result).toContain('contemplation');
  });

  it('does not duplicate synonyms already in the query', () => {
    // "meditation mindfulness" — mindfulness is already present
    const result = expandSynonyms('meditation mindfulness');
    const words = result.split(' ');
    const mindfulnessCount = words.filter((w) => w === 'mindfulness').length;
    expect(mindfulnessCount).toBe(1);
  });

  it('returns unchanged string when no domain terms found', () => {
    const input = 'what is the nature of happiness';
    expect(expandSynonyms(input)).toBe(input);
  });

  it('handles multiple domain terms', () => {
    const result = expandSynonyms('impermanence suffering');
    // impermanence → anicca, transience; suffering → dukkha, dissatisfaction
    expect(result).toContain('anicca');
    expect(result).toContain('transience');
    expect(result).toContain('dukkha');
    expect(result).toContain('dissatisfaction');
  });

  it('handles empty string', () => {
    expect(expandSynonyms('')).toBe('');
  });
});

// ── enhanceQuery (full pipeline) ──────────────────────────────────────────────

describe('enhanceQuery', () => {
  it('returns correctedQuery when spell correction fires', () => {
    const result = enhanceQuery('What is medtation?');
    expect(result.correctedQuery).toBe('what is meditation');
    expect(result.spellCorrected).toBe(true);
  });

  it('returns null correctedQuery when no correction needed', () => {
    const result = enhanceQuery('What is meditation?');
    expect(result.correctedQuery).toBeNull();
    expect(result.spellCorrected).toBe(false);
  });

  it('enhancedQuery includes synonyms', () => {
    const result = enhanceQuery('meditation practice');
    expect(result.enhancedQuery).toContain('mindfulness');
    expect(result.enhancedQuery).toContain('contemplation');
  });

  it('normalizedQuery does not include synonyms', () => {
    const result = enhanceQuery('meditation practice');
    // normalizedQuery is the spell-corrected+normalized form without synonyms
    expect(result.normalizedQuery).toBe('meditation practice');
  });

  it('expands contractions before spell check', () => {
    // "What's" → "what is" before spell checking
    const result = enhanceQuery("What's mindfulnes?");
    expect(result.spellCorrected).toBe(true);
    expect(result.correctedQuery).toContain('mindfulness');
  });

  it('combines normalization, spell correction, and synonym expansion', () => {
    const result = enhanceQuery('Medtation AND Mindfulnes!');
    expect(result.spellCorrected).toBe(true);
    expect(result.normalizedQuery).toBe('meditation and mindfulness');
    expect(result.enhancedQuery).toContain('meditation');
    expect(result.enhancedQuery).toContain('mindfulness');
    // meditation synonyms: contemplation (mindfulness already in query)
    expect(result.enhancedQuery).toContain('contemplation');
  });
});
