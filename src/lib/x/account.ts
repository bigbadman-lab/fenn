import "server-only";

import { lookupUserByUsername, type XHttpFetch } from "@/lib/x/client";
import { getXReadConfig, type XReadConfig } from "@/lib/x/config";
import { XError } from "@/lib/x/errors";
import { assertSnowflakeId } from "@/lib/x/snowflake";

export type XAccountVerification = {
  expectedUsername: string;
  resolvedUsername: string;
  resolvedUserId: string;
  configuredUserId: string | null;
  matchesConfigured: boolean;
  ok: boolean;
};

/**
 * Prove configured FENN_X_USER_ID belongs to the expected @askfenn account.
 * Does not log tokens.
 */
export async function verifyFennXAccount(
  deps: {
    config?: XReadConfig;
    fetchFn?: XHttpFetch;
  } = {},
): Promise<XAccountVerification> {
  const config = deps.config ?? getXReadConfig();
  const resolved = await lookupUserByUsername(
    config,
    config.fennXUsername,
    { fetchFn: deps.fetchFn },
  );

  const resolvedUserId = assertSnowflakeId(resolved.id, "resolved.id");
  const resolvedUsername = resolved.username.replace(/^@/, "").toLowerCase();
  const expectedUsername = config.fennXUsername.toLowerCase();

  if (resolvedUsername !== expectedUsername) {
    throw new XError(
      "x_account_mismatch",
      `lookup returned @${resolvedUsername}, expected @${expectedUsername}`,
      500,
    );
  }

  const configuredUserId = config.fennXUserId
    ? assertSnowflakeId(config.fennXUserId, "FENN_X_USER_ID")
    : null;

  const matchesConfigured =
    configuredUserId === null || configuredUserId === resolvedUserId;

  return {
    expectedUsername,
    resolvedUsername,
    resolvedUserId,
    configuredUserId,
    matchesConfigured,
    ok: matchesConfigured,
  };
}

export function formatAccountVerification(
  result: XAccountVerification,
): string {
  const lines = [
    "X account verification",
    `expected: @${result.expectedUsername}`,
    `resolved: @${result.resolvedUsername}`,
    `resolved_user_id: ${result.resolvedUserId}`,
    `configured_user_id: ${result.configuredUserId ?? "(unset)"}`,
    `match: ${result.matchesConfigured ? "yes" : "no"}`,
  ];
  if (!result.configuredUserId) {
    lines.push(
      "hint: set FENN_X_USER_ID to the resolved_user_id after verification",
    );
  }
  return lines.join("\n");
}
