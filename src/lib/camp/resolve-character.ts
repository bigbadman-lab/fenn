import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { getCampCharacterConfig } from "@/lib/camp/characters";
import type { CampCharacterRow } from "@/lib/camp/dto";
import { CampAiError } from "@/lib/camp/errors";
import { isCampCharacterSlugParam } from "@/lib/camp/hash";
import type { CampCharacterConfig, CampCharacterSlug } from "@/lib/camp/types";

export type ResolvedCampCharacter = {
  row: CampCharacterRow;
  slug: CampCharacterSlug;
  config: CampCharacterConfig;
};

async function defaultAdmin(): Promise<SupabaseClient> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return createAdminClient();
}

/**
 * Load active, unlocked DB character and bind to Stage 7.1 server prompts.
 * Fail closed on inactive / locked / prompt_key mismatch.
 */
export async function resolveConversationalCampCharacter(
  slugRaw: string,
  admin?: SupabaseClient,
): Promise<ResolvedCampCharacter> {
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

  const row = data as CampCharacterRow;
  if (!row.is_active) {
    throw new CampAiError(
      "camp_character_inactive",
      "Character is inactive",
      403,
    );
  }
  if (row.is_locked) {
    throw new CampAiError(
      "camp_character_locked",
      "Character is locked",
      403,
    );
  }

  const promptKey = (row.prompt_key ?? "").trim();
  if (!promptKey) {
    throw new CampAiError(
      "camp_character_misconfigured",
      "Character prompt is missing",
      500,
    );
  }

  let config: CampCharacterConfig;
  try {
    config = getCampCharacterConfig(promptKey);
  } catch {
    throw new CampAiError(
      "camp_character_misconfigured",
      "Character prompt is unknown",
      500,
    );
  }

  if (config.slug !== slug) {
    throw new CampAiError(
      "camp_character_misconfigured",
      "Character prompt mismatch",
      500,
    );
  }

  return { row, slug, config };
}
