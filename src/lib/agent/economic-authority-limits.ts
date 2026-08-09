/**
 * Stage P1C — simple authority economic envelope (catastrophe protection).
 *
 * Three controls only:
 * 1. max single transfer
 * 2. max single burn
 * 3. max rolling 24h economic outflow
 *
 * Defaults are conservative **TEST** values. Production recommendations live
 * in docs (agent-purse-p1c.md) and the Stage completion report — not silent
 * production policy here.
 */

import { parseEconomicProposedAmount } from "@/lib/agent/economic-amount";

/** TEST default: single transfer cap (formatted decimal string). */
export const TEST_DEFAULT_MAX_SINGLE_TRANSFER_FORMATTED = "2000000" as const;

/** TEST default: single burn cap (stricter than transfer). */
export const TEST_DEFAULT_MAX_SINGLE_BURN_FORMATTED = "500000" as const;

/** TEST default: rolling 24h transfer+burn outflow. */
export const TEST_DEFAULT_MAX_ROLLING_24H_OUTFLOW_FORMATTED =
  "5000000" as const;

/**
 * Recommended production region for a 10M original Purse (manual decision):
 * - max single transfer ≈ 100,000 (1% of original Purse)
 * - max single burn ≈ 50,000 (0.5%)
 * - max rolling 24h ≈ 500,000 (5%)
 *
 * Not applied automatically.
 */
export const RECOMMENDED_PRODUCTION_AUTHORITY_LIMITS = {
  maxSingleTransferFormatted: "100000",
  maxSingleBurnFormatted: "50000",
  maxRolling24hOutflowFormatted: "500000",
  label: "recommended_production_region_10m_purse" as const,
} as const;

export type EconomicAuthorityLimits = {
  maxSingleTransferFormatted: string;
  maxSingleBurnFormatted: string;
  maxRolling24hOutflowFormatted: string;
  /** Always "test_defaults" unless env overrides are present. */
  source: "test_defaults" | "env";
};

const ENV_MAX_TRANSFER = "FENN_PURSE_MAX_SINGLE_TRANSFER";
const ENV_MAX_BURN = "FENN_PURSE_MAX_SINGLE_BURN";
const ENV_MAX_24H = "FENN_PURSE_MAX_ROLLING_24H_OUTFLOW";

function readLimitEnv(
  env: NodeJS.ProcessEnv,
  key: string,
  fallback: string,
): { value: string; fromEnv: boolean } {
  const raw = env[key];
  if (raw == null || raw.trim() === "") {
    return { value: fallback, fromEnv: false };
  }
  try {
    return {
      value: parseEconomicProposedAmount(raw),
      fromEnv: true,
    };
  } catch {
    // Fail closed to TEST defaults rather than open the envelope.
    return { value: fallback, fromEnv: false };
  }
}

/**
 * Load authority limits. Defaults are clearly TEST-safe for harness/local.
 * Override via env for ops; never invent undisclosed production values.
 */
export function loadEconomicAuthorityLimits(
  env: NodeJS.ProcessEnv = process.env,
): EconomicAuthorityLimits {
  const transfer = readLimitEnv(
    env,
    ENV_MAX_TRANSFER,
    TEST_DEFAULT_MAX_SINGLE_TRANSFER_FORMATTED,
  );
  const burn = readLimitEnv(
    env,
    ENV_MAX_BURN,
    TEST_DEFAULT_MAX_SINGLE_BURN_FORMATTED,
  );
  const rolling = readLimitEnv(
    env,
    ENV_MAX_24H,
    TEST_DEFAULT_MAX_ROLLING_24H_OUTFLOW_FORMATTED,
  );
  const fromEnv = transfer.fromEnv || burn.fromEnv || rolling.fromEnv;
  return {
    maxSingleTransferFormatted: transfer.value,
    maxSingleBurnFormatted: burn.value,
    maxRolling24hOutflowFormatted: rolling.value,
    source: fromEnv ? "env" : "test_defaults",
  };
}
