/**
 * Stage P1C / P2B — authority economic envelope (catastrophe protection only).
 *
 * Three launch ceilings for production:
 * 1. max single transfer
 * 2. max single burn
 * 3. max rolling 24h economic outflow
 *
 * P2B: production defaults = hard launch ceilings.
 * Env may ONLY tighten (<= hard max). Values above hard max fail closed.
 * Malformed env fails closed (never falls back to a wider envelope).
 *
 * Test profile (explicit isolation for harness/calibration only):
 *   FENN_PURSE_AUTHORITY_LIMITS_PROFILE=test
 * uses a wider hard-max envelope. Never automatically applied in production.
 */

import {
  compareEconomicAmountFormatted,
  isEconomicAmountPositiveAndAtMost,
  parseEconomicProposedAmount,
  sumEconomicAmountFormatted,
} from "@/lib/agent/economic-amount";

/** Production / launch hard maximums and effective defaults (P2B). */
export const PRODUCTION_HARD_MAX_SINGLE_TRANSFER_FORMATTED =
  "100000" as const;
export const PRODUCTION_HARD_MAX_SINGLE_BURN_FORMATTED = "50000" as const;
export const PRODUCTION_HARD_MAX_ROLLING_24H_OUTFLOW_FORMATTED =
  "500000" as const;

/**
 * Explicit test-profile hard maximums (calibration / P1 harness only).
 * Require FENN_PURSE_AUTHORITY_LIMITS_PROFILE=test.
 */
export const TEST_DEFAULT_MAX_SINGLE_TRANSFER_FORMATTED = "2000000" as const;
export const TEST_DEFAULT_MAX_SINGLE_BURN_FORMATTED = "500000" as const;
export const TEST_DEFAULT_MAX_ROLLING_24H_OUTFLOW_FORMATTED =
  "5000000" as const;

/**
 * @deprecated Alias — production launch ceilings are canonical (P2B).
 * Kept for existing test references.
 */
export const RECOMMENDED_PRODUCTION_AUTHORITY_LIMITS = {
  maxSingleTransferFormatted:
    PRODUCTION_HARD_MAX_SINGLE_TRANSFER_FORMATTED,
  maxSingleBurnFormatted: PRODUCTION_HARD_MAX_SINGLE_BURN_FORMATTED,
  maxRolling24hOutflowFormatted:
    PRODUCTION_HARD_MAX_ROLLING_24H_OUTFLOW_FORMATTED,
  label: "production_launch_ceilings_10m_purse" as const,
} as const;

export type AuthorityLimitsProfile = "production" | "test";

export type EconomicAuthorityLimits = {
  maxSingleTransferFormatted: string;
  maxSingleBurnFormatted: string;
  maxRolling24hOutflowFormatted: string;
  source: "production_defaults" | "test_defaults" | "env";
  /** Present when loaded from loadEconomicAuthorityLimits; optional for harness inject. */
  profile?: AuthorityLimitsProfile;
};

export const ENV_MAX_SINGLE_TRANSFER = "FENN_PURSE_MAX_SINGLE_TRANSFER";
export const ENV_MAX_SINGLE_BURN = "FENN_PURSE_MAX_SINGLE_BURN";
export const ENV_MAX_ROLLING_24H_OUTFLOW =
  "FENN_PURSE_MAX_ROLLING_24H_OUTFLOW";
/** Explicit isolation for wider test envelope: must equal "test". */
export const ENV_AUTHORITY_LIMITS_PROFILE =
  "FENN_PURSE_AUTHORITY_LIMITS_PROFILE";

export class EconomicAuthorityLimitsError extends Error {
  readonly code: string;

  constructor(code: string, message?: string) {
    super(message ?? code);
    this.name = "EconomicAuthorityLimitsError";
    this.code = code;
  }
}

function resolveProfile(env: NodeJS.ProcessEnv): AuthorityLimitsProfile {
  const raw = env[ENV_AUTHORITY_LIMITS_PROFILE];
  if (typeof raw === "string" && raw.trim().toLowerCase() === "test") {
    return "test";
  }
  // Missing, blank, or anything else → production (fail closed for wider envelope).
  return "production";
}

function hardMaxForProfile(profile: AuthorityLimitsProfile): {
  transfer: string;
  burn: string;
  rolling: string;
} {
  if (profile === "test") {
    return {
      transfer: TEST_DEFAULT_MAX_SINGLE_TRANSFER_FORMATTED,
      burn: TEST_DEFAULT_MAX_SINGLE_BURN_FORMATTED,
      rolling: TEST_DEFAULT_MAX_ROLLING_24H_OUTFLOW_FORMATTED,
    };
  }
  return {
    transfer: PRODUCTION_HARD_MAX_SINGLE_TRANSFER_FORMATTED,
    burn: PRODUCTION_HARD_MAX_SINGLE_BURN_FORMATTED,
    rolling: PRODUCTION_HARD_MAX_ROLLING_24H_OUTFLOW_FORMATTED,
  };
}

/**
 * Parse one ceiling: positive decimal; must be > 0 and <= hardMax.
 * Throws EconomicAuthorityLimitsError on any invalid config.
 */
export function parseAuthorityLimitCeiling(
  raw: string,
  hardMax: string,
  label: string,
): string {
  let value: string;
  try {
    value = parseEconomicProposedAmount(raw);
  } catch (error) {
    const code =
      error instanceof Error ? error.message : "economic_amount_malformed";
    throw new EconomicAuthorityLimitsError(
      `authority_limit_invalid:${label}:${code}`,
      `Invalid ${label}: ${code}`,
    );
  }

  // Positive already enforced by parse. Enforce hard max (no silent widening).
  if (
    !isEconomicAmountPositiveAndAtMost(
      value,
      hardMax,
      18,
    )
  ) {
    throw new EconomicAuthorityLimitsError(
      `authority_limit_exceeds_hard_max:${label}`,
      `${label}=${value} exceeds hard maximum ${hardMax}`,
    );
  }

  return value;
}

function readLimitOrDefault(
  env: NodeJS.ProcessEnv,
  key: string,
  hardMax: string,
  label: string,
): { value: string; fromEnv: boolean } {
  const raw = env[key];
  if (raw == null || String(raw).trim() === "") {
    return { value: hardMax, fromEnv: false };
  }
  return {
    value: parseAuthorityLimitCeiling(String(raw), hardMax, label),
    fromEnv: true,
  };
}

/**
 * Load authority limits for the active profile.
 *
 * - production (default): hard max / defaults = 100000 / 50000 / 500000
 * - test (explicit PROFILE=test): wider harness envelope
 * - env may only set values <= profile hard max
 * - env larger than hard max → throw
 * - malformed env → throw (never substitute a wider default)
 */
export function loadEconomicAuthorityLimits(
  env: NodeJS.ProcessEnv = process.env,
): EconomicAuthorityLimits {
  const profile = resolveProfile(env);
  const hard = hardMaxForProfile(profile);

  const transfer = readLimitOrDefault(
    env,
    ENV_MAX_SINGLE_TRANSFER,
    hard.transfer,
    "max_single_transfer",
  );
  const burn = readLimitOrDefault(
    env,
    ENV_MAX_SINGLE_BURN,
    hard.burn,
    "max_single_burn",
  );
  const rolling = readLimitOrDefault(
    env,
    ENV_MAX_ROLLING_24H_OUTFLOW,
    hard.rolling,
    "max_rolling_24h_outflow",
  );

  const fromEnv = transfer.fromEnv || burn.fromEnv || rolling.fromEnv;
  return {
    maxSingleTransferFormatted: transfer.value,
    maxSingleBurnFormatted: burn.value,
    maxRolling24hOutflowFormatted: rolling.value,
    source: fromEnv
      ? "env"
      : profile === "test"
        ? "test_defaults"
        : "production_defaults",
    profile,
  };
}

/**
 * Production-profile limits regardless of FENN_PURSE_AUTHORITY_LIMITS_PROFILE.
 * Use for official settlement defence-in-depth.
 */
export function loadProductionEconomicAuthorityLimits(
  env: NodeJS.ProcessEnv = process.env,
): EconomicAuthorityLimits {
  return loadEconomicAuthorityLimits({
    ...env,
    [ENV_AUTHORITY_LIMITS_PROFILE]: "production",
  });
}

/**
 * Official settlement hard check on a single transfer/burn amount.
 * Uses production ceilings + any tightening env overrides (profile forced production).
 * Does not clamp.
 */
export function assertOfficialSettlementAmountWithinLimits(input: {
  action: "transfer" | "burn";
  amountFormatted: string;
  decimals?: number;
  env?: NodeJS.ProcessEnv;
}): { ok: true } | { ok: false; code: string; message: string } {
  const decimals = input.decimals ?? 18;
  let limits: EconomicAuthorityLimits;
  try {
    limits = loadProductionEconomicAuthorityLimits(input.env ?? process.env);
  } catch (error) {
    const code =
      error instanceof EconomicAuthorityLimitsError
        ? error.code
        : "authority_limits_invalid";
    return {
      ok: false,
      code,
      message:
        error instanceof Error ? error.message : "authority limits invalid",
    };
  }

  try {
    const amount = parseEconomicProposedAmount(input.amountFormatted);
    const max =
      input.action === "transfer"
        ? limits.maxSingleTransferFormatted
        : limits.maxSingleBurnFormatted;
    if (!isEconomicAmountPositiveAndAtMost(amount, max, decimals)) {
      return {
        ok: false,
        code:
          input.action === "transfer"
            ? "amount_exceeds_transfer_limit"
            : "amount_exceeds_burn_limit",
        message: `amount ${amount} exceeds ${input.action} ceiling ${max}`,
      };
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      code:
        error instanceof Error ? error.message : "economic_amount_malformed",
      message:
        error instanceof Error ? error.message : "economic_amount_malformed",
    };
  }
}

/** Rolling 24h projected outflow must stay within production limits (no clamp). */
export function assertOfficialSettlementRollingWithinLimits(input: {
  amountFormatted: string;
  priorRolling24hOutflowFormatted: string;
  decimals?: number;
  env?: NodeJS.ProcessEnv;
}): { ok: true } | { ok: false; code: string; message: string } {
  const decimals = input.decimals ?? 18;
  let limits: EconomicAuthorityLimits;
  try {
    limits = loadProductionEconomicAuthorityLimits(input.env ?? process.env);
  } catch (error) {
    const code =
      error instanceof EconomicAuthorityLimitsError
        ? error.code
        : "authority_limits_invalid";
    return {
      ok: false,
      code,
      message:
        error instanceof Error ? error.message : "authority limits invalid",
    };
  }

  try {
    const amount = parseEconomicProposedAmount(input.amountFormatted);
    const projected = sumEconomicAmountFormatted(
      [input.priorRolling24hOutflowFormatted || "0", amount],
      decimals,
    );
    if (
      !isEconomicAmountPositiveAndAtMost(
        projected,
        limits.maxRolling24hOutflowFormatted,
        decimals,
      )
    ) {
      return {
        ok: false,
        code: "amount_exceeds_rolling_24h_limit",
        message: `projected rolling ${projected} exceeds ${limits.maxRolling24hOutflowFormatted}`,
      };
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      code: "amount_exceeds_rolling_24h_limit",
      message:
        error instanceof Error ? error.message : "rolling_limit_check_failed",
    };
  }
}

/** Compare helpers used in tests without importing amount module twice. */
export function productionHardMaxes() {
  return {
    maxSingleTransferFormatted:
      PRODUCTION_HARD_MAX_SINGLE_TRANSFER_FORMATTED,
    maxSingleBurnFormatted: PRODUCTION_HARD_MAX_SINGLE_BURN_FORMATTED,
    maxRolling24hOutflowFormatted:
      PRODUCTION_HARD_MAX_ROLLING_24H_OUTFLOW_FORMATTED,
  };
}

export function isStrictlyAboveCeiling(
  amount: string,
  ceiling: string,
  decimals = 18,
): boolean {
  return compareEconomicAmountFormatted(amount, ceiling, decimals) > 0;
}
