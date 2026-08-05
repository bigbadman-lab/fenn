import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { CLEARING_TRAVELLER_MESSAGE_LIMIT } from "@/lib/clearing/config";
import { ClearingError } from "@/lib/clearing/errors";

async function defaultAdmin(): Promise<SupabaseClient> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return createAdminClient();
}

export type ClearingTravellerRow = {
  id: string;
  display_name: string;
  created_at: string;
  last_seen_at: string;
  muted_until: string | null;
  banned_at: string | null;
};

export function isMutedUntil(mutedUntil: string | null | undefined): boolean {
  if (!mutedUntil) return false;
  const t = Date.parse(mutedUntil);
  if (Number.isNaN(t)) return false;
  return t > Date.now();
}

export function assertTravellerCanSpeak(row: ClearingTravellerRow): void {
  if (row.banned_at) {
    throw new ClearingError(
      "clearing_banned",
      "the path does not hear you.",
      403,
    );
  }
  if (isMutedUntil(row.muted_until)) {
    throw new ClearingError(
      "clearing_muted",
      "the path does not hear you.",
      403,
    );
  }
}

export async function getTravellerById(
  id: string,
  admin?: SupabaseClient,
): Promise<ClearingTravellerRow | null> {
  const db = admin ?? (await defaultAdmin());
  const { data, error } = await db
    .from("clearing_travellers")
    .select("id, display_name, created_at, last_seen_at, muted_until, banned_at")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    throw new ClearingError(
      "clearing_internal",
      "Failed to load Traveller",
      500,
    );
  }
  if (!data) return null;
  return data as ClearingTravellerRow;
}

export async function countPublishedTravellerMessages(
  travellerId: string,
  admin?: SupabaseClient,
): Promise<number> {
  // Alias for historical call sites; accepted includes hidden.
  return countAcceptedTravellerMessages(travellerId, admin);
}

/**
 * Accepted Traveller posts: published OR hidden.
 * Hide does not free a three-message slot.
 */
export async function countAcceptedTravellerMessages(
  travellerId: string,
  admin?: SupabaseClient,
): Promise<number> {
  const db = admin ?? (await defaultAdmin());
  const { count, error } = await db
    .from("clearing_messages")
    .select("id", { count: "exact", head: true })
    .eq("traveller_id", travellerId)
    .in("status", ["published", "hidden"]);
  if (error) {
    throw new ClearingError(
      "clearing_internal",
      "Failed to count Traveller messages",
      500,
    );
  }
  return count ?? 0;
}

export function messagesRemainingForTraveller(acceptedCount: number): number {
  return Math.max(0, CLEARING_TRAVELLER_MESSAGE_LIMIT - acceptedCount);
}

export type OutlawModerationRow = {
  profile_id: string;
  muted_until: string | null;
  banned_at: string | null;
};

export async function getOutlawModeration(
  profileId: string,
  admin?: SupabaseClient,
): Promise<OutlawModerationRow | null> {
  const db = admin ?? (await defaultAdmin());
  const { data, error } = await db
    .from("clearing_outlaw_moderation")
    .select("profile_id, muted_until, banned_at")
    .eq("profile_id", profileId)
    .maybeSingle();
  if (error) {
    throw new ClearingError(
      "clearing_internal",
      "Failed to load outlaw moderation",
      500,
    );
  }
  return data as OutlawModerationRow | null;
}

export function assertOutlawCanSpeak(
  mod: OutlawModerationRow | null,
): void {
  if (!mod) return;
  if (mod.banned_at) {
    throw new ClearingError(
      "clearing_banned",
      "the path does not hear you.",
      403,
    );
  }
  if (isMutedUntil(mod.muted_until)) {
    throw new ClearingError(
      "clearing_muted",
      "the path does not hear you.",
      403,
    );
  }
}

export async function hideClearingMessage(input: {
  messageId: string;
  hiddenBy: string;
  reason?: string | null;
  admin?: SupabaseClient;
}): Promise<{ previousStatus: string; authorLabel: string }> {
  const db = input.admin ?? (await defaultAdmin());
  const existing = await db
    .from("clearing_messages")
    .select("id, status, author_display_name_snapshot")
    .eq("id", input.messageId)
    .maybeSingle();
  if (existing.error || !existing.data) {
    throw new ClearingError("clearing_not_found", "Message not found", 404);
  }
  if (existing.data.status === "rejected") {
    throw new ClearingError(
      "clearing_invalid_request",
      "Rejected messages cannot be hidden",
      400,
    );
  }
  if (existing.data.status === "hidden") {
    return {
      previousStatus: "hidden",
      authorLabel: String(existing.data.author_display_name_snapshot),
    };
  }

  const { data, error } = await db
    .from("clearing_messages")
    .update({
      status: "hidden",
      hidden_at: new Date().toISOString(),
      hidden_by: input.hiddenBy,
      moderation_reason: input.reason?.trim().slice(0, 500) || null,
    })
    .eq("id", input.messageId)
    .eq("status", "published")
    .select("id, author_display_name_snapshot")
    .maybeSingle();
  if (error) {
    throw new ClearingError(
      "clearing_internal",
      "Failed to hide message",
      500,
    );
  }
  if (!data) {
    throw new ClearingError("clearing_not_found", "Message not found", 404);
  }
  return {
    previousStatus: "published",
    authorLabel: String(data.author_display_name_snapshot),
  };
}

export async function unhideClearingMessage(input: {
  messageId: string;
  admin?: SupabaseClient;
}): Promise<{ previousStatus: string; authorLabel: string }> {
  const db = input.admin ?? (await defaultAdmin());
  const existing = await db
    .from("clearing_messages")
    .select("id, status, author_display_name_snapshot")
    .eq("id", input.messageId)
    .maybeSingle();
  if (existing.error || !existing.data) {
    throw new ClearingError("clearing_not_found", "Message not found", 404);
  }
  if (existing.data.status === "published") {
    return {
      previousStatus: "published",
      authorLabel: String(existing.data.author_display_name_snapshot),
    };
  }
  if (existing.data.status !== "hidden") {
    throw new ClearingError(
      "clearing_invalid_request",
      "Only hidden messages can be restored",
      400,
    );
  }

  const { data, error } = await db
    .from("clearing_messages")
    .update({
      status: "published",
      hidden_at: null,
      hidden_by: null,
      moderation_reason: null,
    })
    .eq("id", input.messageId)
    .eq("status", "hidden")
    .select("id, author_display_name_snapshot")
    .maybeSingle();
  if (error) {
    throw new ClearingError(
      "clearing_internal",
      "Failed to unhide message",
      500,
    );
  }
  if (!data) {
    throw new ClearingError("clearing_not_found", "Message not found", 404);
  }
  return {
    previousStatus: "hidden",
    authorLabel: String(data.author_display_name_snapshot),
  };
}

export async function setTravellerModeration(input: {
  travellerId: string;
  mutedUntil?: string | null;
  banned?: boolean;
  admin?: SupabaseClient;
}): Promise<{
  displayName: string;
  previous: { muted_until: string | null; banned_at: string | null };
  next: { muted_until: string | null; banned_at: string | null };
}> {
  const db = input.admin ?? (await defaultAdmin());
  const existing = await getTravellerById(input.travellerId, db);
  if (!existing) {
    throw new ClearingError("clearing_not_found", "Traveller not found", 404);
  }

  let mutedUntil = existing.muted_until;
  let bannedAt = existing.banned_at;
  if (input.mutedUntil !== undefined) mutedUntil = input.mutedUntil;
  if (input.banned === true) bannedAt = new Date().toISOString();
  if (input.banned === false) bannedAt = null;

  const { data, error } = await db
    .from("clearing_travellers")
    .update({
      muted_until: mutedUntil,
      banned_at: bannedAt,
    })
    .eq("id", input.travellerId)
    .select("id, display_name, muted_until, banned_at")
    .maybeSingle();
  if (error || !data) {
    throw new ClearingError(
      "clearing_internal",
      "Failed to update Traveller moderation",
      500,
    );
  }
  return {
    displayName: String(data.display_name),
    previous: {
      muted_until: existing.muted_until,
      banned_at: existing.banned_at,
    },
    next: {
      muted_until: data.muted_until ?? null,
      banned_at: data.banned_at ?? null,
    },
  };
}

export async function setOutlawModeration(input: {
  profileId: string;
  mutedUntil?: string | null;
  banned?: boolean;
  updatedBy: string;
  admin?: SupabaseClient;
}): Promise<{
  previous: { muted_until: string | null; banned_at: string | null };
  next: { muted_until: string | null; banned_at: string | null };
}> {
  const db = input.admin ?? (await defaultAdmin());
  const now = new Date().toISOString();
  const existing = await getOutlawModeration(input.profileId, db);

  let mutedUntil = existing?.muted_until ?? null;
  if (input.mutedUntil !== undefined) mutedUntil = input.mutedUntil;

  let bannedAt = existing?.banned_at ?? null;
  if (input.banned === true) bannedAt = now;
  if (input.banned === false) bannedAt = null;

  const { error } = await db.from("clearing_outlaw_moderation").upsert(
    {
      profile_id: input.profileId,
      muted_until: mutedUntil,
      banned_at: bannedAt,
      updated_at: now,
      updated_by: input.updatedBy,
    },
    { onConflict: "profile_id" },
  );
  if (error) {
    throw new ClearingError(
      "clearing_internal",
      "Failed to update outlaw moderation",
      500,
    );
  }
  return {
    previous: {
      muted_until: existing?.muted_until ?? null,
      banned_at: existing?.banned_at ?? null,
    },
    next: { muted_until: mutedUntil, banned_at: bannedAt },
  };
}
