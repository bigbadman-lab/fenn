/**
 * Pre-launch Purse disposable-token test rail — pure arming + env resolution.
 * Never used by the official-FENN transfer path.
 * Never marks anything as official FENN.
 */

import {
  FENN_PURSE_TEST_MODE_ALLOW,
  FENN_PURSE_TEST_MODE_ENV,
  FENN_PURSE_TEST_TOKEN_ADDRESS_ENV,
  FENN_PURSE_TEST_TOKEN_DECIMALS_ENV,
} from "@/lib/purse/constants";
import { PurseError } from "@/lib/purse/errors";
import { ROBINHOOD_CHAIN_ID } from "@/lib/treasury/chain-definition";
import {
  isNormalizedEvmAddress,
  parseEvmAddress,
} from "@/lib/wallet/evm";

export type PurseTestToken = {
  contractAddress: string;
  decimals: number;
  chainId: typeof ROBINHOOD_CHAIN_ID;
  symbolLabel: "TEST";
};

/**
 * Production host signals that permanently refuse the test rail.
 * Aligns with clearing production detection (NODE_ENV / VERCEL_ENV).
 */
export function isPurseTestModeProductionHost(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (env.NODE_ENV === "production") return true;
  if (env.VERCEL_ENV === "production") return true;
  return false;
}

export function isPurseTestModeExplicitlyAllowed(
  modeRaw: string | undefined,
): boolean {
  return modeRaw === FENN_PURSE_TEST_MODE_ALLOW;
}

/**
 * Resolve disposable test token from env only.
 * Does not read official FENN / treasury_assets.
 * Throws PurseError on any missing/malformed config or production host.
 */
export function resolveArmedPurseTestToken(
  env: NodeJS.ProcessEnv = process.env,
): PurseTestToken {
  if (isPurseTestModeProductionHost(env)) {
    throw new PurseError(
      "purse_test_mode_production_forbidden",
      "Purse test rail refuses production hosts (NODE_ENV/VERCEL_ENV production)",
      403,
    );
  }

  if (!isPurseTestModeExplicitlyAllowed(env[FENN_PURSE_TEST_MODE_ENV])) {
    throw new PurseError(
      "purse_test_mode_inactive",
      `${FENN_PURSE_TEST_MODE_ENV} must equal "${FENN_PURSE_TEST_MODE_ALLOW}" to arm the test rail`,
      403,
    );
  }

  const addressRaw = env[FENN_PURSE_TEST_TOKEN_ADDRESS_ENV];
  if (addressRaw == null || addressRaw.trim() === "") {
    throw new PurseError(
      "purse_test_token_unavailable",
      `${FENN_PURSE_TEST_TOKEN_ADDRESS_ENV} is required for the Purse test rail`,
      503,
    );
  }

  let contractAddress: string;
  try {
    contractAddress = parseEvmAddress(addressRaw);
  } catch {
    throw new PurseError(
      "purse_test_token_unavailable",
      `${FENN_PURSE_TEST_TOKEN_ADDRESS_ENV} is not a valid EVM address`,
      400,
    );
  }
  if (!isNormalizedEvmAddress(contractAddress)) {
    throw new PurseError(
      "purse_test_token_unavailable",
      `${FENN_PURSE_TEST_TOKEN_ADDRESS_ENV} must be a normalized EVM address`,
      400,
    );
  }

  const decimalsRaw = env[FENN_PURSE_TEST_TOKEN_DECIMALS_ENV];
  if (decimalsRaw == null || decimalsRaw.trim() === "") {
    throw new PurseError(
      "purse_test_token_unavailable",
      `${FENN_PURSE_TEST_TOKEN_DECIMALS_ENV} is required for the Purse test rail`,
      503,
    );
  }

  if (!/^\d+$/.test(decimalsRaw.trim())) {
    throw new PurseError(
      "purse_test_token_unavailable",
      `${FENN_PURSE_TEST_TOKEN_DECIMALS_ENV} must be an integer 0–255`,
      400,
    );
  }

  const decimals = Number(decimalsRaw.trim());
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
    throw new PurseError(
      "purse_test_token_unavailable",
      `${FENN_PURSE_TEST_TOKEN_DECIMALS_ENV} must be an integer 0–255`,
      400,
    );
  }

  return {
    contractAddress,
    decimals,
    chainId: ROBINHOOD_CHAIN_ID,
    symbolLabel: "TEST",
  };
}
