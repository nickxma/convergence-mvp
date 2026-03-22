import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { supabase } from '@/lib/supabase';
import { SessionContent } from './session-content';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Session {
  id: string;
  courseId: string;
  slug: string;
  title: string;
  body: string;
  audioUrl: string | null;
  sortOrder: number;
}

interface Course {
  id: string;
  slug: string;
  title: string;
  sessionsTotal: number;
}

interface PageProps {
  params: Promise<{ courseSlug: string; sessionId: string }>;
}

// ── Data fetching ─────────────────────────────────────────────────────────────

async function fetchCourse(slug: string): Promise<Course | null> {
  const { data, error } = await supabase
    .from('courses')
    .select('id, slug, title, sessions_total')
    .eq('slug', slug)
    .single();

  if (error || !data) return null;
  return {
    id: data.id as string,
    slug: data.slug as string,
    title: data.title as string,
    sessionsTotal: data.sessions_total as number,
  };
}

async function fetchSession(courseId: string, sessionId: string): Promise<Session | null> {
  // Accept either a UUID or a slug
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sessionId);

  const query = supabase
    .from('course_sessions')
    .select('id, course_id, slug, title, body, audio_url, sort_order')
    .eq('course_id', courseId);

  const { data, error } = await (isUuid ? query.eq('id', sessionId) : query.eq('slug', sessionId)).single();

  if (error || !data) return null;
  return {
    id: data.id as string,
    courseId: data.course_id as string,
    slug: data.slug as string,
    title: data.title as string,
    body: data.body as string,
    audioUrl: (data.audio_url as string | null) ?? null,
    sortOrder: data.sort_order as number,
  };
}

async function fetchAdjacentSessions(courseId: string, sortOrder: number) {
  const [prevResult, nextResult] = await Promise.all([
    supabase
      .from('course_sessions')
      .select('id, slug, title, sort_order')
      .eq('course_id', courseId)
      .lt('sort_order', sortOrder)
      .order('sort_order', { ascending: false })
      .limit(1),
    supabase
      .from('course_sessions')
      .select('id, slug, title, sort_order')
      .eq('course_id', courseId)
      .gt('sort_order', sortOrder)
      .order('sort_order', { ascending: true })
      .limit(1),
  ]);

  return {
    prev: prevResult.data?.[0] ?? null,
    next: nextResult.data?.[0] ?? null,
  };
}

// ── Metadata ──────────────────────────────────────────────────────────────────

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { courseSlug, sessionId } = await params;
  const course = await fetchCourse(courseSlug);
  if (!course) return { title: 'Session not found' };

  const session = await fetchSession(course.id, sessionId);
  if (!session) return { title: 'Session not found' };

  return {
    title: `${session.title} — ${course.title}`,
    description: session.body.slice(0, 160),
  };
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function SessionPage({ params }: PageProps) {
  const { courseSlug, sessionId } = await params;

  const course = await fetchCourse(courseSlug);
  if (!course) notFound();

  const session = await fetchSession(course.id, sessionId);
  if (!session) notFound();

  const { prev, next } = await fetchAdjacentSessions(course.id, session.sortOrder);

  return (
    <main
      id="main-content"
      className="min-h-screen px-4 py-10"
      style={{ background: 'var(--bg)', color: 'var(--text)' }}
    >
      <div className="max-w-2xl mx-auto">
        {/* Breadcrumb */}
        <nav aria-label="Breadcrumb" className="mb-8">
          <ol className="flex items-center gap-1.5 text-sm" style={{ color: 'var(--text-muted)' }}>
            <li>
              <a
                href={`/courses/${course.slug}`}
                className="hover:underline transition-colors"
                style={{ color: 'var(--sage)' }}
              >
                {course.title}
              </a>
            </li>
            <li aria-hidden="true" style={{ color: 'var(--text-faint)' }}>
              /
            </li>
            <li aria-current="page">{session.title}</li>
          </ol>
        </nav>

        {/* Session header */}
        <header className="mb-6">
          <p
            className="text-xs font-medium uppercase tracking-widest mb-2"
            style={{ color: 'var(--sage)' }}
          >
            Session {session.sortOrder} of {course.sessionsTotal}
          </p>
          <h1 className="text-2xl font-semibold leading-snug" style={{ color: 'var(--text)' }}>
            {session.title}
          </h1>
        </header>

        {/* Client component handles audio player + completion state */}
        <SessionContent
          session={session}
          course={course}
          prev={
            prev
              ? { id: prev.id as string, slug: prev.slug as string, title: prev.title as string }
              : null
          }
          next={
            next
              ? { id: next.id as string, slug: next.slug as string, title: next.title as string }
              : null
          }
        />
      </div>
    </main>
  );
}
