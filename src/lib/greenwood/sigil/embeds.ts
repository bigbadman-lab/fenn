/**
 * PostgREST relationship hints for greenwood_sigil_assignments → catalogue.
 *
 * Assignments have two FKs onto the catalogue table: sigil_id and
 * previous_sigil_id. Unqualified embeds are ambiguous (PGRST201).
 *
 * Select strings are string literals so the Supabase typed client can parse them.
 */

/** Current mark — always prefer this for member/Fire/Desk display. */
export const CURRENT_SIGIL_CATALOGUE_RELATION =
  "greenwood_sigil_catalogue!sigil_id" as const;

/** Historical/replaced mark — use only when intentionally reading previous. */
export const PREVIOUS_SIGIL_CATALOGUE_RELATION =
  "greenwood_sigil_catalogue!previous_sigil_id" as const;

export function currentSigilCatalogueEmbed(columns: string): string {
  return `${CURRENT_SIGIL_CATALOGUE_RELATION} ( ${columns} )`;
}

export function previousSigilCatalogueEmbed(columns: string): string {
  return `${PREVIOUS_SIGIL_CATALOGUE_RELATION} ( ${columns} )`;
}

/** getProfileSigil — current mark fields. */
export const PROFILE_CURRENT_SIGIL_SELECT =
  "sigil_id, greenwood_sigil_catalogue!sigil_id ( slug, ascii_body, a11y_label, width, height, is_fallback )" as const;

/** Fire presence / full SafeGreenwoodSigil. */
export const PRESENCE_CURRENT_SIGIL_SELECT =
  "profile_id, greenwood_sigil_catalogue!sigil_id ( slug, ascii_body, a11y_label, width, height, is_fallback )" as const;

/** Desk Fire / Gatherings / Deeds mark preview. */
export const DESK_CURRENT_SIGIL_MARK_SELECT =
  "profile_id, greenwood_sigil_catalogue!sigil_id ( ascii_body, a11y_label )" as const;

/** Desk Register mark with slug. */
export const DESK_CURRENT_SIGIL_SLUG_SELECT =
  "profile_id, greenwood_sigil_catalogue!sigil_id ( slug, ascii_body, a11y_label )" as const;
