/**
 * THE PURSE OF FENN — Stage P0 public/server surfaces.
 *
 * Not Treasury. Not X-agent effects. Not autonomous spending.
 * Manual operator transfer only.
 */

export {
  P0_MANUAL_TRANSFER_AMOUNT_FORMATTED,
  FENN_DEAD_ADDRESS,
  FENN_PURSE_PRIVATE_KEY_ENV,
  PUBLIC_PURSE_TRANSFER_HISTORY_LIMIT,
} from "@/lib/purse/constants";
export { PurseError } from "@/lib/purse/errors";
export { getPurseConfig, requireEnabledPurseConfig, tryActivateOfficialSettlement } from "@/lib/purse/config";
export {
  executeManualOneFennTransfer,
  executeManualTestTransfer,
  executeManualOneFennBurn,
  executeManualTestBurn,
  buildManualTransferPreview,
  buildManualTestTransferPreview,
} from "@/lib/purse/transfer";
export {
  resolveArmedPurseTestToken,
  isPurseTestModeProductionHost,
  isPurseTestModeExplicitlyAllowed,
} from "@/lib/purse/test-mode";
export { getPublicPurseSnapshot } from "@/lib/purse/snapshot";
export { listConfirmedPurseTransfers } from "@/lib/purse/transfers-query";
export type {
  PublicPurseSnapshot,
  PublicPurseTransfer,
  ManualOneFennTransferResult,
  PurseConfigState,
} from "@/lib/purse/types";
