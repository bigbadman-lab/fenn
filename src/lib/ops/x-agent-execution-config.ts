/**
 * Production execution gate + conservative cron bounds for the X agent.
 * Default mode is always disabled — never live.
 */

export const FENN_X_AGENT_EXECUTION_MODES = [
  "disabled",
  "dry_run",
  "live",
] as const;

export type FennXAgentExecutionMode =
  (typeof FENN_X_AGENT_EXECUTION_MODES)[number];

export const FENN_X_AGENT_EXECUTION_MODE_ENV = "FENN_X_AGENT_EXECUTION_MODE";
export const FENN_X_AGENT_BATCH_SIZE_ENV = "FENN_X_AGENT_BATCH_SIZE";
export const FENN_X_AGENT_MAX_RUNTIME_SECONDS_ENV =
  "FENN_X_AGENT_MAX_RUNTIME_SECONDS";
export const FENN_X_AGENT_LEASE_KEY_ENV = "FENN_X_AGENT_LEASE_KEY";

export const FENN_X_AGENT_DEFAULT_BATCH_SIZE = 1;
export const FENN_X_AGENT_DEFAULT_MAX_RUNTIME_SECONDS = 50;
export const FENN_X_AGENT_DEFAULT_LEASE_KEY = "x_agent";
/** Lease TTL must outlive the soft runtime budget. */
export const FENN_X_AGENT_LEASE_TTL_PADDING_SECONDS = 15;
export const FENN_X_AGENT_BATCH_SIZE_MAX = 5;

export type XAgentExecutionConfig = {
  mode: FennXAgentExecutionMode;
  batchSize: number;
  maxRuntimeSeconds: number;
  leaseKey: string;
  leaseTtlSeconds: number;
};

function parsePositiveInt(
  raw: string | undefined,
  fallback: number,
  max?: number,
): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  if (max !== undefined) return Math.min(n, max);
  return n;
}

/**
 * Resolve execution mode. Missing/blank/invalid → disabled (never live).
 */
export function parseXAgentExecutionMode(
  raw: string | undefined,
): FennXAgentExecutionMode {
  if (raw === undefined) return "disabled";
  const trimmed = raw.trim().toLowerCase();
  if (trimmed === "") return "disabled";
  if (
    (FENN_X_AGENT_EXECUTION_MODES as readonly string[]).includes(trimmed)
  ) {
    return trimmed as FennXAgentExecutionMode;
  }
  return "disabled";
}

export function resolveXAgentExecutionConfig(
  env: NodeJS.ProcessEnv = process.env,
): XAgentExecutionConfig {
  const mode = parseXAgentExecutionMode(env[FENN_X_AGENT_EXECUTION_MODE_ENV]);
  const batchSize = parsePositiveInt(
    env[FENN_X_AGENT_BATCH_SIZE_ENV],
    FENN_X_AGENT_DEFAULT_BATCH_SIZE,
    FENN_X_AGENT_BATCH_SIZE_MAX,
  );
  const maxRuntimeSeconds = parsePositiveInt(
    env[FENN_X_AGENT_MAX_RUNTIME_SECONDS_ENV],
    FENN_X_AGENT_DEFAULT_MAX_RUNTIME_SECONDS,
  );
  const leaseKeyRaw = env[FENN_X_AGENT_LEASE_KEY_ENV]?.trim();
  const leaseKey =
    leaseKeyRaw && leaseKeyRaw.length > 0
      ? leaseKeyRaw
      : FENN_X_AGENT_DEFAULT_LEASE_KEY;
  const leaseTtlSeconds =
    maxRuntimeSeconds + FENN_X_AGENT_LEASE_TTL_PADDING_SECONDS;

  return {
    mode,
    batchSize,
    maxRuntimeSeconds,
    leaseKey,
    leaseTtlSeconds,
  };
}
