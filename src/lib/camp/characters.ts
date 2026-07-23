import "server-only";

import { CampAiError } from "@/lib/camp/errors";
import {
  listCampCharacterConfigs,
  resolveCampCharacterByPromptKey,
} from "@/lib/camp/prompts";
import type { CampCharacterConfig, CampCharacterSlug } from "@/lib/camp/types";

/**
 * Resolve server character config from DB prompt_key (or slug).
 * Unknown keys fail closed.
 */
export function getCampCharacterConfig(
  promptKeyOrSlug: string,
): CampCharacterConfig {
  try {
    return resolveCampCharacterByPromptKey(promptKeyOrSlug);
  } catch {
    throw new CampAiError(
      "camp_character_unknown",
      "Unknown Camp character",
      404,
    );
  }
}

export function getAllCampCharacterConfigs(): CampCharacterConfig[] {
  return listCampCharacterConfigs();
}

export function isCampCharacterSlug(value: string): value is CampCharacterSlug {
  return value === "fenn" || value === "wren" || value === "rook";
}
