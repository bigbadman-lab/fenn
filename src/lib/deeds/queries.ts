import "server-only";

import { createClient } from "@supabase/supabase-js";

import { isDeedPubliclyListable, toSafeDeed } from "@/lib/deeds/rules";
import type { DeedRow, SafeDeed } from "@/lib/deeds/types";
import { publicEnv } from "@/lib/env/public";

const DEED_PUBLIC_SELECT =
  "id, slug, title, lore_description, instructions, category, access_scope, status, reward_leaf_fixed, reward_leaf_min, reward_leaf_max, evidence_requirements, starts_at, ends_at, max_completions, completions_count, is_public, is_repeatable, sponsor_name, external_reward_note, published_at";

/**
 * Anon-key client so RLS `deeds_public_select` remains authoritative.
 * Only rows with status=active AND is_public=true are visible.
 *
 * Limitation: closed Deeds are not readable via this path (RLS). Preserve that
 * for Stage 6.1 — do not weaken RLS for historical closed-detail UX.
 */
function createPublicDeedsClient() {
  return createClient(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    },
  );
}

function applyListabilityWindow(deeds: SafeDeed[], now: Date): SafeDeed[] {
  return deeds.filter((deed) => isDeedPubliclyListable(deed, now).listable);
}

/**
 * List Deeds eligible for public listing.
 * Relies on RLS (active+public) then applies starts_at / ends_at window.
 */
export async function listPublicDeeds(
  now: Date = new Date(),
): Promise<SafeDeed[]> {
  const client = createPublicDeedsClient();
  const { data, error } = await client
    .from("deeds")
    .select(DEED_PUBLIC_SELECT)
    .order("published_at", { ascending: false, nullsFirst: false });

  if (error) {
    throw new Error(`Failed to list public deeds: ${error.message}`);
  }

  const rows = (data ?? []) as DeedRow[];
  return applyListabilityWindow(rows.map(toSafeDeed), now);
}

/**
 * Fetch a single public Deed by slug.
 *
 * Under current RLS, only active+public rows are returned — closed / draft /
 * archived / non-public deeds resolve to null (closed-detail UX needs a later
 * policy/schema decision; do not weaken RLS here).
 *
 * Also applies the public time window (starts_at / ends_at).
 */
export async function getPublicDeedBySlug(
  slug: string,
  now: Date = new Date(),
): Promise<SafeDeed | null> {
  const trimmed = slug.trim();
  if (!trimmed) return null;

  const client = createPublicDeedsClient();
  const { data, error } = await client
    .from("deeds")
    .select(DEED_PUBLIC_SELECT)
    .eq("slug", trimmed)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load public deed by slug: ${error.message}`);
  }

  if (!data) return null;

  const deed = toSafeDeed(data as DeedRow);
  if (!isDeedPubliclyListable(deed, now).listable) {
    return null;
  }
  return deed;
}
