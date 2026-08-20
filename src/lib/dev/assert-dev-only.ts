/**
 * Fail-closed gate for local-only development tools.
 * Never expose via NEXT_PUBLIC_*. Never arm on Vercel Production.
 */

export const VELL_DEV_X_REPLY_TERMINAL_ENV = "VELL_DEV_X_REPLY_TERMINAL" as const;

export const VELL_DEV_X_REPLY_TERMINAL_ALLOW = "1" as const;

export class DevOnlyForbiddenError extends Error {
  readonly code = "dev_only_forbidden" as const;
  readonly status = 404;

  constructor(
    message = "This development tool is not available in this environment.",
  ) {
    super(message);
    this.name = "DevOnlyForbiddenError";
  }
}

/**
 * True only when ALL are true:
 * - NODE_ENV is not production
 * - VERCEL_ENV is not production
 * - VELL_DEV_X_REPLY_TERMINAL === "1"
 */
export function isDevOnlyFeatureAllowed(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (env.NODE_ENV === "production") return false;
  if (env.VERCEL_ENV === "production") return false;
  if (env[VELL_DEV_X_REPLY_TERMINAL_ENV] !== VELL_DEV_X_REPLY_TERMINAL_ALLOW) {
    return false;
  }
  return true;
}

/** Throw when the local-only tool must not run. */
export function assertDevOnly(env: NodeJS.ProcessEnv = process.env): void {
  if (!isDevOnlyFeatureAllowed(env)) {
    throw new DevOnlyForbiddenError();
  }
}
