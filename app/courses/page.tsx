'use client';

import { useState, useEffect } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import Link from 'next/link';

interface Course {
  id: string;
  slug: string;
  title: string;
  description: string;
  sessionsTotal: number;
  isFree: boolean;
  sortOrder: number;
}

function ProLockOverlay() {
  return (
    <div
      className="absolute inset-0 rounded-2xl flex flex-col items-center justify-center gap-2"
      style={{
        background: 'rgba(0,0,0,0.45)',
        backdropFilter: 'blur(2px)',
      }}
    >
      <span
        className="text-xs font-bold px-2.5 py-1 rounded"
        style={{ background: '#7c3aed', color: '#fff', letterSpacing: '0.06em' }}
      >
        PRO
      </span>
      <p className="text-xs text-white opacity-90">Upgrade to unlock</p>
    </div>
  );
}

function CourseCard({ course, locked }: { course: Course; locked: boolean }) {
  const content = (
    <div
      className="relative rounded-2xl p-5 border transition-shadow hover:shadow-md"
      style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        <h2
          className="text-sm font-semibold leading-snug"
          style={{ color: locked ? 'var(--text-muted)' : 'var(--sage-dark)' }}
        >
          {course.title}
        </h2>
        {!course.isFree && (
          <span
            className="flex-shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded"
            style={{ background: locked ? 'var(--bg-chip)' : '#7c3aed', color: locked ? 'var(--text-muted)' : '#fff', letterSpacing: '0.04em' }}
          >
            PRO
          </span>
        )}
      </div>
      <p
        className="text-xs leading-relaxed mb-3 line-clamp-3"
        style={{ color: 'var(--text-muted)' }}
      >
        {course.description}
      </p>
      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
        {course.sessionsTotal} session{course.sessionsTotal !== 1 ? 's' : ''}
      </span>

      {locked && <ProLockOverlay />}
    </div>
  );

  if (locked) {
    return (
      <a href="/access" className="block">
        {content}
      </a>
    );
  }

  return (
    <Link href={`/courses/${course.slug}/sessions/1`} className="block">
      {content}
    </Link>
  );
}

export default function CoursesPage() {
  const { authenticated, getAccessToken } = usePrivy();
  const [courses, setCourses] = useState<Course[]>([]);
  const [isPro, setIsPro] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        // Fetch course catalog (public endpoint)
        const res = await fetch('/api/courses');
        if (res.ok) {
          const data = await res.json();
          setCourses(data.courses ?? []);
        }
      } catch {
        // ignore
      }

      // Fetch user tier if authenticated
      if (authenticated) {
        try {
          const token = await getAccessToken();
          const headers: Record<string, string> = {};
          if (token) headers['Authorization'] = `Bearer ${token}`;
          const res = await fetch('/api/subscriptions/me', { headers });
          if (res.ok) {
            const data = await res.json();
            setIsPro(data.tier === 'pro' || data.tier === 'team');
          }
        } catch {
          // treat as free
        }
      }

      setLoading(false);
    }

    load();
  }, [authenticated, getAccessToken]);

  return (
    <main className="min-h-screen" style={{ background: 'var(--bg)' }}>
      <div className="max-w-3xl mx-auto px-4 py-10">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-semibold mb-1" style={{ color: 'var(--sage-dark)' }}>
            Courses
          </h1>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            Structured meditation journeys.{' '}
            {!isPro && (
              <>
                <a href="/access" style={{ color: 'var(--sage)', textDecoration: 'underline' }}>
                  Upgrade to Pro
                </a>{' '}
                to unlock all courses.
              </>
            )}
          </p>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[1, 2, 3, 4].map((n) => (
              <div
                key={n}
                className="rounded-2xl h-40 animate-pulse"
                style={{ background: 'var(--bg-chip)' }}
              />
            ))}
          </div>
        ) : courses.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            No courses available yet.
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {courses.map((course) => {
              const locked = !course.isFree && !isPro;
              return (
                <CourseCard key={course.id} course={course} locked={locked} />
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
