export const CHRONICLE_KINDS = ["daily", "chronicle"] as const;
export type ChronicleKind = (typeof CHRONICLE_KINDS)[number];

/** Signature line appended to generated Book entries. */
export const CHRONICLE_AUTHOR_SIGNATURE = "— VELL" as const;
export const CHRONICLE_AUTHOR_NAME = "VELL" as const;

export const CHRONICLE_PUBLIC_DEFAULT_LIMIT = 60;
export const CHRONICLE_PUBLIC_MAX_LIMIT = 120;

export type PublicChronicleEntry = {
  id: string;
  kind: ChronicleKind;
  title: string | null;
  body: string;
  coveredDate: string | null;
  publishedAt: string;
};

export type DailyWorldSnapshot = {
  coveredDate: string;
  dayStartIso: string;
  dayEndIso: string;
  newOutlaws: number;
  campMessages: number;
  campLeafRecognised: number;
  leafRecognisedTotal: number;
  leafRecognitionEvents: number;
  deedsCreated: number;
  deedSubmissionsCreated: number;
  deedSubmissionsApproved: number;
  deedSubmissionsRejected: number;
  greenwoodAdmissions: number;
  wallInscriptions: number;
  fennXReplies: number;
  fennWallWrites: number;
  commonsAllocationEvents: number;
  quiet: boolean;
};

export type GeneratedDailyChronicle = {
  title: string;
  body: string;
  referencedFacts: string[];
  tone: "quiet" | "ordinary" | "notable";
};

export type WriteDailyChronicleInput = {
  coveredDate: string;
  title: string;
  body: string;
  snapshot: DailyWorldSnapshot;
  referencedFacts: string[];
  tone: GeneratedDailyChronicle["tone"];
  model?: string;
};

export type WriteDailyChronicleResult = {
  created: boolean;
  entry: PublicChronicleEntry;
};

export type WriteChronicleEntryInput = {
  title: string;
  body: string;
  sourceType?: string;
  /** Maps to chronicle_entries.source_id (not wall source_external_id). */
  sourceId?: string;
  publishedAt?: string;
};
