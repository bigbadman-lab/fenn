/**
 * Privileged Supabase client for trusted server modules only.
 * Bypasses RLS. Never import from Client Components.
 *
 * Reads URL + service role from process.env only.
 * Does NOT require full publicEnv (SITE_URL / Privy) — those remain for
 * product surfaces. Ops crons (purse:settle, market-watch) only need Supabase.
 */
import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function requireProcessEnv(name: string): string {
  const value = process.env[name];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(
      `Supabase admin client missing required environment variable: ${name}`,
    );
  }
  return value.trim();
}

/**
 * Privileged Supabase client for trusted server modules only.
 * Bypasses RLS. Never import from Client Components.
 */
export function createAdminClient(): SupabaseClient {
  const url = requireProcessEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = requireProcessEnv("SUPABASE_SERVICE_ROLE_KEY");

  return createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
