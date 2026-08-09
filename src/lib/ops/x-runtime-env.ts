/**
 * Stage 13.1 — central env validation for the X agent production runtime.
 * Checks presence only; never logs or returns secret values.
 */

/** Required for poll → judge → sight → authorize → execute. */
export const X_AGENT_RUNTIME_REQUIRED_ENV = [
  "NEXT_PUBLIC_SITE_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "NEXT_PUBLIC_PRIVY_APP_ID",
  "SUPABASE_SERVICE_ROLE_KEY",
  "PRIVY_APP_SECRET",
  "OPENAI_API_KEY",
  "X_BEARER_TOKEN",
  "FENN_X_USER_ID",
  "X_OAUTH_CLIENT_ID",
  "X_OAUTH_CLIENT_SECRET",
] as const;

export type XAgentRuntimeRequiredEnv =
  (typeof X_AGENT_RUNTIME_REQUIRED_ENV)[number];

/** Optional for this runtime (documented; not validated as required). */
export const X_AGENT_RUNTIME_OPTIONAL_ENV = [
  "FENN_X_USERNAME",
  "ROBINHOOD_CHAIN_RPC_URL",
  "FENN_TREASURY_ADDRESS",
  "X_API_KEY",
  "X_API_SECRET",
  "FENN_ADMIN_WALLETS",
  "GREENWOOD_ACCESS_WALLETS",
  "CRON_SECRET",
  /** disabled | dry_run | live — default disabled (never live). */
  "FENN_X_AGENT_EXECUTION_MODE",
  /** Stage batch size; default 1. */
  "FENN_X_AGENT_BATCH_SIZE",
  /** Soft runtime budget seconds; default 50. */
  "FENN_X_AGENT_MAX_RUNTIME_SECONDS",
  /** Postgres lease key; default x_agent. */
  "FENN_X_AGENT_LEASE_KEY",
  /**
   * Intentionally NOT required and NOT used by production agent:run-x.
   * Purse signing belongs only to purse:settle / intentional operator CLIs.
   */
  // "FENN_PURSE_PRIVATE_KEY" — do not add to required list
] as const;

export class XAgentRuntimeEnvError extends Error {
  readonly missing: string[];

  constructor(missing: string[]) {
    const names = missing.join(", ");
    super(
      `X agent runtime environment incomplete. Missing required variable(s): ${names}`,
    );
    this.name = "XAgentRuntimeEnvError";
    this.missing = missing;
  }
}

function isPresent(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Fail early if required runtime env vars are missing or blank.
 * Does not read or print secret values.
 * Does not require FENN_PURSE_PRIVATE_KEY (P2A — Purse Executor only).
 */
export function validateXAgentRuntimeEnv(
  env: NodeJS.ProcessEnv = process.env,
): void {
  const missing = X_AGENT_RUNTIME_REQUIRED_ENV.filter(
    (name) => !isPresent(env[name]),
  );
  if (missing.length > 0) {
    throw new XAgentRuntimeEnvError([...missing]);
  }

  const userId = env.FENN_X_USER_ID!.trim();
  if (!/^\d+$/.test(userId)) {
    throw new XAgentRuntimeEnvError([
      "FENN_X_USER_ID (must be a digit snowflake string)",
    ]);
  }
}

/** X Agent must never require the Purse private key (P2A boundary). */
export function xAgentRequiresPursePrivateKey(): boolean {
  return (X_AGENT_RUNTIME_REQUIRED_ENV as readonly string[]).includes(
    "FENN_PURSE_PRIVATE_KEY",
  );
}

export function listMissingXAgentRuntimeEnv(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  return X_AGENT_RUNTIME_REQUIRED_ENV.filter((name) => !isPresent(env[name]));
}
