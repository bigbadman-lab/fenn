import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { CLEARING_TRAVELLER_MESSAGE_LIMIT } from "@/lib/clearing/config";
import {
  generateTravellerId,
  sealTravellerCookie,
  openTravellerCookie,
} from "@/lib/clearing/cookie";
import {
  countPublishedTravellerMessages,
  getTravellerById,
  messagesRemainingForTraveller,
  type ClearingTravellerRow,
} from "@/lib/clearing/moderation";
import {
  formatTravellerDisplayName,
  pickTravellerSurname,
} from "@/lib/clearing/names";
import { ClearingError } from "@/lib/clearing/errors";
import type { SafeTravellerIdentity } from "@/lib/clearing/dto";

async function defaultAdmin(): Promise<SupabaseClient> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return createAdminClient();
}

export type MintTravellerResult = {
  traveller: ClearingTravellerRow;
  cookieValue: string;
  identity: SafeTravellerIdentity;
  created: boolean;
  /** True when insert will/would create — for rate limiting before insert. */
  willCreate: boolean;
};

/**
 * Peek whether cookie resumes an existing DB row (no writes).
 */
export async function resolveTravellerResume(input: {
  existingCookieRaw?: string | null;
  admin?: SupabaseClient;
  secret?: string;
}): Promise<ClearingTravellerRow | null> {
  const db = input.admin ?? (await defaultAdmin());
  const existingId = openTravellerCookie(input.existingCookieRaw, {
    secret: input.secret,
  });
  if (!existingId) return null;
  return getTravellerById(existingId, db);
}

/**
 * Mint or resume Traveller from optional existing cookie value.
 * Always server-assigns display name.
 *
 * Callers that mint should rate-limit *before* create when
 * `resolveTravellerResume` returns null.
 */
export async function mintOrResumeTraveller(input: {
  existingCookieRaw?: string | null;
  admin?: SupabaseClient;
  secret?: string;
}): Promise<MintTravellerResult> {
  const db = input.admin ?? (await defaultAdmin());
  const existingId = openTravellerCookie(input.existingCookieRaw, {
    secret: input.secret,
  });

  if (existingId) {
    const row = await getTravellerById(existingId, db);
    if (row) {
      await db
        .from("clearing_travellers")
        .update({ last_seen_at: new Date().toISOString() })
        .eq("id", row.id);
      const accepted = await countPublishedTravellerMessages(row.id, db);
      const cookieValue = sealTravellerCookie(row.id, {
        secret: input.secret,
      });
      return {
        traveller: { ...row, last_seen_at: new Date().toISOString() },
        cookieValue,
        created: false,
        willCreate: false,
        identity: {
          displayName: row.display_name,
          messagesRemaining: messagesRemainingForTraveller(accepted),
          messagesLimit: CLEARING_TRAVELLER_MESSAGE_LIMIT,
        },
      };
    }
  }

  const id = generateTravellerId();
  const displayName = formatTravellerDisplayName(pickTravellerSurname());
  const now = new Date().toISOString();
  const { data, error } = await db
    .from("clearing_travellers")
    .insert({
      id,
      display_name: displayName,
      created_at: now,
      last_seen_at: now,
    })
    .select("id, display_name, created_at, last_seen_at, muted_until, banned_at")
    .single();

  if (error || !data) {
    throw new ClearingError(
      "clearing_internal",
      "Failed to mint Traveller",
      500,
    );
  }

  const cookieValue = sealTravellerCookie(data.id, { secret: input.secret });
  return {
    traveller: data as ClearingTravellerRow,
    cookieValue,
    created: true,
    willCreate: true,
    identity: {
      displayName: data.display_name,
      messagesRemaining: CLEARING_TRAVELLER_MESSAGE_LIMIT,
      messagesLimit: CLEARING_TRAVELLER_MESSAGE_LIMIT,
    },
  };
}
