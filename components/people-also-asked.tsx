'use client';

/**
 * PeopleAlsoAsked
 *
 * Renders a "People also asked" section below a Q&A answer.
 * Fetches related questions from GET /api/queries/:answerId/related.
 * Each chip expands to inline-show the related answer without navigation.
 *
 * Usage:
 *   <PeopleAlsoAsked answerId="<uuid>" />
 */

import { useEffect, useState, useCallback } from 'react';

interface RelatedQuestion {
  question: string;
  answer_snippet: string;
  similarity: number;
}

interface PeopleAlsoAskedProps {
  answerId: string;
}

export function PeopleAlsoAsked({ answerId }: PeopleAlsoAskedProps) {
  const [related, setRelated] = useState<RelatedQuestion[]>([]);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    fetch(`/api/queries/${encodeURIComponent(answerId)}/related`)
      .then((res) => (res.ok ? res.json() : { related: [] }))
      .then((data: { related: RelatedQuestion[] }) => {
        if (!cancelled) {
          setRelated(data.related ?? []);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [answerId]);

  const toggle = useCallback((idx: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) {
        next.delete(idx);
      } else {
        next.add(idx);
      }
      return next;
    });
  }, []);

  if (loading || related.length === 0) return null;

  return (
    <section aria-label="People also asked" className="mb-8">
      <p
        className="text-xs font-semibold uppercase tracking-wide mb-3"
        style={{ color: '#9c9080' }}
      >
        People also asked
      </p>

      <div className="space-y-2">
        {related.map((item, idx) => {
          const isOpen = expanded.has(idx);
          return (
            <div
              key={idx}
              className="rounded-xl overflow-hidden"
              style={{ border: '1px solid #e0d8cc', background: '#fff' }}
            >
              {/* Chip / question row */}
              <button
                onClick={() => toggle(idx)}
                aria-expanded={isOpen}
                className="w-full text-left flex items-center justify-between gap-3 px-4 py-3"
                style={{
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  color: '#3d4f38',
                }}
              >
                <span className="text-sm font-medium leading-snug flex-1">
                  {item.question}
                </span>
                {/* Chevron */}
                <svg
                  aria-hidden="true"
                  className="flex-shrink-0 transition-transform duration-200"
                  style={{
                    width: 16,
                    height: 16,
                    color: '#9c9080',
                    transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                  }}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" />
                </svg>
              </button>

              {/* Inline answer */}
              {isOpen && (
                <div
                  className="px-4 pb-4 text-sm leading-relaxed border-t"
                  style={{ color: '#2c2c2c', borderColor: '#e0d8cc' }}
                >
                  <p className="mt-3">{item.answer_snippet}</p>
                  {item.answer_snippet.length >= 278 && (
                    <p className="mt-2 text-xs" style={{ color: '#9c9080' }}>
                      Snippet — ask the full question for a complete answer.
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
