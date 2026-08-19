import "server-only";

import { XError } from "@/lib/x/errors";

/** Canonical FENN X handle for Stage 12 perception. */
export const FENN_X_USERNAME_DEFAULT = "thisisvell";

export const X_API_BASE_URL = "https://api.x.com/2";

/** Finite HTTP timeout for X transport (ms). */
export const X_HTTP_TIMEOUT_MS = 15_000;

/** Mentions page size (X allows 5–100). */
export const X_MENTIONS_MAX_RESULTS = 100;

/** Hard cap on pagination pages per poll. */
export const X_MENTIONS_MAX_PAGES = 5;

export const X_POLL_STATE_KEY = "mentions_askfenn";

export type XReadConfig = {
  bearerToken: string;
  fennXUsername: string;
  /** Stable numeric X user id as string when configured. */
  fennXUserId: string | undefined;
};

function readOptionalEnv(name: string): string | undefined {
  const raw = process.env[name];
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Stage 12.2 read-perception config.
 * Uses the same env names as src/lib/env/server.ts.
 * OAuth client secrets are intentionally not required here.
 */
export function getXReadConfig(): XReadConfig {
  const bearerToken = readOptionalEnv("X_BEARER_TOKEN");
  if (!bearerToken) {
    throw new XError(
      "x_config_invalid",
      "X_BEARER_TOKEN is required for X perception",
      500,
    );
  }

  const usernameRaw =
    readOptionalEnv("FENN_X_USERNAME") || FENN_X_USERNAME_DEFAULT;
  const fennXUsername = usernameRaw.replace(/^@/, "").toLowerCase();
  if (!fennXUsername) {
    throw new XError("x_config_invalid", "FENN_X_USERNAME is empty", 500);
  }

  const fennXUserId = readOptionalEnv("FENN_X_USER_ID");
  if (fennXUserId !== undefined && !/^\d+$/.test(fennXUserId)) {
    throw new XError(
      "x_config_invalid",
      "FENN_X_USER_ID must be a digit string (X snowflake)",
      500,
    );
  }

  return { bearerToken, fennXUsername, fennXUserId };
}
