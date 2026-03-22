import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

/**
 * GET /api/courses
 *
 * Returns the public course catalog, sorted by sort_order.
 * Courses are publicly readable; access locking is enforced client-side.
 */
export async function GET() {
  const { data, error } = await supabase
    .from('courses')
    .select('id, slug, title, description, sessions_total, is_free, sort_order')
    .order('sort_order', { ascending: true });

  if (error) {
    console.error('[/api/courses] supabase error:', error.message);
    return NextResponse.json({ error: 'Failed to load courses' }, { status: 500 });
  }

  const courses = (data ?? []).map((row) => ({
    id: row.id as string,
    slug: row.slug as string,
    title: row.title as string,
    description: row.description as string,
    sessionsTotal: row.sessions_total as number,
    isFree: row.is_free as boolean,
    sortOrder: row.sort_order as number,
  }));

  return NextResponse.json({ courses });
}
