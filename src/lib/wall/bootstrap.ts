/**
 * Trusted ops helpers for intentional Wall bootstrap inscriptions.
 * Not invoked by application boot / product UI.
 */

/** Approved Stage 10.5.4 founding inscription body. */
export const FOUNDING_WALL_INSCRIPTION_BODY =
  "this wall was here before the road.\n\ni only recently learned how to write on it.";

/** Optional provenance for a one-time founding write (idempotent if reused). */
export const FOUNDING_WALL_SOURCE_EXTERNAL_ID = "founding:stage105" as const;

/**
 * Input for writeFennWallEntry when ops intentionally seeds the founding line.
 * Call only from trusted server/ops — never from browser or product routes.
 */
export function foundingWallWriteInput(): {
  body: string;
  sourceType: "bootstrap";
  sourceExternalId: typeof FOUNDING_WALL_SOURCE_EXTERNAL_ID;
} {
  return {
    body: FOUNDING_WALL_INSCRIPTION_BODY,
    sourceType: "bootstrap",
    sourceExternalId: FOUNDING_WALL_SOURCE_EXTERNAL_ID,
  };
}
