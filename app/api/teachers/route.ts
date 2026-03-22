import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// Fallback list if concept_teachers table is empty or query fails
const FALLBACK_TEACHERS = ['Adyashanti', 'Sam Harris', 'Shinzen Young'];

export async function GET() {
  try {
    const { data, error } = await supabase
      .from('concept_teachers')
      .select('teacher_name, chunk_count')
      .order('chunk_count', { ascending: false });

    if (error || !data || data.length === 0) {
      return NextResponse.json({ teachers: FALLBACK_TEACHERS });
    }

    // Deduplicate and return in chunk_count order (most content first)
    const seen = new Set<string>();
    const teachers: string[] = [];
    for (const row of data) {
      if (row.teacher_name && !seen.has(row.teacher_name)) {
        seen.add(row.teacher_name);
        teachers.push(row.teacher_name);
      }
    }

    return NextResponse.json({ teachers: teachers.length > 0 ? teachers : FALLBACK_TEACHERS });
  } catch {
    return NextResponse.json({ teachers: FALLBACK_TEACHERS });
  }
}
