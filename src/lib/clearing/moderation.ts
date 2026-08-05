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
  const db = admin ?? (await defaultAdmin());
  const { count, error } = await db
    .from("clearing_messages")
    .select("id", { count: "exact", head: true })
    .eq("traveller_id", travellerId)
    .eq("status", "published");
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
}): Promise<void> {
  const db = input.admin ?? (await defaultAdmin());
  const { data, error } = await db
    .from("clearing_messages")
    .update({
      status: "hidden",
      hidden_at: new Date().toISOString(),
      hidden_by: input.hiddenBy,
      moderation_reason: input.reason?.trim().slice(0, 500) || null,
    })
    .eq("id", input.messageId)
    .select("id")
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
}

export async function unhideClearingMessage(input: {
  messageId: string;
  admin?: SupabaseClient;
}): Promise<void> {
  const db = input.admin ?? (await defaultAdmin());
  const { data, error } = await db
    .from("clearing_messages")
    .update({
      status: "published",
      hidden_at: null,
      hidden_by: null,
      moderation_reason: null,
    })
    .eq("id", input.messageId)
    .select("id")
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
}

export async function setTravellerModeration(input: {
  travellerId: string;
  mutedUntil?: string | null;
  banned?: boolean;
  admin?: SupabaseClient;
}): Promise<void> {
  const db = input.admin ?? (await defaultAdmin());
  const patch: Record<string, unknown> = {};
  if (input.mutedUntil !== undefined) patch.muted_until = input.mutedUntil;
  if (input.banned === true) patch.banned_at = new Date().toISOString();
  if (input.banned === false) patch.banned_at = null;

  const { data, error } = await db
    .from("clearing_travellers")
    .update(patch)
    .eq("id", input.travellerId)
    .select("id")
    .maybeSingle();
  if (error) {
    throw new ClearingError(
      "clearing_internal",
      "Failed to update Traveller moderation",
      500,
    );
  }
  if (!data) {
    throw new ClearingError("clearing_not_found", "Traveller not found", 404);
  }
}

export async function setOutlawModeration(input: {
  profileId: string;
  mutedUntil?: string | null;
  banned?: boolean;
  updatedBy: string;
  admin?: SupabaseClient;
}): Promise<void> {
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
}
