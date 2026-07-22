import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { publicEnv } from "@/lib/env/public";

/**
 * Server Supabase client for Server Components, Route Handlers, and Server Actions.
 * Uses the anon key with request cookies. No queries in Stage 1.
 * No auth middleware/proxy in Stage 1 — wallet identity arrives with Privy in Stage 3.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // Called from a Server Component where cookies cannot be set.
            // Harmless in Stage 1 with no Supabase Auth session refresh.
          }
        },
      },
    },
  );
}
