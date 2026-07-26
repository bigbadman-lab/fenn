import "server-only";

import {
  fetchUserMentions,
  lookupUserByUsername,
  type XHttpFetch,
} from "@/lib/x/client";
import { getXReadConfig, type XReadConfig } from "@/lib/x/config";
import {
  computeContiguousSinceId,
  ingestXPerception,
  readMentionsSinceId,
  writeMentionsSinceId,
} from "@/lib/x/persist";
import { assertSnowflakeId, compareSnowflake } from "@/lib/x/snowflake";

export type XPollAggregate = {
  fetched: number;
  created: number;
  existing: number;
  failed: number;
  pagesFetched: number;
  sinceIdBefore: string | null;
  sinceIdAfter: string | null;
  fennXUserId: string;
};

type PollDeps = {
  config?: XReadConfig;
  fetchFn?: XHttpFetch;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin?: any;
  /** Skip live username lookup when testing with a fixed user id. */
  resolveUserId?: (config: XReadConfig) => Promise<string>;
};

/**
 * Manual / cron-compatible X mentions poll.
 * Perception only — no model calls, Wall, memory, or X posts.
 */
export async function pollXMentions(
  deps: PollDeps = {},
): Promise<XPollAggregate> {
  const config = deps.config ?? getXReadConfig();

  const fennXUserId = assertSnowflakeId(
    deps.resolveUserId
      ? await deps.resolveUserId(config)
      : await resolveFennXUserId(config, deps.fetchFn),
    "FENN_X_USER_ID",
  );

  const sinceIdBefore = await readMentionsSinceId({ admin: deps.admin });
  const fetchResult = await fetchUserMentions(
    config,
    fennXUserId,
    { sinceId: sinceIdBefore },
    { fetchFn: deps.fetchFn },
  );

  let created = 0;
  let existing = 0;
  let failed = 0;
  const fetchedIds: string[] = [];
  const persistedIds: string[] = [];

  // Persist oldest-first so contiguous cursor advancement matches ID order.
  const ordered = [...fetchResult.perceptions].sort((a, b) =>
    compareSnowflake(a.xPostId, b.xPostId),
  );

  for (const perception of ordered) {
    fetchedIds.push(perception.xPostId);
    try {
      const result = await ingestXPerception(perception, {
        admin: deps.admin,
      });
      persistedIds.push(result.xPostId);
      if (result.created) created += 1;
      else existing += 1;
    } catch {
      failed += 1;
      // Continue other items; contiguous cursor stops at the first gap.
    }
  }

  const sinceIdAfter = computeContiguousSinceId({
    previousSinceId: sinceIdBefore,
    fetchedIds,
    persistedIds,
  });

  if (sinceIdAfter && sinceIdAfter !== sinceIdBefore) {
    await writeMentionsSinceId(sinceIdAfter, { admin: deps.admin });
  }

  return {
    fetched: fetchResult.perceptions.length,
    created,
    existing,
    failed,
    pagesFetched: fetchResult.pagesFetched,
    sinceIdBefore,
    sinceIdAfter: sinceIdAfter ?? sinceIdBefore,
    fennXUserId,
  };
}

async function resolveFennXUserId(
  config: XReadConfig,
  fetchFn?: XHttpFetch,
): Promise<string> {
  if (config.fennXUserId) {
    return config.fennXUserId;
  }

  const user = await lookupUserByUsername(config, config.fennXUsername, {
    fetchFn,
  });
  return user.id;
}

/**
 * Format aggregate poll lines — never mention bodies or tokens.
 */
export function formatXPollReport(result: XPollAggregate): string {
  return [
    "X poll",
    `fetched: ${result.fetched}`,
    `created: ${result.created}`,
    `existing: ${result.existing}`,
    `failed: ${result.failed}`,
  ].join("\n");
}
