/**
 * /explore — Browse questions by topic and discover popular answers.
 *
 * Two sections:
 *   1. Topic pills — cluster labels from question_clusters; clicking runs a
 *      pre-seeded query in the Q&A interface via /qa?q=<topic>.
 *   2. Popular questions — 20 most-recent answers from qa_answers, each
 *      linking to its permalink at /qa/<id>.
 *
 * Server component; revalidated daily via ISR.
 * Public (no auth required). Good for SEO.
 */

import type { Metadata } from 'next';
import { supabase } from '@/lib/supabase';

export const revalidate = 86400; // 24 hours

export const metadata: Metadata = {
  title: 'Explore — Convergence',
  description:
    'Browse mindfulness and meditation questions by topic, or discover what the Q&A engine already knows from 760+ hours of contemplative teachings.',
  openGraph: {
    title: 'Explore — Convergence',
    description:
      'Browse mindfulness and meditation questions by topic, or discover what the Q&A engine already knows from 760+ hours of contemplative teachings.',
    siteName: 'Convergence',
    type: 'website',
  },
};

interface TopicPill {
  clusterId: number;
  label: string;
  questionCount: number;
}

interface RecentQuestion {
  id: string;
  question: string;
}

async function getTopics(): Promise<TopicPill[]> {
  const { data, error } = await supabase
    .from('question_clusters')
    .select('cluster_id, cluster_label')
    .order('cluster_id', { ascending: true });

  if (error || !data) return [];

  const map = new Map<number, { label: string; count: number }>();
  for (const row of data) {
    const id = row.cluster_id as number;
    if (!map.has(id)) {
      map.set(id, { label: row.cluster_label as string, count: 0 });
    }
    map.get(id)!.count++;
  }

  return Array.from(map.entries())
    .sort(([a], [b]) => a - b)
    .map(([clusterId, { label, count }]) => ({
      clusterId,
      label,
      questionCount: count,
    }));
}

async function getRecentQuestions(): Promise<RecentQuestion[]> {
  const { data, error } = await supabase
    .from('qa_answers')
    .select('id, question')
    .order('created_at', { ascending: false })
    .limit(20);

  if (error || !data) return [];
  return data as RecentQuestion[];
}

export default async function ExplorePage() {
  const [topics, questions] = await Promise.all([
    getTopics(),
    getRecentQuestions(),
  ]);

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg)', color: 'var(--text)' }}>
      {/* Header */}
      <header
        className="flex items-center justify-between px-5 py-3 border-b sticky top-0 z-10"
        style={{ borderColor: 'var(--border)', background: 'var(--bg)' }}
      >
        <div className="flex items-center gap-3">
          <a
            href="/qa"
            className="flex items-center gap-1.5 text-xs transition-colors"
            style={{ color: 'var(--sage)' }}
          >
            <svg
              aria-hidden="true"
              className="w-3.5 h-3.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
            </svg>
            Convergence
          </a>
          <span className="text-xs" style={{ color: 'var(--border)' }}>·</span>
          <h1 className="text-sm font-semibold" style={{ color: 'var(--sage-dark)' }}>
            Explore
          </h1>
        </div>
      </header>

      <main id="main-content" className="max-w-3xl mx-auto px-4 py-8 space-y-12">
        {/* Topic pills */}
        <section>
          <div className="mb-5">
            <h2 className="text-xl font-semibold mb-1.5" style={{ color: 'var(--sage-dark)' }}>
              Browse by topic
            </h2>
            <p className="text-sm leading-relaxed" style={{ color: 'var(--text-warm)' }}>
              Each topic opens the Q&amp;A with a pre-seeded question. See where the conversation goes.
            </p>
          </div>

          {topics.length === 0 ? (
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              No topics yet — check back soon.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {topics.map((topic) => (
                <a
                  key={topic.clusterId}
                  href={`/qa?q=${encodeURIComponent(topic.label)}`}
                  className="inline-flex items-center gap-2 text-sm px-4 py-2 rounded-full border transition-colors"
                  style={{
                    borderColor: 'var(--border)',
                    color: 'var(--sage-dark)',
                    background: 'var(--bg-surface)',
                  }}
                >
                  {topic.label}
                  <span
                    className="text-xs tabular-nums"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    {topic.questionCount}
                  </span>
                </a>
              ))}
            </div>
          )}
        </section>

        {/* Popular questions */}
        <section>
          <div className="mb-5">
            <h2 className="text-xl font-semibold mb-1.5" style={{ color: 'var(--sage-dark)' }}>
              Popular questions
            </h2>
            <p className="text-sm leading-relaxed" style={{ color: 'var(--text-warm)' }}>
              Questions the community has already asked — click to read the answer.
            </p>
          </div>

          {questions.length === 0 ? (
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              No questions yet — be the first to ask.
            </p>
          ) : (
            <ol className="space-y-2">
              {questions.map((q) => (
                <li key={q.id}>
                  <a
                    href={`/qa/${q.id}`}
                    className="flex items-start gap-3 rounded-xl px-4 py-3 text-sm transition-colors"
                    style={{
                      background: 'var(--bg-surface)',
                      border: '1px solid var(--border)',
                      color: 'var(--text)',
                    }}
                  >
                    <svg
                      aria-hidden="true"
                      className="w-4 h-4 flex-shrink-0 mt-0.5"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={1.5}
                      style={{ color: 'var(--sage)' }}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 5.25h.008v.008H12v-.008Z"
                      />
                    </svg>
                    <span className="leading-snug">{q.question}</span>
                  </a>
                </li>
              ))}
            </ol>
          )}
        </section>
      </main>
    </div>
  );
}
