'use client';

export interface Source {
  text: string;
  speaker: string;
  source: string;
  score: number;
  sourceUrl?: string;
}

export interface CompareColumn {
  teacher: string;
  content: string;
  sources: Source[];
  /** Transient: true while this column's SSE stream is in progress. */
  streaming?: boolean;
  followUps?: string[];
}

export interface RelatedConcept {
  name: string;
  definition_excerpt: string | null;
  url: string;
}

export interface Message {
  role: 'user' | 'assistant';
  content: string;
  sources?: Source[];
  followUps?: string[];
  relatedConcepts?: RelatedConcept[];
  answerId?: string;
  error?: boolean;
  /** Transient UI state: true while SSE stream is still in progress. Never persisted. */
  streaming?: boolean;
  /** True when the answer was served from cache (exact-hash or semantic). Never persisted. */
  fromCache?: boolean;
  /** When set, renders side-by-side teacher comparison columns instead of a normal answer. */
  compareColumns?: CompareColumn[];
}

export interface Conversation {
  id: string;
  /** Supabase UUID from /api/ask. Set after first turn; enables cross-device history loading. */
  serverConversationId?: string;
  userId: string;
  title: string; // First user question, truncated
  messages: Message[];
  createdAt: number;
  updatedAt: number;
}

const MAX_CONVERSATIONS = 50;

function storageKey(userId: string): string {
  return `convergence_conversations_${userId}`;
}

export function loadConversations(userId: string): Conversation[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Conversation[];
    return parsed.sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

export function saveConversation(userId: string, conversation: Conversation): void {
  if (typeof window === 'undefined') return;
  const all = loadConversations(userId);
  const idx = all.findIndex((c) => c.id === conversation.id);
  if (idx >= 0) {
    all[idx] = conversation;
  } else {
    all.unshift(conversation);
  }
  // Keep only the most recent MAX_CONVERSATIONS
  const trimmed = all.slice(0, MAX_CONVERSATIONS);
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(trimmed));
  } catch {
    // Storage quota exceeded — drop oldest and retry
    const reduced = trimmed.slice(0, Math.floor(MAX_CONVERSATIONS / 2));
    try {
      localStorage.setItem(storageKey(userId), JSON.stringify(reduced));
    } catch {
      // Give up silently
    }
  }
}

export function deleteConversation(userId: string, conversationId: string): void {
  if (typeof window === 'undefined') return;
  const all = loadConversations(userId);
  const filtered = all.filter((c) => c.id !== conversationId);
  localStorage.setItem(storageKey(userId), JSON.stringify(filtered));
}

export function newConversationId(): string {
  return `conv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function titleFromQuestion(question: string): string {
  const trimmed = question.trim();
  return trimmed.length > 60 ? trimmed.slice(0, 57) + '…' : trimmed;
}
