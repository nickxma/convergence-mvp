'use client';

import { useState } from 'react';
import { AudioPlayer } from '@/components/audio-player';

// ── Types ─────────────────────────────────────────────────────────────────────

interface SessionSummary {
  id: string;
  slug: string;
  title: string;
}

interface SessionContentProps {
  session: {
    id: string;
    courseId: string;
    slug: string;
    title: string;
    body: string;
    audioUrl: string | null;
    sortOrder: number;
  };
  course: {
    id: string;
    slug: string;
    title: string;
    sessionsTotal: number;
  };
  prev: SessionSummary | null;
  next: SessionSummary | null;
}

// ── Paragraph rendering ───────────────────────────────────────────────────────

function SessionBody({ body }: { body: string }) {
  const paragraphs = body
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  return (
    <div className="space-y-5">
      {paragraphs.map((para, i) => (
        <p
          key={i}
          className="text-base leading-relaxed"
          style={{ color: 'var(--text-warm)' }}
        >
          {para}
        </p>
      ))}
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export function SessionContent({ session, course, prev, next }: SessionContentProps) {
  const [completed, setCompleted] = useState(false);

  function handleMarkComplete() {
    setCompleted(true);
    // TODO: persist completion via POST /api/courses/{id}/completions when
    // user auth is wired to course progress tracking.
  }

  return (
    <>
      {/* Audio player — only shown when audio_url is set */}
      {session.audioUrl && (
        <AudioPlayer
          audioUrl={session.audioUrl}
          sessionId={session.id}
          onMarkComplete={handleMarkComplete}
        />
      )}

      {/* Text content */}
      <article aria-label="Session content">
        <SessionBody body={session.body} />
      </article>

      {/* Ask about this essay CTA */}
      <div className="mt-8 flex flex-wrap items-center gap-3">
        <a
          href={`/ask?essay=${encodeURIComponent(session.slug)}&course=${encodeURIComponent(course.slug)}`}
          className="inline-flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          style={{ background: 'var(--bg-chip)', color: 'var(--sage)' }}
        >
          <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 5.25h.008v.008H12v-.008Z" />
          </svg>
          Ask about this essay
        </a>

        {/* Reading completion CTA (shown when no audio, or after audio completes) */}
        {!session.audioUrl && !completed && (
          <button
            onClick={handleMarkComplete}
            className="text-sm font-medium px-4 py-2 rounded-lg transition-colors"
            style={{ background: 'var(--sage)', color: '#fff' }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--sage-hover)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--sage)')}
          >
            Mark session complete
          </button>
        )}
      </div>

      {/* Completion confirmation — shown after marking complete */}
      {completed && (
        <div
          className="mt-8 rounded-xl px-4 py-3 flex items-center gap-3"
          style={{
            background: 'var(--celebration-bg)',
            border: '1px solid var(--celebration-border)',
          }}
          role="status"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            className="w-5 h-5 flex-shrink-0"
            style={{ color: 'var(--celebration-text)' }}
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-sm font-medium" style={{ color: 'var(--celebration-text)' }}>
            Session complete
          </p>
        </div>
      )}

      {/* Navigation */}
      <nav
        aria-label="Session navigation"
        className="mt-10 pt-6 flex justify-between gap-4"
        style={{ borderTop: '1px solid var(--border)' }}
      >
        {prev ? (
          <a
            href={`/courses/${course.slug}/sessions/${prev.slug}`}
            className="group flex items-center gap-2 text-sm transition-colors"
            style={{ color: 'var(--text-muted)' }}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              className="w-4 h-4 flex-shrink-0"
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
            </svg>
            <span>
              <span
                className="block text-xs uppercase tracking-wide"
                style={{ color: 'var(--text-faint)' }}
              >
                Previous
              </span>
              <span
                className="block font-medium group-hover:underline"
                style={{ color: 'var(--text-warm)' }}
              >
                {prev.title}
              </span>
            </span>
          </a>
        ) : (
          <div />
        )}

        {next ? (
          <a
            href={`/courses/${course.slug}/sessions/${next.slug}`}
            className="group flex items-center gap-2 text-sm text-right transition-colors"
            style={{ color: 'var(--text-muted)' }}
          >
            <span>
              <span
                className="block text-xs uppercase tracking-wide"
                style={{ color: 'var(--text-faint)' }}
              >
                Next
              </span>
              <span
                className="block font-medium group-hover:underline"
                style={{ color: 'var(--text-warm)' }}
              >
                {next.title}
              </span>
            </span>
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              className="w-4 h-4 flex-shrink-0"
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
            </svg>
          </a>
        ) : (
          <div />
        )}
      </nav>
    </>
  );
}
