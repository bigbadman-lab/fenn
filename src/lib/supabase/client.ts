import { createBrowserClient } from "@supabase/ssr";

import { publicEnv } from "@/lib/env/public";

/**
 * Browser Supabase client.
 * Uses the anon key only. No queries in Stage 1.
 */
export function createClient() {
  return createBrowserClient(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}
