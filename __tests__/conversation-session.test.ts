import { describe, it, expect } from 'vitest';
import {
  isValidConversationId,
  buildQueryText,
  appendTurn,
  MAX_HISTORY_TURNS,
} from '../lib/conversation-session';
import type { HistoryMessage } from '../lib/conversation-session';

// ── isValidConversationId ─────────────────────────────────────────────────────

describe('isValidConversationId', () => {
  it('accepts a valid v4 UUID', () => {
    expect(isValidConversationId('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
  });

  it('accepts UUID with uppercase hex', () => {
    expect(isValidConversationId('550E8400-E29B-41D4-A716-446655440000')).toBe(true);
  });

  it('rejects undefined', () => {
    expect(isValidConversationId(undefined)).toBe(false);
  });

  it('rejects null', () => {
    expect(isValidConversationId(null)).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isValidConversationId('')).toBe(false);
  });

  it('rejects non-UUID string', () => {
    expect(isValidConversationId('not-a-uuid')).toBe(false);
  });

  it('rejects UUID with wrong segment lengths', () => {
    expect(isValidConversationId('550e8400-e29b-41d4-a716-44665544000')).toBe(false);
  });

  it('rejects numeric values', () => {
    expect(isValidConversationId(12345)).toBe(false);
  });

  it('rejects objects', () => {
    expect(isValidConversationId({ id: 'uuid' })).toBe(false);
  });
});

// ── buildQueryText ────────────────────────────────────────────────────────────

describe('buildQueryText', () => {
  it('returns the question unchanged when history is empty', () => {
    expect(buildQueryText('What is mindfulness?', [])).toBe('What is mindfulness?');
  });

  it('prepends last assistant content for follow-up questions', () => {
    const history: HistoryMessage[] = [
      { role: 'user', content: 'What is mindfulness?' },
      { role: 'assistant', content: 'Mindfulness is the practice of present-moment awareness.' },
    ];
    const result = buildQueryText('Tell me more.', history);
    expect(result).toContain('Mindfulness is the practice of present-moment awareness.');
    expect(result).toContain('Follow-up: Tell me more.');
  });

  it('uses the most recent assistant message when there are multiple', () => {
    const history: HistoryMessage[] = [
      { role: 'user', content: 'First question?' },
      { role: 'assistant', content: 'First answer.' },
      { role: 'user', content: 'Second question?' },
      { role: 'assistant', content: 'Second answer.' },
    ];
    const result = buildQueryText('Third question.', history);
    expect(result).toContain('Second answer.');
    expect(result).not.toContain('First answer.');
  });

  it('truncates last assistant content at 300 characters', () => {
    const longAnswer = 'A'.repeat(400);
    const history: HistoryMessage[] = [
      { role: 'assistant', content: longAnswer },
    ];
    const result = buildQueryText('Follow up?', history);
    // Should contain exactly 300 chars from the assistant content
    expect(result.startsWith('A'.repeat(300))).toBe(true);
    expect(result).toContain('Follow-up: Follow up?');
  });

  it('returns the question unchanged when history contains only user messages', () => {
    const history: HistoryMessage[] = [
      { role: 'user', content: 'A previous question.' },
    ];
    expect(buildQueryText('New question.', history)).toBe('New question.');
  });
});

// ── appendTurn ────────────────────────────────────────────────────────────────

describe('appendTurn', () => {
  it('appends user and assistant messages to an empty history', () => {
    const result = appendTurn([], 'What is meditation?', 'It is focused awareness.');
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ role: 'user', content: 'What is meditation?' });
    expect(result[1]).toEqual({ role: 'assistant', content: 'It is focused awareness.' });
  });

  it('appends to existing history', () => {
    const existing: HistoryMessage[] = [
      { role: 'user', content: 'Q1' },
      { role: 'assistant', content: 'A1' },
    ];
    const result = appendTurn(existing, 'Q2', 'A2');
    expect(result).toHaveLength(4);
    expect(result[2]).toEqual({ role: 'user', content: 'Q2' });
    expect(result[3]).toEqual({ role: 'assistant', content: 'A2' });
  });

  it('caps history at MAX_HISTORY_TURNS messages', () => {
    // Build a history already at max
    const full: HistoryMessage[] = Array.from({ length: MAX_HISTORY_TURNS }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `msg-${i}`,
    }));
    const result = appendTurn(full, 'new question', 'new answer');
    expect(result).toHaveLength(MAX_HISTORY_TURNS);
    // Latest turn should be at the end
    expect(result[result.length - 1]).toEqual({ role: 'assistant', content: 'new answer' });
    expect(result[result.length - 2]).toEqual({ role: 'user', content: 'new question' });
  });

  it('does not mutate the original history array', () => {
    const original: HistoryMessage[] = [{ role: 'user', content: 'Q' }];
    appendTurn(original, 'Q2', 'A2');
    expect(original).toHaveLength(1);
  });
});
