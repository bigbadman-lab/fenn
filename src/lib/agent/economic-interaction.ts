/**
 * Stage P1D — pending economic interaction constants and types.
 * Multi-turn wallet collection for transfer_fenn only.
 */

export const ECONOMIC_INTERACTION_STATUSES = [
  "awaiting_wallet",
  "awaiting_wallet_confirmation",
  "wallet_confirmed",
  "executing",
  "completed",
  "cancelled",
  "expired",
  "failed",
] as const;

export type EconomicInteractionStatus =
  (typeof ECONOMIC_INTERACTION_STATUSES)[number];

/** Statuses that block creating a second concurrent flow for the same X user. */
export const ECONOMIC_INTERACTION_ACTIVE_STATUSES = [
  "awaiting_wallet",
  "awaiting_wallet_confirmation",
  "wallet_confirmed",
  "executing",
] as const satisfies readonly EconomicInteractionStatus[];

/** Statuses that intercept a subsequent perception for wallet handling. */
export const ECONOMIC_INTERACTION_WALLET_TURN_STATUSES = [
  "awaiting_wallet",
  "awaiting_wallet_confirmation",
] as const satisfies readonly EconomicInteractionStatus[];

/** Default TTL for pending wallet collection (ms). Override via env. */
export const ECONOMIC_INTERACTION_DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

export type EconomicInteractionRow = {
  id: string;
  authorXUserId: string;
  sourceXPostId: string;
  originPerceptionEventId: string | null;
  originJudgementId: string | null;
  xConversationId: string | null;
  economicActionType: "transfer_fenn";
  proposedAmount: string;
  economicReason: string;
  status: EconomicInteractionStatus;
  candidateWallet: string | null;
  confirmedWallet: string | null;
  candidateSourceXPostId: string | null;
  confirmationSourceXPostId: string | null;
  transferEffectId: string | null;
  lastError: string | null;
  walletRequestedAt: string | null;
  walletReceivedAt: string | null;
  walletConfirmationRequestedAt: string | null;
  walletConfirmedAt: string | null;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
};

export function isActiveEconomicInteractionStatus(
  status: string,
): status is (typeof ECONOMIC_INTERACTION_ACTIVE_STATUSES)[number] {
  return (ECONOMIC_INTERACTION_ACTIVE_STATUSES as readonly string[]).includes(
    status,
  );
}

export function isWalletTurnEconomicInteractionStatus(
  status: string,
): status is (typeof ECONOMIC_INTERACTION_WALLET_TURN_STATUSES)[number] {
  return (
    ECONOMIC_INTERACTION_WALLET_TURN_STATUSES as readonly string[]
  ).includes(status);
}

export function resolveEconomicInteractionTtlMs(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env.FENN_ECONOMIC_INTERACTION_TTL_MS?.trim();
  if (!raw) return ECONOMIC_INTERACTION_DEFAULT_TTL_MS;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 60_000) {
    return ECONOMIC_INTERACTION_DEFAULT_TTL_MS;
  }
  return n;
}
