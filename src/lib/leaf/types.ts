/** Safe LEAF integer for app DTOs (must fit Number.MAX_SAFE_INTEGER). */
export type LeafAmount = number;

export type LeafAwardSourceType = "camp" | "deed" | "system";
export type LeafAdminSourceType = "admin_adjustment";
export type LeafSourceType = LeafAwardSourceType | LeafAdminSourceType;

export type LeafAwardActorType = "system" | "service";
export type LeafAdminActorType = "admin";
export type LeafActorType = LeafAwardActorType | LeafAdminActorType;

export type SafeLeafLedgerEntry = {
  id: string;
  profileId: string;
  amount: LeafAmount;
  lifetimeDelta: LeafAmount;
  sourceType: LeafSourceType;
  sourceId: string | null;
  reason: string;
  createdAt: string;
};

export type LeafMutationResult = {
  created: boolean;
  entry: SafeLeafLedgerEntry;
  leafBalance: LeafAmount;
  leafLifetimeEarned: LeafAmount;
};

export type AwardLeafInput = {
  profileId: string;
  amount: number;
  sourceType: LeafAwardSourceType;
  sourceId?: string | null;
  secondarySourceId?: string | null;
  reason: string;
  actorType: LeafAwardActorType;
  actorId?: string | null;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
};

export type AdminAdjustLeafInput = {
  profileId: string;
  amount: number;
  lifetimeDelta: number;
  reason: string;
  actorId: string;
  idempotencyKey: string;
  sourceId?: string | null;
  secondarySourceId?: string | null;
  metadata?: Record<string, unknown>;
};

export type LeafHistoryOptions = {
  /** Exclusive cursor: return rows older than this (created_at, id). */
  cursor?: { createdAt: string; id: string } | null;
  limit?: number;
};

export type LeafHistoryPage = {
  entries: SafeLeafLedgerEntry[];
  nextCursor: { createdAt: string; id: string } | null;
};

export type LeafReconciliationResult = {
  profileId: string;
  cache: {
    leafBalance: LeafAmount;
    leafLifetimeEarned: LeafAmount;
  };
  ledger: {
    amountSum: LeafAmount;
    lifetimeDeltaSum: LeafAmount;
  };
  matches: boolean;
};

export type StandingSnapshot = {
  lifetimeLeaf: LeafAmount;
  greenwoodThreshold: number | null;
  meetsGreenwoodThreshold: boolean | null;
};

/** Internal validated write payload (engine modules only). */
export type InternalLeafWriteInput = {
  profileId: string;
  walletAddress: string;
  amount: number;
  lifetimeDelta: number;
  sourceType: LeafSourceType;
  sourceId: string | null;
  secondarySourceId: string | null;
  reason: string;
  actorType: LeafActorType;
  actorId: string | null;
  idempotencyKey: string;
  metadata: Record<string, unknown>;
};

export type LeafLedgerRow = {
  id: string;
  profile_id: string;
  wallet_address: string;
  amount: number | string;
  lifetime_delta: number | string;
  source_type: string;
  source_id: string | null;
  secondary_source_id: string | null;
  reason: string;
  actor_type: string;
  actor_id: string | null;
  idempotency_key: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};
