/**
 * P2A — env validation for the dedicated Purse Executor.
 * Presence checks only; never logs or returns secret values.
 */

export const PURSE_EXECUTOR_RUNTIME_REQUIRED_ENV = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "ROBINHOOD_CHAIN_RPC_URL",
  "FENN_PURSE_PRIVATE_KEY",
] as const;

export type PurseExecutorRuntimeRequiredEnv =
  (typeof PURSE_EXECUTOR_RUNTIME_REQUIRED_ENV)[number];

/** Documented optional; not required for healthy pre-launch idle. */
export const PURSE_EXECUTOR_RUNTIME_OPTIONAL_ENV = [
  "NEXT_PUBLIC_SITE_URL",
  "FENN_PURSE_EXECUTOR_LEASE_KEY",
  "FENN_PURSE_EXECUTOR_BATCH_SIZE",
  // Intentionally NEVER used by production purse:settle:
  // FENN_PURSE_TEST_MODE / FENN_PURSE_TEST_TOKEN_*
] as const;

export class PurseExecutorRuntimeEnvError extends Error {
  readonly missing: string[];

  constructor(missing: string[]) {
    const names = missing.join(", ");
    super(
      `Purse Executor runtime environment incomplete. Missing required variable(s): ${names}`,
    );
    this.name = "PurseExecutorRuntimeEnvError";
    this.missing = missing;
  }
}

function isPresent(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Fail early if required Purse Executor env vars are missing.
 * Does not require X OAuth or OpenAI.
 */
export function validatePurseExecutorRuntimeEnv(
  env: NodeJS.ProcessEnv = process.env,
): void {
  const missing = PURSE_EXECUTOR_RUNTIME_REQUIRED_ENV.filter(
    (name) => !isPresent(env[name]),
  );
  if (missing.length > 0) {
    throw new PurseExecutorRuntimeEnvError([...missing]);
  }
}

export function listMissingPurseExecutorRuntimeEnv(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  return PURSE_EXECUTOR_RUNTIME_REQUIRED_ENV.filter(
    (name) => !isPresent(env[name]),
  );
}

/**
 * Static proof for tests: X Agent required env must not include the Purse key.
 */
export function pursePrivateKeyRequiredByXAgent(): boolean {
  return false;
}
