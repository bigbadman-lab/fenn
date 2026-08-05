import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { isClearingUuid } from "@/lib/clearing/cookie";
import {
  encodeFeedCursor,
  decodeFeedCursor,
} from "@/lib/clearing/dto";
import { ClearingError } from "@/lib/clearing/errors";
import { isMutedUntil } from "@/lib/clearing/moderation";
import { getClearingState } from "@/lib/clearing/state";
import type {
  ClearingDeskMessage,
  ClearingDeskMessageFilter,
  ClearingDeskSnapshot,
  ClearingDeskSummary,
  ClearingModerationLogItem,
} from "@/lib/clearing/desk-types";
import { formatOutlawNumber } from "@/lib/profiles/types";

async function defaultAdmin(): Promise<SupabaseClient> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return createAdminClient();
}

const MESSAGE_LIMIT = 40;
const LOG_LIMIT = 30;

export type LogClearingModerationInput = {
  action: string;
  actorProfileId: string;
  actorLabel: string;
  messageId?: string | null;
  travellerId?: string | null;
  profileId?: string | null;
  targetLabel?: string | null;
  previousState?: Record<string, unknown> | null;
  nextState?: Record<string, unknown> | null;
  reason?: string | null;
  admin?: SupabaseClient;
};

export async function logClearingModeration(
  input: LogClearingModerationInput,
): Promise<void> {
  const db = input.admin ?? (await defaultAdmin());
  const { error } = await db.from("clearing_moderation_log").insert({
    action: input.action.slice(0, 64),
    message_id: input.messageId ?? null,
    traveller_id: input.travellerId ?? null,
    profile_id: input.profileId ?? null,
    target_label: input.targetLabel?.slice(0, 120) ?? null,
    previous_state: input.previousState ?? null,
    next_state: input.nextState ?? null,
    reason: input.reason?.trim().slice(0, 500) || null,
    actor_profile_id: input.actorProfileId,
    actor_label: input.actorLabel.slice(0, 120),
  });
  if (error) {
    // Logging failure must not silently claim success without leave-trace;
    // throw so the operator sees incomplete durability.
    throw new ClearingError(
      "clearing_internal",
      "Failed to record moderation log",
      500,
    );
  }
}

export function deskActorLabel(input: {
  outlawAlias: string | null;
  outlawNumber: number;
}): string {
  const alias = input.outlawAlias?.trim();
  if (alias) return alias;
  return `OUTLAW ${formatOutlawNumber(input.outlawNumber)}`;
}

function parseFilter(raw: string | null | undefined): ClearingDeskMessageFilter {
  switch (raw) {
    case "visible":
    case "hidden":
    case "traveller":
    case "outlaw":
    case "voice_blocked":
      return raw;
    default:
      return "all";
  }
}

async function countMessages(
  db: SupabaseClient,
  status: "published" | "hidden",
): Promise<number> {
  const { count, error } = await db
    .from("clearing_messages")
    .select("id", { count: "exact", head: true })
    .eq("status", status);
  if (error) return 0;
  return count ?? 0;
}

async function countTravellerVoice(
  db: SupabaseClient,
  field: "muted" | "banned",
): Promise<number> {
  let query = db
    .from("clearing_travellers")
    .select("id", { count: "exact", head: true });
  if (field === "banned") {
    query = query.not("banned_at", "is", null);
  } else {
    query = query
      .not("muted_until", "is", null)
      .gt("muted_until", new Date().toISOString());
  }
  const { count, error } = await query;
  if (error) return 0;
  return count ?? 0;
}

async function countOutlawVoice(
  db: SupabaseClient,
  field: "muted" | "banned",
): Promise<number> {
  let query = db
    .from("clearing_outlaw_moderation")
    .select("profile_id", { count: "exact", head: true });
  if (field === "banned") {
    query = query.not("banned_at", "is", null);
  } else {
    query = query
      .not("muted_until", "is", null)
      .gt("muted_until", new Date().toISOString());
  }
  const { count, error } = await query;
  if (error) return 0;
  return count ?? 0;
}

function mapLogRow(row: Record<string, unknown>): ClearingModerationLogItem {
  return {
    id: String(row.id),
    action: String(row.action),
    targetLabel: row.target_label == null ? null : String(row.target_label),
    reason: row.reason == null ? null : String(row.reason),
    actorLabel: String(row.actor_label),
    createdAt: String(row.created_at),
    messageId: row.message_id == null ? null : String(row.message_id),
  };
}

/**
 * Desk-only Clearing operator snapshot.
 */
export async function getClearingDeskSnapshot(input: {
  filter?: string | null;
  cursor?: string | null;
  admin?: SupabaseClient;
}): Promise<ClearingDeskSnapshot> {
  const db = input.admin ?? (await defaultAdmin());
  const filter = parseFilter(input.filter ?? null);
  const cursor = decodeFeedCursor(input.cursor);

  const state = await getClearingState(db);

  let query = db
    .from("clearing_messages")
    .select(
      "id, author_type, author_display_name_snapshot, body, status, created_at, hidden_at, moderation_reason, traveller_id, profile_id",
    )
    .in("status", ["published", "hidden"])
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(MESSAGE_LIMIT + 1);

  if (filter === "visible") query = query.eq("status", "published");
  if (filter === "hidden") query = query.eq("status", "hidden");
  if (filter === "traveller") query = query.eq("author_type", "traveller");
  if (filter === "outlaw") {
    query = query.in("author_type", ["outlaw", "keeper"]);
  }

  if (cursor) {
    const createdAt = `"${cursor.createdAt.replace(/"/g, "")}"`;
    query = query.or(
      `created_at.lt.${createdAt},and(created_at.eq.${createdAt},id.lt.${cursor.id})`,
    );
  }

  const { data: rows, error } = await query;
  if (error) {
    throw new ClearingError(
      "clearing_internal",
      "Failed to load Desk Clearing messages",
      500,
    );
  }

  let page = (rows ?? []) as Array<Record<string, unknown>>;
  const hasMore = page.length > MESSAGE_LIMIT;
  page = page.slice(0, MESSAGE_LIMIT);

  const travellerIds = [
    ...new Set(
      page
        .map((r) => r.traveller_id)
        .filter((id): id is string => typeof id === "string" && isClearingUuid(id)),
    ),
  ];
  const profileIds = [
    ...new Set(
      page
        .map((r) => r.profile_id)
        .filter((id): id is string => typeof id === "string" && isClearingUuid(id)),
    ),
  ];

  const travellers = new Map<
    string,
    {
      muted_until: string | null;
      banned_at: string | null;
      publishedCount: number;
    }
  >();
  const outlaws = new Map<
    string,
    { muted_until: string | null; banned_at: string | null }
  >();

  if (travellerIds.length > 0) {
    const { data: tRows } = await db
      .from("clearing_travellers")
      .select("id, muted_until, banned_at")
      .in("id", travellerIds);
    for (const t of tRows ?? []) {
      travellers.set(String(t.id), {
        muted_until: t.muted_until ?? null,
        banned_at: t.banned_at ?? null,
        publishedCount: 0,
      });
    }
    const { data: countRows } = await db
      .from("clearing_messages")
      .select("traveller_id")
      .in("traveller_id", travellerIds)
      .eq("status", "published");
    for (const row of countRows ?? []) {
      const id = String(row.traveller_id);
      const cur = travellers.get(id);
      if (cur) cur.publishedCount += 1;
    }
  }

  if (profileIds.length > 0) {
    const { data: oRows } = await db
      .from("clearing_outlaw_moderation")
      .select("profile_id, muted_until, banned_at")
      .in("profile_id", profileIds);
    for (const o of oRows ?? []) {
      outlaws.set(String(o.profile_id), {
        muted_until: o.muted_until ?? null,
        banned_at: o.banned_at ?? null,
      });
    }
  }

  let messages: ClearingDeskMessage[] = page.map((row) => {
    const authorType =
      row.author_type === "outlaw" || row.author_type === "keeper"
        ? row.author_type
        : "traveller";
    const status =
      row.status === "hidden" || row.status === "rejected"
        ? row.status
        : "published";
    const travellerId =
      typeof row.traveller_id === "string" ? row.traveller_id : null;
    const profileId =
      typeof row.profile_id === "string" ? row.profile_id : null;

    let voice: ClearingDeskMessage["voice"] = null;
    if (travellerId && travellers.has(travellerId)) {
      const t = travellers.get(travellerId)!;
      voice = {
        muted: isMutedUntil(t.muted_until),
        banned: Boolean(t.banned_at),
        mutedUntil: t.muted_until,
        publishedCount: t.publishedCount,
      };
    } else if (profileId) {
      const o = outlaws.get(profileId);
      voice = {
        muted: isMutedUntil(o?.muted_until ?? null),
        banned: Boolean(o?.banned_at),
        mutedUntil: o?.muted_until ?? null,
      };
    }

    return {
      id: String(row.id),
      authorType,
      authorLabel: String(row.author_display_name_snapshot ?? ""),
      body: String(row.body ?? ""),
      status,
      createdAt: String(row.created_at),
      hiddenAt: row.hidden_at == null ? null : String(row.hidden_at),
      moderationReason:
        row.moderation_reason == null ? null : String(row.moderation_reason),
      travellerId,
      profileId,
      voice,
    };
  });

  if (filter === "voice_blocked") {
    messages = messages.filter(
      (m) => m.voice && (m.voice.muted || m.voice.banned),
    );
  }

  const last = page[page.length - 1];
  const nextCursor =
    hasMore && last
      ? encodeFeedCursor(String(last.created_at), String(last.id))
      : null;

  const { data: logRows } = await db
    .from("clearing_moderation_log")
    .select(
      "id, action, target_label, reason, actor_label, created_at, message_id",
    )
    .order("created_at", { ascending: false })
    .limit(LOG_LIMIT);

  const log = (logRows ?? []).map((r) => mapLogRow(r as Record<string, unknown>));

  const [
    publishedCount,
    hiddenCount,
    mutedTravellerCount,
    bannedTravellerCount,
    mutedOutlawCount,
    bannedOutlawCount,
  ] = await Promise.all([
    countMessages(db, "published"),
    countMessages(db, "hidden"),
    countTravellerVoice(db, "muted"),
    countTravellerVoice(db, "banned"),
    countOutlawVoice(db, "muted"),
    countOutlawVoice(db, "banned"),
  ]);

  const lastLog = log[0] ?? null;
  const summary: ClearingDeskSummary = {
    mode: state.readOnly ? "read_only" : "open",
    slowModeSeconds: state.slowModeSeconds,
    publishedCount,
    hiddenCount,
    mutedTravellerCount,
    bannedTravellerCount,
    mutedOutlawCount,
    bannedOutlawCount,
    lastActionAt: lastLog?.createdAt ?? null,
    lastActionLabel: lastLog
      ? `${lastLog.action} · ${lastLog.actorLabel}`
      : null,
  };

  return {
    summary,
    state: {
      readOnly: state.readOnly,
      slowModeSeconds: state.slowModeSeconds,
      updatedAt: state.updatedAt,
    },
    messages,
    nextCursor,
    log,
  };
}

export async function getMessageRowForDesk(
  messageId: string,
  admin?: SupabaseClient,
): Promise<{
  id: string;
  status: string;
  author_type: string;
  author_display_name_snapshot: string;
  body: string;
  traveller_id: string | null;
  profile_id: string | null;
  moderation_reason: string | null;
} | null> {
  const db = admin ?? (await defaultAdmin());
  const { data, error } = await db
    .from("clearing_messages")
    .select(
      "id, status, author_type, author_display_name_snapshot, body, traveller_id, profile_id, moderation_reason",
    )
    .eq("id", messageId)
    .maybeSingle();
  if (error) {
    throw new ClearingError(
      "clearing_internal",
      "Failed to load message",
      500,
    );
  }
  return data as {
    id: string;
    status: string;
    author_type: string;
    author_display_name_snapshot: string;
    body: string;
    traveller_id: string | null;
    profile_id: string | null;
    moderation_reason: string | null;
  } | null;
}
