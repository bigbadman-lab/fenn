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
  "choose from STAGE12_AGENT_ACTIONS",
  "form and persist Stage 12.3 intentions without executing them",
  "authorise final intentions into pending consequence plans (Stage 12.5)",
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
  "create Memory or Canon from X perceptions or judgement candidates",
  "let the model control reply target, idempotency keys, or Wall provenance",
  "execute authorised effects in Stage 12.5 (pending only; Stage 12.6 executes)",
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
