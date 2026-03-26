import { Suspense } from 'react';
import type { Metadata } from 'next';
import { supabase } from '@/lib/supabase';
import { AskPageClient } from './ask-page-client';

interface PageProps {
  searchParams: Promise<{ essay?: string; course?: string }>;
}

export const metadata: Metadata = {
  title: 'Ask',
  description: 'Ask any question about mindfulness, meditation, or contemplative practice. Get answers grounded in hundreds of hours of teachings from leading mindfulness teachers.',
  openGraph: {
    title: 'Ask — Convergence',
    description: 'Ask any question about mindfulness, meditation, or contemplative practice. Get answers grounded in hundreds of hours of teachings from leading mindfulness teachers.',
    type: 'website',
  },
};

async function fetchSessionTitle(courseSlug: string, sessionSlug: string): Promise<string | null> {
  try {
    const { data: course } = await supabase
      .from('courses')
      .select('id')
      .eq('slug', courseSlug)
      .single();

    if (!course) return null;

    const { data: session } = await supabase
      .from('course_sessions')
      .select('title')
      .eq('course_id', course.id as string)
      .eq('slug', sessionSlug)
      .single();

    return (session?.title as string) ?? null;
  } catch {
    return null;
  }
}

export default async function AskPage({ searchParams }: PageProps) {
  const { essay: essaySlug, course: courseSlug } = await searchParams;

  let essayContext: { title: string; courseSlug: string; sessionSlug: string } | null = null;
  if (essaySlug && courseSlug) {
    const title = await fetchSessionTitle(courseSlug, essaySlug);
    if (title) {
      essayContext = { title, courseSlug, sessionSlug: essaySlug };
    }
  }

  return (
    <Suspense>
      <AskPageClient essayContext={essayContext} />
    </Suspense>
  );
}
