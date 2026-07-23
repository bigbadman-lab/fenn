import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { CampCharacterRow } from "@/lib/camp/dto";
import { CampAiError } from "@/lib/camp/errors";
import { isCampCharacterSlugParam } from "@/lib/camp/hash";
import type { CampCharacterSlug } from "@/lib/camp/types";

async function defaultAdmin(): Promise<SupabaseClient> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return createAdminClient();
}

/**
 * Load character identity for history reads.
 * Allows locked/inactive characters so prior conversations remain readable.
 * Does not bind prompt config (send path uses resolveConversationalCampCharacter).
 */
export async function resolveCampCharacterForHistory(
  slugRaw: string,
  admin?: SupabaseClient,
): Promise<{ row: CampCharacterRow; slug: CampCharacterSlug }> {
  const db = admin ?? (await defaultAdmin());
  const slug = slugRaw.trim().toLowerCase();
  if (!isCampCharacterSlugParam(slug)) {
    throw new CampAiError(
      "camp_character_not_found",
      "Unknown Camp character",
      404,
    );
  }

  const { data, error } = await db
    .from("camp_characters")
    .select("id, slug, display_name, prompt_key, is_active, is_locked")
    .eq("slug", slug)
    .maybeSingle();

  if (error) {
    throw new CampAiError("camp_write_failed", "Failed to load character", 500);
  }
  if (!data) {
    throw new CampAiError(
      "camp_character_not_found",
      "Unknown Camp character",
      404,
    );
  }

  return { row: data as CampCharacterRow, slug };
}
