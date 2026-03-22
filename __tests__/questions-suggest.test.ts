/**
 * Unit tests for the /api/questions/suggest aggregation logic.
 */
import { describe, it, expect } from 'vitest';
import {
  aggregateSuggestions,
  MIN_QUERY_LENGTH,
  MAX_RESULTS,
} from '../lib/suggest';

describe('MIN_QUERY_LENGTH', () => {
  it('is 3', () => {
    expect(MIN_QUERY_LENGTH).toBe(3);
  });
});

describe('MAX_RESULTS', () => {
  it('is 5', () => {
    expect(MAX_RESULTS).toBe(5);
  });
});

describe('aggregateSuggestions', () => {
  it('returns empty array for empty input', () => {
    expect(aggregateSuggestions([])).toEqual([]);
  });

  it('counts a single unique question correctly', () => {
    const result = aggregateSuggestions([{ question: 'What is mindfulness?' }]);
    expect(result).toEqual([{ question: 'What is mindfulness?', count: 1 }]);
  });

  it('counts duplicate questions', () => {
    const rows = [
      { question: 'What is mindfulness?' },
      { question: 'What is mindfulness?' },
      { question: 'What is mindfulness?' },
    ];
    expect(aggregateSuggestions(rows)).toEqual([
      { question: 'What is mindfulness?', count: 3 },
    ]);
  });

  it('ranks by descending frequency', () => {
    const rows = [
      { question: 'How to meditate?' },
      { question: 'What is mindfulness?' },
      { question: 'How to meditate?' },
      { question: 'What is mindfulness?' },
      { question: 'How to meditate?' },
    ];
    const result = aggregateSuggestions(rows);
    expect(result[0].question).toBe('How to meditate?');
    expect(result[0].count).toBe(3);
    expect(result[1].question).toBe('What is mindfulness?');
    expect(result[1].count).toBe(2);
  });

  it('trims whitespace when grouping', () => {
    const rows = [
      { question: '  What is mindfulness?  ' },
      { question: 'What is mindfulness?' },
    ];
    const result = aggregateSuggestions(rows);
    expect(result).toHaveLength(1);
    expect(result[0].count).toBe(2);
  });

  it('caps results at maxResults (default 5)', () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({
      question: `Question ${i}`,
    }));
    expect(aggregateSuggestions(rows)).toHaveLength(5);
  });

  it('respects a custom maxResults argument', () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({
      question: `Question ${i}`,
    }));
    expect(aggregateSuggestions(rows, 3)).toHaveLength(3);
  });

  it('returns fewer results when there are fewer unique questions', () => {
    const rows = [
      { question: 'Only question' },
      { question: 'Only question' },
    ];
    const result = aggregateSuggestions(rows);
    expect(result).toHaveLength(1);
  });
});
