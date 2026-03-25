import { cache } from 'react';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { supabase } from '@/lib/supabase';
import { SaveToReadingListButton } from '@/components/save-to-reading-list-button';
import { ExportAnswerPageButton } from '@/components/export-answer-page-button';
import { PeopleAlsoAsked } from '@/components/people-also-asked';

interface Source {
  text: string;
  speaker: string;
  source: string;
  score: number;
}

interface QAAnswer {
  id: string;
  question: string;
  answer: string;
  sources: Source[];
  created_at: string;
}

const getAnswer = cache(async (answerId: string): Promise<QAAnswer | null> => {
  const { data, error } = await supabase
    .from('qa_answers')
    .select('id, question, answer, sources, created_at')
    .eq('id', answerId)
    .single();

  if (error || !data) return null;
  return data as QAAnswer;
});

type Props = {
  params: Promise<{ answerId: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { answerId } = await params;
  const answer = await getAnswer(answerId);

  if (!answer) {
    return { title: 'Answer not found — Convergence' };
  }

  const description = answer.answer.replace(/\n+/g, ' ').trim().slice(0, 155);
  const siteUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'https://convergence-mvp.vercel.app';

  const ogImageUrl = `${siteUrl}/api/og?q=${encodeURIComponent(answer.question)}&a=${encodeURIComponent(description)}`;

  return {
    title: `${answer.question} — Convergence`,
    description,
    openGraph: {
      title: answer.question,
      description,
      url: `${siteUrl}/qa/${answerId}`,
      siteName: 'Convergence',
      type: 'article',
      images: [{ url: ogImageUrl, width: 1200, height: 630, alt: answer.question }],
    },
    twitter: {
      card: 'summary_large_image',
      title: answer.question,
      description,
      images: [ogImageUrl],
    },
  };
}

function sourceLabel(source: string): string {
  if (!source) return 'Transcript';
  const base = source.split('/').pop() ?? source;
  return base.replace(/\.[^.]+$/, '').replace(/[_-]/g, ' ');
}

function FormattedAnswer({ text }: { text: string }) {
  const paragraphs = text.split(/\n{2,}/).map((s) => s.trim()).filter(Boolean);
  if (paragraphs.length === 0) return <span>{text}</span>;

  return (
    <>
      {paragraphs.map((para, pIdx) => {
        // Strip [N] citation markers for the static page view
        const cleaned = para.replace(/\[\d+\]/g, '').trim();
        return (
          <p key={pIdx} style={{ marginTop: pIdx > 0 ? '0.8rem' : 0 }}>
            {cleaned.split('\n').map((line, k) => (
              <span key={k}>{k > 0 && <br />}{line}</span>
            ))}
          </p>
        );
      })}
    </>
  );
}

export default async function QAAnswerPage({ params }: Props) {
  const { answerId } = await params;
  const answer = await getAnswer(answerId);

  if (!answer) notFound();

  const top3Sources = answer.sources.slice(0, 3);

  return (
    <div className="flex flex-col min-h-screen" style={{ background: '#faf8f3' }}>
      <header
        className="flex items-center justify-between px-5 py-3 border-b"
        style={{ borderColor: '#e0d8cc', background: '#faf8f3' }}
      >
        <a
          href="/qa"
          className="flex items-center gap-1.5 text-xs font-medium"
          style={{ color: '#7d8c6e' }}
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
          </svg>
          Convergence
        </a>
        <span className="text-xs" style={{ color: '#b0a898' }}>Mindfulness Q&amp;A</span>
      </header>

      <main id="main-content" className="flex-1 max-w-2xl w-full mx-auto px-4 py-8">
        {/* Question */}
        <div className="mb-6">
          <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: '#9c9080' }}>
            Question
          </p>
          <h1 className="text-lg font-semibold leading-snug" style={{ color: '#3d4f38' }}>
            {answer.question}
          </h1>
        </div>

        {/* Answer */}
        <div
          className="rounded-2xl px-5 py-5 text-sm leading-relaxed mb-6"
          style={{ background: '#f0ece3', color: '#2c2c2c' }}
        >
          <FormattedAnswer text={answer.answer} />
          <div className="mt-4 pt-3 flex items-center gap-4" style={{ borderTop: '1px solid #ddd5c8' }}>
            <SaveToReadingListButton answerId={answer.id} />
            <ExportAnswerPageButton
              question={answer.question}
              answer={answer.answer}
              sources={answer.sources}
            />
          </div>
        </div>

        {/* Sources */}
        {top3Sources.length > 0 && (
          <div className="mb-8">
            <p className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: '#9c9080' }}>
              Sources
            </p>
            <div className="space-y-2">
              {top3Sources.map((s, i) => (
                <div
                  key={i}
                  className="rounded-lg p-3 text-xs"
                  style={{ background: '#fff', borderLeft: '2px solid #b8ccb0', border: '1px solid #e0d8cc' }}
                >
                  <div className="flex items-start gap-2">
                    <span
                      className="font-mono flex-shrink-0 mt-0.5"
                      style={{ color: '#9c9080', fontSize: '0.65rem' }}
                    >
                      [{i + 1}]
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold mb-0.5" style={{ color: '#5a6b52' }}>
                        {sourceLabel(s.source)}
                      </p>
                      {s.speaker && (
                        <p className="mb-1 opacity-70" style={{ color: '#5a6b52' }}>
                          {s.speaker}
                        </p>
                      )}
                      <p className="leading-relaxed" style={{ color: '#5c5248' }}>
                        {s.text}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* People also asked */}
        <PeopleAlsoAsked answerId={answer.id} />

        {/* CTA */}
        <div
          className="rounded-2xl px-5 py-5 text-center"
          style={{ background: '#f0ece3', border: '1px solid #ddd5c8' }}
        >
          <p className="text-sm font-medium mb-1" style={{ color: '#3d4f38' }}>
            Explore more mindfulness teachings
          </p>
          <p className="text-xs mb-4" style={{ color: '#9c9080' }}>
            Ask anything — sourced from 760+ hours of guided meditations and conversations.
          </p>
          <a
            href="/qa"
            className="inline-flex items-center gap-1.5 text-xs px-4 py-2 rounded-full font-medium"
            style={{ background: '#7d8c6e', color: '#fff' }}
          >
            Ask a question
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
            </svg>
          </a>
        </div>
      </main>

      <footer
        className="flex items-center justify-center px-5 py-3 border-t"
        style={{ borderColor: '#e0d8cc', background: '#faf8f3' }}
      >
        <span className="text-xs" style={{ color: '#b0a898' }}>
          Convergence · Paradox of Acceptance
        </span>
      </footer>
    </div>
  );
}
