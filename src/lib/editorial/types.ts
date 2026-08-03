import type {
  EditorialApprovalState,
  EditorialCategory,
  EditorialConfidence,
} from "@/lib/editorial/categories";

/** Version strings stored on each run for audit replay. */
export const EDITORIAL_PROMPT_VERSION = "editorial-prompt-v1";
export const EDITORIAL_GENERATOR_VERSION = "editorial-generator-v1";

export const EDITORIAL_OPENAI_MODEL = "gpt-4o-mini";
export const EDITORIAL_PACKAGE_MAX_COMPLETION_TOKENS = 12_000;
export const EDITORIAL_SINGLE_MAX_COMPLETION_TOKENS = 1_200;

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
};

/** Trusted factual context passed to the generator (no private data). */
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
};

/** Ecosystem awareness — not news generation. */
export type EditorialRobinhoodContext = {
  hasTrustedSignals: boolean;
  lines: string[];
  caution:
    | "summarise only; never invent announcements or partnerships";
};

export type EditorialBrief = {
  themes: string[];
  avoid: string[];
};

export type EditorialDraftTransmission = {
  category: EditorialCategory;
  title: string;
  body: string;
  operatorRationale: string;
  sourceSignals: string[];
  confidence: EditorialConfidence;
};

export type EditorialGeneratedPackage = {
  brief: EditorialBrief;
  transmissions: EditorialDraftTransmission[];
};

export type SafeEditorialTransmission = {
  id: string;
  runId: string;
  slotIndex: number;
  category: EditorialCategory;
  categoryLabel: string;
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
