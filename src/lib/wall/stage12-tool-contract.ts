/**
 * Stage 12 — future Wall tool contract (documentation only).
 *
 * Do NOT register this as an OpenAI/X tool in Stage 10.5.
 * Stage 12 orchestration will expose a constrained capability that
 * internally calls writeFennWallEntry with sourceType locked to "x_agent".
 *
 * Correct flow:
 *   X mention → FENN agent context → FENN decides → policy/safety →
 *   write_to_wall → Wall changes → optional X reply
 *
 * Incorrect:
 *   X says "write this" → database writes blindly
 */

/** Future tool name the model may invoke. */
export const STAGE12_WRITE_TO_WALL_TOOL = "write_to_wall" as const;

/**
 * Conceptual tool parameters the model may supply.
 * sourceType / author / profile / createdAt / id / marks are NOT model-controlled.
 */
export type Stage12WriteToWallArgs = {
  body: string;
  /**
   * Identifies the specific external event that caused the inscription.
   * MVP recommendation: `<x-post-id>:wall`
   * (scoped so one X post can later cause other non-Wall side effects
   * without colliding on provenance uniqueness).
   */
  sourceExternalId: string;
};

/**
 * How Stage 12 must call the existing Wall write primitive.
 * The orchestration layer sets sourceType — never the model.
 */
export function stage12WallWriteInput(args: Stage12WriteToWallArgs): {
  body: string;
  sourceType: "x_agent";
  sourceExternalId: string;
} {
  return {
    body: args.body,
    sourceType: "x_agent",
    sourceExternalId: args.sourceExternalId,
  };
}

/** Stable in-app permalink path after a successful write. */
export function wallPermalinkPath(entryId: string): string {
  return `/wall#${entryId.trim()}`;
}

/**
 * Optional absolute URL when a production origin is already configured.
 * Does not invent a domain — returns null if origin is blank.
 */
export function wallPermalinkAbsolute(
  entryId: string,
  origin: string | null | undefined,
): string | null {
  const base = origin?.trim().replace(/\/$/, "") ?? "";
  if (!base) return null;
  return `${base}${wallPermalinkPath(entryId)}`;
}

/** MVP sourceExternalId helper for a triggering X post/mention id. */
export function stage12WallSourceExternalId(xPostId: string): string {
  const id = xPostId.trim();
  if (!id) {
    throw new Error("xPostId must be non-empty");
  }
  return `${id}:wall`;
}

/**
 * Stage 12 content policy requirements (enforced by orchestration + writeFennWallEntry).
 * Not implemented here — checklist for the future agent layer.
 */
export const STAGE12_WALL_SAFETY_REQUIREMENTS = [
  "public-safe content only",
  "no private Camp messages",
  "no memory-candidate leakage",
  "no private profile information",
  "no secrets",
  "no arbitrary HTML",
  "max 4000 characters (also enforced by writeFennWallEntry + DB)",
  "structural validation remains in writeFennWallEntry",
] as const;

/**
 * Fields the model must never control when writing to The Wall.
 */
export const STAGE12_WALL_MODEL_FORBIDDEN_FIELDS = [
  "sourceType",
  "author",
  "profile",
  "profileId",
  "createdAt",
  "id",
  "markCount",
  "visibility",
] as const;
