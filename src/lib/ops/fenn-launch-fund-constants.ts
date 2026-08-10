/**
 * P0 launch ceremony — fixed economic intent for Treasury → Purse funding.
 */

import { PURSE_ORIGINAL_ALLOCATION_FORMATTED } from "@/lib/agent/economic-amount";
import { ROBINHOOD_CHAIN_ID } from "@/lib/treasury/chain-definition";
import { FENN_TOKEN_PUBLIC_INITIAL_PURSE_FORMATTED } from "@/lib/treasury/fenn-token-public-identity";

/** Durable unique operation id — one confirmed funding ever. */
export const FENN_LAUNCH_PURSE_FUNDING_OPERATION_ID =
  "fenn_launch_purse_funding_v1" as const;

/** Exact human units for funding (no commas). */
export const FENN_LAUNCH_PURSE_FUNDING_AMOUNT_FORMATTED =
  PURSE_ORIGINAL_ALLOCATION_FORMATTED; // "10000000"

/** Display form for speech / operator report. */
export const FENN_LAUNCH_PURSE_FUNDING_AMOUNT_DISPLAY =
  FENN_TOKEN_PUBLIC_INITIAL_PURSE_FORMATTED; // "10,000,000"

export const FENN_LAUNCH_PURSE_FUNDING_CHAIN_ID = ROBINHOOD_CHAIN_ID;

/** Env name only — load exclusively in the launch fund operator path. */
export const FENN_TREASURY_PRIVATE_KEY_ENV = "FENN_TREASURY_PRIVATE_KEY" as const;

export const FENN_LAUNCH_FUND_STATUSES = [
  "pending",
  "submitted",
  "confirmed",
  "failed",
  "ambiguous",
] as const;

export type FennLaunchFundStatus = (typeof FENN_LAUNCH_FUND_STATUSES)[number];

export const FENN_LAUNCH_FUND_FAILURE_CLASSES = [
  "pre_broadcast",
  "terminal",
  "ambiguous",
] as const;

export type FennLaunchFundFailureClass =
  (typeof FENN_LAUNCH_FUND_FAILURE_CLASSES)[number];
