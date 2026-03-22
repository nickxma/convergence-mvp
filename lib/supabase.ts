import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  // Warn at module load time so it surfaces in server logs before any request.
  console.warn('[supabase] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set');
}

// Service role client — bypasses RLS. Only used server-side in API routes.
export const supabase = createClient(url ?? '', key ?? '', {
  auth: { persistSession: false },
});
