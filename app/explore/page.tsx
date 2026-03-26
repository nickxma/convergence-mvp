/**
 * /explore — Browse questions by topic and discover popular answers.
 *
 * Four sections (in order):
 *   1. Featured Answers — admin-curated showcase cards, up to 12.
 *   2. Paradox of Acceptance — 3 most recent PoA essays with modal + Ask About This.
 *   3. Topic pills — cluster labels from question_clusters.
 *   4. Popular questions — 20 most-recent qa_answers.
 *
 * Server component; revalidated hourly via ISR (to pick up featured changes).
 * Public (no auth required). Good for SEO.
 */

import type { Metadata } from 'next';
import { supabase } from '@/lib/supabase';
import PoaSection from '@/components/poa-section';

export const revalidate = 3600; // 1 hour

export const metadata: Metadata = {
  title: 'Explore',
  description:
    'Browse mindfulness and meditation questions by topic, or discover what the Q&A engine already knows from hundreds of hours of contemplative teachings from leading mindfulness teachers and practitioners.',
  openGraph: {
    title: 'Explore — Convergence',
    description:
      'Browse mindfulness and meditation questions by topic, or discover what the Q&A engine already knows from hundreds of hours of contemplative teachings from leading mindfulness teachers and practitioners.',
    type: 'website',
  },
};

// ── Types ──────────────────────────────────────────────────────────────────────

interface TopicPill {
  clusterId: number;
  label: string;
  questionCount: number;
}

interface RecentQuestion {
  id: string;
  question: string;
}

interface Source {
  speaker?: string;
}

interface FeaturedAnswer {
  id: string;
  question: string;
  answer: string;
  sources: Source[];
  featured_order: number;
}

// ── Data fetchers ──────────────────────────────────────────────────────────────

async function getFeatured(): Promise<FeaturedAnswer[]> {
  const { data, error } = await supabase
    .from('qa_answers')
    .select('id, question, answer, sources, featured_order')
    .eq('featured', true)
    .order('featured_order', { ascending: true })
    .limit(12);

  if (error || !data) return [];
  return data as FeaturedAnswer[];
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

interface PoaSource {
  id: string;
  title: string | null;
  url: string;
  summary: string | null;
  chunk_count: number;
  published_at: string | null;
}

async function getPoaSources(): Promise<PoaSource[]> {
  const { data, error } = await supabase
    .from('corpus_sources')
    .select('id, title, url, summary, chunk_count, published_at')
    .eq('source', 'paradoxofacceptance')
    .order('published_at', { ascending: false, nullsFirst: false })
    .order('synced_at', { ascending: false })
    .limit(3);

  if (error || !data) return [];
  return data as PoaSource[];
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function answerExcerpt(answer: string, len = 100): string {
  return answer.replace(/\[\d+\]/g, '').trim().slice(0, len);
}

function teacherTags(sources: Source[]): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const s of sources) {
    const speaker = s.speaker?.trim();
    if (speaker && !seen.has(speaker)) {
      seen.add(speaker);
      tags.push(speaker);
    }
  }
  return tags;
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default async function ExplorePage() {
  const [featured, poaSources, topics, questions] = await Promise.all([
    getFeatured(),
    getPoaSources(),
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

        {/* Featured Answers */}
        {featured.length > 0 && (
          <section>
            <div className="mb-5">
              <h2 className="text-xl font-semibold mb-1.5" style={{ color: 'var(--sage-dark)' }}>
                Featured answers
              </h2>
              <p className="text-sm leading-relaxed" style={{ color: 'var(--text-warm)' }}>
                Hand-picked examples showing the depth and range of the corpus.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {featured.map((answer) => {
                const tags = teacherTags(answer.sources);
                const excerpt = answerExcerpt(answer.answer);
                return (
                  <a
                    key={answer.id}
                    href={`/qa/${answer.id}`}
                    className="flex flex-col gap-2 rounded-xl px-4 py-4 text-sm transition-colors"
                    style={{
                      background: 'var(--bg-surface)',
                      border: '1px solid var(--border)',
                      color: 'var(--text)',
                      textDecoration: 'none',
                    }}
                  >
                    {/* Question */}
                    <p className="font-medium leading-snug" style={{ color: 'var(--sage-dark)' }}>
                      {answer.question}
                    </p>

                    {/* Answer excerpt */}
                    <p
                      className="text-xs leading-relaxed flex-1"
                      style={{ color: 'var(--text-warm)' }}
                    >
                      {excerpt}
                      {answer.answer.length > 100 ? '…' : ''}
                    </p>

                    {/* Teacher tags */}
                    {tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {tags.map((tag) => (
                          <span
                            key={tag}
                            className="text-xs px-2 py-0.5 rounded-full"
                            style={{ background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </a>
                );
              })}
            </div>
          </section>
        )}

        {/* Paradox of Acceptance */}
        <PoaSection initialSources={poaSources} />

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
