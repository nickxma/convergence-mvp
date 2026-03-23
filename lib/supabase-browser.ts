/**
 * Browser-side Supabase client.
 *
 * Uses the anon key (safe to expose) for client-side operations such as
 * Supabase Realtime broadcast channels. Server-side code should continue
 * to use the service-role client in lib/supabase.ts.
 *
 * Required env vars (NEXT_PUBLIC_ prefix so they're bundled):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY
 */
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

let _client: ReturnType<typeof createClient> | null = null;

export function getSupabaseBrowser() {
  if (!url || !anonKey) return null;
  if (!_client) {
    _client = createClient(url, anonKey, {
      auth: { persistSession: false },
      realtime: { params: { eventsPerSecond: 10 } },
    });
  }
  return _client;
}
