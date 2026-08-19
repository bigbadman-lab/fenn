/**
 * Live-state capabilities Stage 12 may request from trusted tools — not RAG.
 * Stage 2: public fact capabilities (register, token, gatherings, chronicle)
 * are executable; personal leaf balances and identity Greenwood status are not.
 */

export const FENN_LIVE_CAPABILITIES = [
  "treasury",
  "commons",
  "deeds",
  "wall",
  "register",
  "greenwood",
  "token",
  "gatherings",
  "chronicle",
] as const;

export type FennLiveCapability = (typeof FENN_LIVE_CAPABILITIES)[number];

export type FennLiveCapabilityPolicy = {
  capability: FennLiveCapability;
  /** What public RAG / Canon may safely explain. */
  knowledgeMayExplain: string;
  /** What a trusted live tool/service must provide for current truth. */
  liveToolMustProvide: string;
};

/**
 * Explicit knowledge vs live-truth boundary for Stage 12.
 * RAG tells VELL what it knows. Trusted tools tell VELL what is true right now.
 */
export const FENN_LIVE_CAPABILITY_POLICIES: readonly FennLiveCapabilityPolicy[] =
  [
    {
      capability: "treasury",
      knowledgeMayExplain: "what Treasury means and its role in VELL",
      liveToolMustProvide: "current Treasury balance / observed treasury state",
    },
    {
      capability: "commons",
      knowledgeMayExplain: "what Commons means and how commitments work conceptually",
      liveToolMustProvide: "current Commons commitments / allocations",
    },
    {
      capability: "deeds",
      knowledgeMayExplain: "what Deeds are and how they work conceptually",
      liveToolMustProvide: "current live Deed status / window / reward",
    },
    {
      capability: "wall",
      knowledgeMayExplain: "what The Wall is and how marks/inscriptions work conceptually",
      liveToolMustProvide:
        "current inscriptions, mark counts, and writes via trusted Wall services",
    },
    {
      capability: "register",
      knowledgeMayExplain: "what the Outlaw Register and Greenwood membership mean",
      liveToolMustProvide:
        "confirmed Outlaw count and Greenwood member count (public aggregates)",
    },
    {
      capability: "greenwood",
      knowledgeMayExplain: "what Greenwood is and how admission works conceptually",
      liveToolMustProvide:
        "configured public lifetime LEAF threshold (not personal balances or membership of a named person)",
    },
    {
      capability: "token",
      knowledgeMayExplain: "what $VELL is conceptually",
      liveToolMustProvide:
        "official public token contract definition when configured",
    },
    {
      capability: "gatherings",
      knowledgeMayExplain: "what Gatherings are",
      liveToolMustProvide: "current public Gathering call signal (no private attendance)",
    },
    {
      capability: "chronicle",
      knowledgeMayExplain: "what the Chronicle / Living Book is",
      liveToolMustProvide: "latest public Chronicle entry summary",
    },
  ] as const;

/** Short policy line for public-agent prompts / contracts. */
export const FENN_PUBLIC_AGENT_LIVE_STATE_RULE =
  "Current mutable state (Treasury, Commons, Register counts, LEAF threshold config, Deed windows, Wall counts, Gatherings, official token, Chronicle) must come from trusted live tools — never from knowledge retrieval alone. Never answer personal LEAF balance or personal Greenwood membership from X alone.";
