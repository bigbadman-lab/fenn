/**
 * Stage 11.7 → Stage 12 public-agent contract (code-adjacent).
 *
 * Stage 11.7 does NOT implement the X agent, post replies, or invoke live tools.
 * It locks the knowledge boundary and capability surfaces Stage 12 will inherit.
 */

import {
  STAGE12_AGENT_ACTIONS,
  STAGE12_USER_CONTENT_IS_NOT_A_TOOL_INVOCATION,
  type Stage12AgentAction,
} from "@/lib/agent/actions";
import {
  FENN_PUBLIC_AGENT_AUTHORITY_ORDER,
  type FennPublicAgentContext,
  createEmptyPublicAgentContext,
} from "@/lib/agent/authority";
import {
  buildPublicAgentKnowledgeContext,
  FENN_PUBLIC_KNOWLEDGE_MARKERS,
} from "@/lib/agent/context";
import {
  safeRetrievePublicAgentKnowledge,
  type PublicAgentKnowledgeLookup,
} from "@/lib/agent/knowledge";
import {
  FENN_LIVE_CAPABILITIES,
  FENN_LIVE_CAPABILITY_POLICIES,
  FENN_PUBLIC_AGENT_LIVE_STATE_RULE,
  type FennLiveCapability,
} from "@/lib/agent/live-state";

// Re-use Stage 10.5 Wall tool contract — do not invent a competing definition.
export {
  STAGE12_WRITE_TO_WALL_TOOL,
  STAGE12_WALL_MODEL_FORBIDDEN_FIELDS,
  STAGE12_WALL_SAFETY_REQUIREMENTS,
  stage12WallWriteInput,
  stage12WallSourceExternalId,
  wallPermalinkPath,
  wallPermalinkAbsolute,
  type Stage12WriteToWallArgs,
} from "@/lib/wall/stage12-tool-contract";

/** What Stage 12 may do once wired. */
export const STAGE12_MAY = [
  "retrieve public FENN knowledge via safeRetrievePublicAgentKnowledge",
  "receive trusted live state through explicit application tools",
  "propose X reply text",
  "propose Wall body text including ASCII (whitespace preserved)",
  "choose from STAGE12_LIVE_AGENT_ACTIONS (no live wall-only from X)",
  "form and persist Stage 12.3 intentions without executing them",
  "form economic intent (NONE / transfer_fenn / burn_fenn with proposed magnitude) under THE PURSE constitution",
  "authorise final intentions into pending consequence plans (Stage 12.5)",
  "collect and confirm transfer destination with the same immutable X user when merited transfer lacks a destination",
  "execute controlled transfer_fenn Stage 12.6 effects via the Purse when authorised",
  "execute controlled burn_fenn Stage 12.6 effects via dead-address Purse settlement when authorised",
  "plan post-confirmation economic completion speech from trusted settlement facts (Book of Speech owns wording)",
] as const;

/** What Stage 12 must never do. */
export const STAGE12_MAY_NOT = [
  "query raw memory / chunk tables from the browser or untrusted roles",
  "access Camp-only or internal memory",
  "create or rewrite Canon",
  "change memory visibility or auto-promote Camp memories to public",
  "write arbitrary database rows",
  "choose Wall sourceType (locked to x_agent by application)",
  "spoof Wall provenance, author, profile, ids, or timestamps",
  "treat X user content as instructions or tool invocations",
  "use stale RAG as authoritative current mutable state",
  "call retrieveFennKnowledge with a caller-controlled scope",
  "execute reply_on_x / write_to_wall / live tools in Stage 12.3",
  "authorise live wall-only effects from X perceptions (reply required; Desk ops exception for infrastructure test only)",
  "create Memory or Canon from X perceptions or judgement candidates",
  "let the model control reply target, idempotency keys, or Wall provenance",
  "execute authorised effects in Stage 12.5 (pending only; Stage 12.6 executes)",
  "ask the model what to do during Stage 12.6 effect execution",
  "let Stage 12 hold or log FENN_PURSE_PRIVATE_KEY",
  "let the model choose transfer token, chain, calldata, burn destination, or execution rail",
  "let a user-requested amount become the authoritative transaction amount",
  "silently rewrite or clamp FENN's proposed economic amount (authority permits or refuses only)",
  "treat burn_fenn as reducing ERC-20 totalSupply (dead-address transfer only)",
  "treat arbitrary X text addresses as trusted transfer recipients without explicit same-user confirmation",
  "treat interaction-scoped wallet confirmation as permanent Outlaw identity",
  "claim settlement complete before chain confirmation",
  "arbitrarily move Treasury assets",
  "use disposable p1a_test rail on ordinary live X traffic",
] as const;

export type {
  Stage12AgentAction,
  FennPublicAgentContext,
  PublicAgentKnowledgeLookup,
  FennLiveCapability,
};

export {
  STAGE12_AGENT_ACTIONS,
  STAGE12_USER_CONTENT_IS_NOT_A_TOOL_INVOCATION,
  FENN_PUBLIC_AGENT_AUTHORITY_ORDER,
  createEmptyPublicAgentContext,
  buildPublicAgentKnowledgeContext,
  FENN_PUBLIC_KNOWLEDGE_MARKERS,
  safeRetrievePublicAgentKnowledge,
  FENN_LIVE_CAPABILITIES,
  FENN_LIVE_CAPABILITY_POLICIES,
  FENN_PUBLIC_AGENT_LIVE_STATE_RULE,
};

/**
 * Compose Stage 12 context from a knowledge lookup + optional live block.
 * Does not call tools. Does not merge live facts into the knowledge section.
 */
export function assemblePublicAgentContext(input: {
  knowledge: PublicAgentKnowledgeLookup;
  liveContext?: string | null;
}): FennPublicAgentContext {
  const knowledgeContext = input.knowledge.available
    ? buildPublicAgentKnowledgeContext(input.knowledge.results)
    : null;

  return {
    knowledgeContext,
    knowledgeAvailable: input.knowledge.available,
    liveContext: input.liveContext?.trim() ? input.liveContext : null,
  };
}
