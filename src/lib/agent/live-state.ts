/**
 * Live-state capabilities Stage 12 must obtain from trusted tools — not RAG.
 */

export const FENN_LIVE_CAPABILITIES = [
  "treasury",
  "commons",
  "ledger",
  "deeds",
  "greenwood",
  "leaf",
  "wall",
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
 * RAG tells FENN what it knows. Trusted tools tell FENN what is true right now.
 */
export const FENN_LIVE_CAPABILITY_POLICIES: readonly FennLiveCapabilityPolicy[] =
  [
    {
      capability: "treasury",
      knowledgeMayExplain: "what Treasury means and its role in FENN",
      liveToolMustProvide: "current Treasury balance / observed treasury state",
    },
    {
      capability: "commons",
      knowledgeMayExplain: "what Commons means and how commitments work conceptually",
      liveToolMustProvide: "current Commons commitments / allocations",
    },
    {
      capability: "ledger",
      knowledgeMayExplain:
        "what Ledger and Circulation are and how they differ conceptually",
      liveToolMustProvide:
        "current or recent actual movement records when Stage 12 needs them",
    },
    {
      capability: "leaf",
      knowledgeMayExplain: "what LEAF is (contribution / standing unit — not a live balance)",
      liveToolMustProvide: "current LEAF balance / standing when the agent is allowed access",
    },
    {
      capability: "greenwood",
      knowledgeMayExplain:
        "what Greenwood is and how membership works conceptually",
      liveToolMustProvide: "current specific membership / eligibility",
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
  ] as const;

/** Short policy line for public-agent prompts / contracts. */
export const FENN_PUBLIC_AGENT_LIVE_STATE_RULE =
  "Current mutable state (Treasury, Commons, LEAF, Greenwood membership, Deed windows, Wall counts, Ledger/Circulation totals) must come from trusted live tools — never from knowledge retrieval alone.";
