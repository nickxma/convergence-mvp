/**
 * Pure helpers for Q&A conversation session management.
 * No I/O dependencies — safe to import in unit tests.
 */

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface HistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

export const MAX_HISTORY_TURNS = 20;

/**
 * Returns true when the string is a valid RFC 4122 UUID.
 */
export function isValidConversationId(id: unknown): id is string {
  return typeof id === 'string' && UUID_RE.test(id);
}

/**
 * Build an augmented Pinecone query that includes the last assistant response
 * so follow-up questions ("tell me more") retrieve semantically relevant chunks.
 */
export function buildQueryText(question: string, history: HistoryMessage[]): string {
  const lastAssistant = [...history].reverse().find((m) => m.role === 'assistant');
  if (!lastAssistant) return question;
  return `${lastAssistant.content.slice(0, 300)}\n\nFollow-up: ${question}`;
}

/**
 * Append the latest Q&A turn to history, capped at MAX_HISTORY_TURNS messages.
 */
export function appendTurn(
  history: HistoryMessage[],
  question: string,
  answer: string,
): HistoryMessage[] {
  return [
    ...history,
    { role: 'user' as const, content: question },
    { role: 'assistant' as const, content: answer },
  ].slice(-MAX_HISTORY_TURNS);
}
