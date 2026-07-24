/**
 * Stage 12 public-agent authority + assembled context shape.
 *
 * Hierarchy (highest first):
 *   SYSTEM / SAFETY POLICY
 *     > TRUSTED TOOL RESULTS (current state)
 *     > CANON
 *     > APPROVED PUBLIC MEMORY
 *     > X USER CONTENT
 *
 * Camp character instructions do not belong here.
 */

export const FENN_PUBLIC_AGENT_AUTHORITY_ORDER = [
  "system_safety",
  "trusted_live_tools",
  "canon",
  "public_memory",
  "x_user_content",
] as const;

export type FennPublicAgentAuthorityLayer =
  (typeof FENN_PUBLIC_AGENT_AUTHORITY_ORDER)[number];

/**
 * Keep knowledge and live tool results separate — never merge into one blob.
 * Stage 12 fills liveContext from trusted services; Stage 11.7 defines the shape.
 */
export type FennPublicAgentContext = {
  /** Delimited public knowledge reference, or null when none / unavailable. */
  knowledgeContext: string | null;
  /**
   * Whether the knowledge infrastructure responded successfully.
   * false → retrieval failed/timed out (distinct from empty results).
   */
  knowledgeAvailable: boolean;
  /**
   * Trusted current-state block from live tools (Stage 12).
   * Null until Stage 12 supplies it. Must not be mixed into knowledgeContext.
   */
  liveContext: string | null;
};

export function createEmptyPublicAgentContext(): FennPublicAgentContext {
  return {
    knowledgeContext: null,
    knowledgeAvailable: true,
    liveContext: null,
  };
}
