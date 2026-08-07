import type {
  EditorialApprovalState,
  EditorialCategory,
  EditorialConfidence,
  EditorialMode,
} from "@/lib/editorial/categories";

/** Version strings stored on each run for audit replay. */
export const EDITORIAL_PROMPT_VERSION = "editorial-prompt-v2.1";
export const EDITORIAL_GENERATOR_VERSION = "editorial-generator-v2.1";

export const EDITORIAL_OPENAI_MODEL = "gpt-4o-mini";
export const EDITORIAL_PACKAGE_MAX_COMPLETION_TOKENS = 16_000;
export const EDITORIAL_SINGLE_MAX_COMPLETION_TOKENS = 1_200;
export const EDITORIAL_RECOVERY_MAX_COMPLETION_TOKENS = 8_000;

/** Hard caps for context pack assembly. */
export const EDITORIAL_CONTEXT_CAPS = {
  newsroomHeadlines: 8,
  notableActivity: 6,
  recentEditorialWriting: 12,
  otherRecentWriting: 12,
  wallSamples: 4,
  deeds: 4,
  chronicle: 3,
  speaks: 3,
  xReplies: 4,
  snippetChars: 160,
  detailChars: 200,
  headlineChars: 120,
} as const;

/** Operator-safe daily world overview shown at the top of The Editorial Room. */
export type EditorialDailyOverview = {
  coveredDate: string;
  bookWritten: boolean;
  fireWaitingCount: number;
  gatheringLabel: string;
  newOutlaws: number;
  newDeedsApproved: number;
  greenwoodArrivals: number;
  wallMarks: number;
  treasuryLabel: string;
  robinhoodLabel: string;
  campMessages: number;
  leafRecognitionEvents: number;
  quiet: boolean;
  /** Compact TODAY IN THE WOOD headlines (v2). */
  newsroomHeadlines?: string[];
  liveSurfaces?: string[];
  generatedAt?: string;
};

/** Trusted factual day-count context (legacy shape for validators + signals). */
export type EditorialWorldContext = {
  coveredDate: string;
  book: {
    written: boolean;
    title: string | null;
    preview: string | null;
  };
  fireWaitingCount: number;
  gathering: {
    activeTitle: string | null;
    stateLabel: string;
  };
  newOutlaws: number;
  deedSubmissionsApproved: number;
  deedsCreated: number;
  greenwoodAdmissions: number;
  wallInscriptions: number;
  campMessages: number;
  campLeafRecognised: number;
  leafRecognisedTotal: number;
  leafRecognitionEvents: number;
  fennXReplies: number;
  fennWallWrites: number;
  commonsAllocationEvents: number;
  commonsState: string;
  treasuryState: string;
  quiet: boolean;
  /** Flat signal keys for sourceSignals validation. */
  signalKeys: string[];
  /** Official token contract if configured (for invented-address checks). */
  officialContractAddress?: string | null;
};

/** Ecosystem awareness — not news generation. */
export type EditorialRobinhoodContext = {
  hasTrustedSignals: boolean;
  lines: string[];
  caution: "summarise only; never invent announcements or partnerships";
};

/** Brief stored on the run (JSON). v2 carries Keeper intent, not slogan themes. */
export type EditorialBrief = {
  /** Compact notes / newsroom headlines for audit — not marketing slogans. */
  themes: string[];
  avoid: string[];
  whatMattersToday?: string | null;
  recoveryUsed?: boolean;
};

export type EditorialNewsroomItemType =
  | "chronicle"
  | "wall"
  | "deed"
  | "speaks"
  | "gathering"
  | "leaf"
  | "x_agent"
  | "commons"
  | "treasury"
  | "token"
  | "register"
  | "greenwood"
  | "camp"
  | "clearing"
  | "day";

export type EditorialNewsroomItem = {
  type: EditorialNewsroomItemType;
  occurredAt: string | null;
  headline: string;
  detail: string | null;
  sourceId: string | null;
  /** 1 = today/highest, 2 = 24h, 3 = 72h, 4 = active state. */
  priority: 1 | 2 | 3 | 4;
};

export type EditorialRecentWritingSnippet = {
  source: "editorial" | "chronicle" | "wall" | "speaks" | "x_agent";
  text: string;
  createdAt: string | null;
};

export type EditorialProtectedFacts = {
  coveredDate: string;
  officialToken: {
    symbol: string;
    chainId: number;
    contractAddress: string;
    explorerUrl: string;
  } | null;
  greenwoodLeafThreshold: number | null;
  outlawCount: number | null;
  greenwoodMemberCount: number | null;
  activeGathering: {
    active: boolean;
    title: string | null;
    stateLabel: string;
  };
  treasuryState: string;
  commonsState: string;
  dayCounts: {
    newOutlaws: number;
    deedSubmissionsApproved: number;
    deedsCreated: number;
    greenwoodAdmissions: number;
    wallInscriptions: number;
    campMessages: number;
    leafRecognitionEvents: number;
    leafRecognisedTotal: number;
    fennXReplies: number;
    fennWallWrites: number;
    commonsAllocationEvents: number;
    fireWaitingCount: number;
  };
  bookWrittenToday: boolean;
  bookTitle: string | null;
  quietDay: boolean;
};

export type EditorialWorldState = {
  liveSurfaces: string[];
  registerNote: string | null;
  greenwoodNote: string | null;
  campNote: string | null;
  clearingNote: string | null;
  wallNote: string | null;
  deedsNote: string | null;
  chronicleNote: string | null;
  commonsNote: string | null;
  ledgerNote: string | null;
  speaksNote: string | null;
  gatheringNote: string | null;
  xAgentNote: string | null;
  tokenNote: string | null;
  treasuryNote: string | null;
};

export type EditorialFocus = {
  whatMattersToday: string | null;
};

/** Full newsroom context pack for generation (never includes private data). */
export type EditorialContextPack = {
  generatedAt: string;
  coveredDate: string;
  newsroom: {
    headlines: EditorialNewsroomItem[];
    notableActivity: EditorialNewsroomItem[];
    quiet: boolean;
  };
  worldState: EditorialWorldState;
  protectedFacts: EditorialProtectedFacts;
  recentWriting: EditorialRecentWritingSnippet[];
  editorialFocus: EditorialFocus;
  /** Day aggregates + signal keys (validators + sourceSignals). */
  world: EditorialWorldContext;
  robinhood: EditorialRobinhoodContext;
};

export type EditorialDraftTransmission = {
  category: EditorialCategory;
  mode: EditorialMode;
  title: string;
  body: string;
  operatorRationale: string;
  sourceSignals: string[];
  confidence: EditorialConfidence;
  /** True only when draft draws on newsroom/protected facts. */
  grounded: boolean;
};

export type EditorialGeneratedPackage = {
  brief: EditorialBrief;
  transmissions: EditorialDraftTransmission[];
  recoveryUsed: boolean;
};

export type SafeEditorialTransmission = {
  id: string;
  runId: string;
  slotIndex: number;
  category: EditorialCategory;
  categoryLabel: string;
  mode: EditorialMode | null;
  modeLabel: string | null;
  grounded: boolean;
  title: string;
  /** Effective body for copy/post preview (edited_body ?? body). */
  body: string;
  originalBody: string;
  editedBody: string | null;
  operatorRationale: string;
  sourceSignals: string[];
  confidence: EditorialConfidence;
  approvalState: EditorialApprovalState;
  copyCount: number;
  updatedAt: string;
};

export type SafeEditorialRun = {
  id: string;
  coveredDate: string;
  status: "ready" | "archived";
  worldSummary: EditorialDailyOverview;
  editorialBrief: EditorialBrief;
  promptVersion: string;
  generatorVersion: string;
  createdBy: string;
  createdAt: string;
  transmissions: SafeEditorialTransmission[];
  approvedCount: number;
  draftCount: number;
};

export type EditorialRoomSnapshot = {
  overview: EditorialDailyOverview;
  latestRun: SafeEditorialRun | null;
};

/** Reserved source_signal tokens for mode/grounded (no schema migration). */
export const EDITORIAL_META_MODE_PREFIX = "mode:";
export const EDITORIAL_META_GROUNDED_TRUE = "grounded:true";
export const EDITORIAL_META_GROUNDED_FALSE = "grounded:false";

export function isEditorialMetaSignal(signal: string): boolean {
  return (
    signal.startsWith(EDITORIAL_META_MODE_PREFIX) ||
    signal === EDITORIAL_META_GROUNDED_TRUE ||
    signal === EDITORIAL_META_GROUNDED_FALSE
  );
}

export function encodeEditorialMetaSignals(
  mode: EditorialMode,
  grounded: boolean,
  sourceSignals: string[],
): string[] {
  const clean = sourceSignals
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !isEditorialMetaSignal(s));
  return [
    `${EDITORIAL_META_MODE_PREFIX}${mode}`,
    grounded ? EDITORIAL_META_GROUNDED_TRUE : EDITORIAL_META_GROUNDED_FALSE,
    ...clean,
  ];
}

export function decodeEditorialMetaSignals(signals: string[]): {
  mode: EditorialMode | null;
  grounded: boolean;
  sourceSignals: string[];
} {
  let mode: EditorialMode | null = null;
  let grounded = false;
  const sourceSignals: string[] = [];
  for (const s of signals) {
    if (s.startsWith(EDITORIAL_META_MODE_PREFIX)) {
      const raw = s.slice(EDITORIAL_META_MODE_PREFIX.length);
      if (
        (
          [
            "current",
            "explanation",
            "outlaw",
            "leaf_deeds",
            "agent",
            "world_lore",
            "direct",
            "ascii",
            "wild",
          ] as const
        ).includes(raw as EditorialMode)
      ) {
        mode = raw as EditorialMode;
      }
      continue;
    }
    if (s === EDITORIAL_META_GROUNDED_TRUE) {
      grounded = true;
      continue;
    }
    if (s === EDITORIAL_META_GROUNDED_FALSE) {
      grounded = false;
      continue;
    }
    sourceSignals.push(s);
  }
  return { mode, grounded, sourceSignals };
}
