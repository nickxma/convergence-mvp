'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/lib/use-auth';

interface SuggestedQuestion {
  question: string;
  source: 'curated' | 'trending';
  clusterLabel?: string;
  queryCount?: number;
}

interface TrendingTopic {
  clusterLabel: string;
  canonicalQuestion: string;
  queryCount: number;
  weekOf: string;
}

interface RecentSession {
  id: string;
  title: string;
  turnCount: number;
  updatedAt: string;
}

interface QAHomepageProps {
  onSelectQuestion: (question: string) => void;
  onSelectSession?: (sessionId: string) => void;
}

const PLACEHOLDER_QUESTIONS = [
  'What is the relationship between mindfulness and suffering?',
  'How can I be more present in everyday life?',
  'What do contemplative traditions say about the nature of the self?',
];

// Map question text to a category icon using keyword matching.
function CategoryIcon({ question }: { question: string }) {
  const q = question.toLowerCase();

  // Eye / consciousness / awareness / self
  if (/\b(self|ego|conscious|aware|identity|who am i)\b/.test(q)) {
    return (
      <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
      </svg>
    );
  }

  // Heart / suffering / pain / compassion / love / anxiety / stress / emotion
  if (/\b(suffer|pain|compassion|love|anxiety|stress|emotion|fear|anger|grief|trauma)\b/.test(q)) {
    return (
      <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12Z" />
      </svg>
    );
  }

  // Flame / meditation / practice / breath / focus / present / now / moment
  if (/\b(meditat|breath|practice|present|now|moment|mindful|focus|attention)\b/.test(q)) {
    return (
      <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.362 5.214A8.252 8.252 0 0 1 12 21 8.25 8.25 0 0 1 6.038 7.047 8.287 8.287 0 0 0 9 9.601a8.983 8.983 0 0 1 3.361-6.867 8.21 8.21 0 0 0 3 2.48Z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 18a3.75 3.75 0 0 0 .495-7.468 5.99 5.99 0 0 0-1.925 3.547 5.975 5.975 0 0 1-2.133-1.001A3.75 3.75 0 0 0 12 18Z" />
      </svg>
    );
  }

  // Lightbulb / thought / mind / free will / thinking / belief / idea
  if (/\b(thought|mind|free will|think|belief|idea|wisdom|truth|philosophy)\b/.test(q)) {
    return (
      <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 18v-5.25m0 0a6.01 6.01 0 0 0 1.5-.189m-1.5.189a6.01 6.01 0 0 1-1.5-.189m3.75 7.478a12.06 12.06 0 0 1-4.5 0m3.75 2.383a14.406 14.406 0 0 1-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 1 0-7.517 0c.85.493 1.509 1.333 1.509 2.316V18" />
      </svg>
    );
  }

  // Users / relationship / community / connection / social
  if (/\b(relationship|connect|community|social|partner|friend|people|others|together)\b/.test(q)) {
    return (
      <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" />
      </svg>
    );
  }

  // Default: sparkle / question spark
  return (
    <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09Z" />
    </svg>
  );
}

function formatRelativeTime(isoString: string): string {
  const diffMs = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(diffMs / 3_600_000);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(diffMs / 86_400_000);
  if (days < 7) return `${days}d ago`;
  return new Date(isoString).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function QAHomepage({ onSelectQuestion, onSelectSession }: QAHomepageProps) {
  const { user, getAccessToken } = useAuth();
  const userId = user?.id ?? null;

  const [suggestedQuestions, setSuggestedQuestions] = useState<SuggestedQuestion[]>([]);
  const [trendingTopics, setTrendingTopics] = useState<TrendingTopic[]>([]);
  const [recentSessions, setRecentSessions] = useState<RecentSession[]>([]);
  const [placeholderIndex, setPlaceholderIndex] = useState(0);
  const [loadingQuestions, setLoadingQuestions] = useState(true);

  // Fetch suggested questions and trending topics in parallel
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoadingQuestions(true);
      try {
        const [sqRes, ttRes] = await Promise.all([
          fetch('/api/qa/suggested-questions'),
          fetch('/api/qa/trending'),
        ]);
        if (cancelled) return;
        if (sqRes.ok) {
          const data = await sqRes.json() as { questions: SuggestedQuestion[] };
          setSuggestedQuestions(data.questions ?? []);
        }
        if (ttRes.ok) {
          const data = await ttRes.json() as { topics: TrendingTopic[] };
          setTrendingTopics((data.topics ?? []).slice(0, 4));
        }
      } catch {
        // silently ignore — fallback to empty
      } finally {
        if (!cancelled) setLoadingQuestions(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, []);

  // Fetch recent sessions when authenticated
  const fetchRecentSessions = useCallback(async () => {
    if (!userId) return;
    try {
      const token = await getAccessToken();
      const res = await fetch('/api/qa-conversations', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) return;
      const data = await res.json() as { conversations: RecentSession[] };
      setRecentSessions((data.conversations ?? []).slice(0, 3));
    } catch {
      // silently ignore
    }
  }, [userId, getAccessToken]);

  useEffect(() => {
    void fetchRecentSessions();
  }, [fetchRecentSessions]);

  // Rotate placeholder text every 3.5 seconds
  useEffect(() => {
    const id = setInterval(() => {
      setPlaceholderIndex((i) => (i + 1) % PLACEHOLDER_QUESTIONS.length);
    }, 3500);
    return () => clearInterval(id);
  }, []);

  // Questions to show in the grid (first 6)
  const gridQuestions = suggestedQuestions.slice(0, 6);

  return (
    <div className="w-full max-w-2xl mx-auto px-4 py-8">

      {/* Hero */}
      <div className="text-center mb-8">
        <div
          className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4"
          style={{ background: 'var(--bg-chip)' }}
        >
          <svg className="w-6 h-6" style={{ color: 'var(--sage)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 1 1 6 0v8.25a3 3 0 0 1-3 3Z" />
          </svg>
        </div>
        <h1 className="text-lg font-semibold mb-1" style={{ color: 'var(--sage-dark)' }}>
          Ask anything about mindfulness
        </h1>
        <p className="text-xs mb-5" style={{ color: 'var(--text-muted)' }}>
          Answers from hundreds of hours from leading mindfulness teachers and practitioners — talks, meditations, and conversations.
        </p>

        {/* Animated placeholder prompt */}
        <button
          type="button"
          onClick={() => onSelectQuestion(PLACEHOLDER_QUESTIONS[placeholderIndex])}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-full border text-sm transition-colors max-w-sm w-full justify-between"
          style={{
            borderColor: 'var(--border)',
            background: 'var(--bg-input, var(--bg-surface))',
            color: 'var(--text-faint)',
            textAlign: 'left',
          }}
          aria-label={`Try: ${PLACEHOLDER_QUESTIONS[placeholderIndex]}`}
        >
          <span className="truncate text-left">{PLACEHOLDER_QUESTIONS[placeholderIndex]}</span>
          <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
          </svg>
        </button>
      </div>

      {/* Trending Now */}
      {trendingTopics.length > 0 && (
        <div className="mb-7">
          <p className="text-xs font-semibold uppercase tracking-wide mb-2.5" style={{ color: 'var(--text-faint)' }}>
            Trending Now
          </p>
          <div className="flex flex-wrap gap-2">
            {trendingTopics.map((topic) => (
              <button
                key={topic.clusterLabel}
                type="button"
                onClick={() => onSelectQuestion(topic.canonicalQuestion)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs border transition-colors"
                style={{
                  borderColor: 'var(--sage-mid, var(--sage))',
                  color: 'var(--sage)',
                  background: 'transparent',
                }}
              >
                <svg className="w-3 h-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18 9 11.25l4.306 4.306a11.95 11.95 0 0 1 5.814-5.518l2.74-1.22m0 0-5.94-2.281m5.94 2.28-2.28 5.941" />
                </svg>
                {topic.clusterLabel}
                <span style={{ color: 'var(--text-faint)', fontWeight: 400 }}>· {topic.queryCount}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Suggested Questions Grid */}
      <div className="mb-7">
        <p className="text-xs font-semibold uppercase tracking-wide mb-2.5" style={{ color: 'var(--text-faint)' }}>
          Explore Questions
        </p>
        {loadingQuestions ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <div
                key={n}
                className="h-16 rounded-xl animate-pulse"
                style={{ background: 'var(--bg-chip)' }}
              />
            ))}
          </div>
        ) : gridQuestions.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {gridQuestions.map((q) => (
              <button
                key={q.question}
                type="button"
                onClick={() => onSelectQuestion(q.question)}
                className="flex items-start gap-3 px-4 py-3 rounded-xl border text-left transition-colors group"
                style={{
                  border: '1px solid var(--border-subtle, var(--border))',
                  background: 'var(--bg-surface, var(--bg-chip))',
                  color: 'var(--text-warm, var(--text))',
                }}
              >
                <span style={{ color: 'var(--sage)', marginTop: '1px' }}>
                  <CategoryIcon question={q.question} />
                </span>
                <span className="flex-1 text-xs leading-snug line-clamp-3">
                  {q.question}
                </span>
                <svg
                  className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 opacity-40 group-hover:opacity-80 transition-opacity"
                  style={{ color: 'var(--sage)' }}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                  aria-hidden="true"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
                </svg>
              </button>
            ))}
          </div>
        ) : (
          /* Fallback static questions if API returns nothing */
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {[
              'What is the nature of the self?',
              'How do I stop overthinking?',
              'What is mindfulness, really?',
              'How can I reduce anxiety through meditation?',
              'What does it mean to be fully present?',
              'How does mindfulness relate to free will?',
            ].map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => onSelectQuestion(q)}
                className="flex items-start gap-3 px-4 py-3 rounded-xl border text-left transition-colors group"
                style={{
                  border: '1px solid var(--border-subtle, var(--border))',
                  background: 'var(--bg-surface, var(--bg-chip))',
                  color: 'var(--text-warm, var(--text))',
                }}
              >
                <span style={{ color: 'var(--sage)', marginTop: '1px' }}>
                  <CategoryIcon question={q} />
                </span>
                <span className="flex-1 text-xs leading-snug">
                  {q}
                </span>
                <svg
                  className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 opacity-40 group-hover:opacity-80 transition-opacity"
                  style={{ color: 'var(--sage)' }}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                  aria-hidden="true"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
                </svg>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Your Recent Questions — auth-gated */}
      {userId && recentSessions.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide mb-2.5" style={{ color: 'var(--text-faint)' }}>
            Your Recent Questions
          </p>
          <div className="space-y-1.5">
            {recentSessions.map((session) => (
              <button
                key={session.id}
                type="button"
                onClick={() => onSelectSession?.(session.id)}
                className="w-full flex items-center justify-between gap-3 px-4 py-2.5 rounded-xl border text-left transition-colors"
                style={{
                  border: '1px solid var(--border-subtle, var(--border))',
                  background: 'transparent',
                  color: 'var(--text)',
                }}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <svg className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'var(--text-faint)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                  </svg>
                  <span className="text-xs truncate" style={{ color: 'var(--text-warm, var(--text))' }}>
                    {session.title}
                  </span>
                </div>
                <span className="text-xs flex-shrink-0" style={{ color: 'var(--text-faint)' }}>
                  {formatRelativeTime(session.updatedAt)}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
