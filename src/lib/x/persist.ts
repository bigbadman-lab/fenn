import "server-only";

import { X_POLL_STATE_KEY } from "@/lib/x/config";
import { XError } from "@/lib/x/errors";
import { assertSnowflakeId, compareSnowflake } from "@/lib/x/snowflake";
import type { NormalizedXPerception } from "@/lib/x/validate";

export type IngestResult = {
  created: boolean;
  eventId: string;
  status: string;
  xPostId: string;
};

type AdminLike = {
  from: (table: string) => unknown;
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
};

async function getAdmin(): Promise<AdminLike> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return createAdminClient() as unknown as AdminLike;
}

/**
 * Idempotent durable ingest via DB uniqueness on x_post_id.
 */
export async function ingestXPerception(
  perception: NormalizedXPerception,
  deps: { admin?: AdminLike } = {},
): Promise<IngestResult> {
  const admin = deps.admin ?? (await getAdmin());

  const { data, error } = await admin.rpc("ingest_x_perception_event", {
    p_x_post_id: perception.xPostId,
    p_perception_type: perception.perceptionType,
    p_author_x_user_id: perception.authorXUserId,
    p_author_username: perception.authorUsername,
    p_author_display_name: perception.authorDisplayName,
    p_body: perception.body,
    p_conversation_id: perception.conversationId,
    p_referenced_tweet_ids: perception.referencedTweetIds,
    p_x_created_at: perception.xCreatedAt,
  });

  if (error) {
    throw new XError(
      "x_persist_failed",
      `ingest failed for ${perception.xPostId}: ${error.message}`,
      500,
    );
  }

  const rows = Array.isArray(data) ? data : data ? [data] : [];
  const row = rows[0] as
    | { created?: boolean; event_id?: string; status?: string }
    | undefined;

  if (
    !row ||
    typeof row.created !== "boolean" ||
    typeof row.event_id !== "string" ||
    typeof row.status !== "string"
  ) {
    throw new XError(
      "x_persist_failed",
      `unexpected ingest result for ${perception.xPostId}`,
      500,
      data,
    );
  }

  return {
    created: row.created,
    eventId: row.event_id,
    status: row.status,
    xPostId: perception.xPostId,
  };
}

export async function readMentionsSinceId(
  deps: { admin?: AdminLike } = {},
): Promise<string | null> {
  const admin = deps.admin ?? (await getAdmin());
  const table = admin.from("x_poll_state") as {
    select: (cols: string) => {
      eq: (
        col: string,
        val: string,
      ) => {
        maybeSingle: () => Promise<{
          data: { since_id: string | null } | null;
          error: { message: string } | null;
        }>;
      };
    };
  };

  const { data, error } = await table
    .select("since_id")
    .eq("key", X_POLL_STATE_KEY)
    .maybeSingle();

  if (error) {
    throw new XError(
      "x_persist_failed",
      `read poll cursor failed: ${error.message}`,
      500,
    );
  }

  if (!data?.since_id) return null;
  return assertSnowflakeId(data.since_id, "poll.since_id");
}

export async function writeMentionsSinceId(
  sinceId: string,
  deps: { admin?: AdminLike } = {},
): Promise<void> {
  const id = assertSnowflakeId(sinceId, "since_id");
  const admin = deps.admin ?? (await getAdmin());
  const table = admin.from("x_poll_state") as {
    upsert: (
      row: { key: string; since_id: string },
      opts: { onConflict: string },
    ) => Promise<{ error: { message: string } | null }>;
  };

  const { error } = await table.upsert(
    { key: X_POLL_STATE_KEY, since_id: id },
    { onConflict: "key" },
  );

  if (error) {
    throw new XError(
      "x_persist_failed",
      `write poll cursor failed: ${error.message}`,
      500,
    );
  }
}

/**
 * Advance since_id only through a contiguous ascending run of safely
 * persisted post IDs so a mid-batch failure cannot skip an event.
 */
export function computeContiguousSinceId(args: {
  previousSinceId: string | null;
  /** Fetched post ids for this poll (any order). */
  fetchedIds: string[];
  /** Subset that were safely persisted (created or existing). */
  persistedIds: string[];
}): string | null {
  const persisted = new Set(args.persistedIds.map((id) =>
    assertSnowflakeId(id, "persisted"),
  ));
  const fetched = [
    ...new Set(args.fetchedIds.map((id) => assertSnowflakeId(id, "fetched"))),
  ].sort(compareSnowflake);

  let contiguousMax: string | null = args.previousSinceId
    ? assertSnowflakeId(args.previousSinceId, "previousSinceId")
    : null;

  for (const id of fetched) {
    if (!persisted.has(id)) {
      break;
    }
    contiguousMax = id;
  }

  return contiguousMax;
}
