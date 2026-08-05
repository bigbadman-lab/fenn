import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  CLEARING_DEFAULT_COOLDOWN_SECONDS,
  CLEARING_RATE_LIMITS,
  CLEARING_TRAVELLER_COOLDOWN_SECONDS,
  CLEARING_TRAVELLER_MESSAGE_LIMIT,
} from "@/lib/clearing/config";
import { openTravellerCookie } from "@/lib/clearing/cookie";
import {
  toSafeClearingMessage,
  type SafeClearingMessage,
  validateClearingMessageBody,
  requireClientRequestId,
} from "@/lib/clearing/dto";
import { ClearingError } from "@/lib/clearing/errors";
import {
  assertOutlawCanSpeak,
  assertTravellerCanSpeak,
  countPublishedTravellerMessages,
  getOutlawModeration,
  getTravellerById,
  messagesRemainingForTraveller,
} from "@/lib/clearing/moderation";
import {
  assertAuthorCooldown,
  consumeRateBucket,
} from "@/lib/clearing/rate-limit";
import { getClearingState } from "@/lib/clearing/state";
import { formatOutlawNumber } from "@/lib/profiles/types";
import type { SafeProfile } from "@/lib/profiles/types";

async function defaultAdmin(): Promise<SupabaseClient> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return createAdminClient();
}

export type PostClearingMessageInput = {
  body: unknown;
  clientRequestId: unknown;
  /** Signed cookie raw value (unauthenticated path). */
  travellerCookieRaw?: string | null;
  /**
   * When Privy authenticated:
   * - profile present → outlaw post
   * - profile null → registration_required (never Traveller)
   * When null: use Traveller cookie
   */
  auth: null | { registered: false } | { registered: true; profile: SafeProfile };
  networkKey: string;
  /** Optional: treat as keeper (Desk-verified path sets this). */
  asKeeper?: boolean;
  admin?: SupabaseClient;
};

export type PostClearingMessageResult = {
  message: SafeClearingMessage;
  reused: boolean;
  messagesRemaining?: number;
};

function mapRpcError(message: string): ClearingError {
  const m = message.toLowerCase();
  if (m.includes("registration_required")) {
    return new ClearingError(
      "clearing_registration_required",
      "Your travelling name has carried you this far.",
      403,
      {
        messagesRemaining: 0,
        registrationRequired: true,
      },
    );
  }
  if (m.includes("invalid_body")) {
    return new ClearingError("clearing_invalid_body", "Invalid message body", 400);
  }
  if (m.includes("traveller_not_found")) {
    return new ClearingError(
      "clearing_cookie_invalid",
      "Traveller session is not known",
      401,
    );
  }
  return new ClearingError(
    "clearing_internal",
    "Failed to post message",
    500,
  );
}

/**
 * Server-side message post. Never trusts client author fields.
 */
export async function postClearingMessage(
  input: PostClearingMessageInput,
): Promise<PostClearingMessageResult> {
  const admin = input.admin ?? (await defaultAdmin());
  const body = validateClearingMessageBody(input.body);
  const clientRequestId = requireClientRequestId(input.clientRequestId);

  const state = await getClearingState(admin);
  if (state.readOnly) {
    throw new ClearingError(
      "clearing_read_only",
      "the clearing is quiet.",
      403,
    );
  }

  // Authenticated unregistered — Road philosophy
  if (input.auth && input.auth.registered === false) {
    throw new ClearingError(
      "clearing_registration_required",
      "Claim a permanent name before speaking here.",
      403,
      { registrationRequired: true, messagesRemaining: 0 },
    );
  }

  // Registered Outlaw / Keeper path
  if (input.auth && input.auth.registered === true) {
    const profile = input.auth.profile;
    const mod = await getOutlawModeration(profile.id, admin);
    assertOutlawCanSpeak(mod);

    await consumeRateBucket({
      bucketKey: `outlaw:${profile.id}`,
      windowSeconds: CLEARING_RATE_LIMITS.outlawWindowSeconds,
      maxHits: CLEARING_RATE_LIMITS.outlawPostsPerWindow,
      admin,
    });
    await consumeRateBucket({
      bucketKey: `net:${input.networkKey}`,
      windowSeconds: CLEARING_RATE_LIMITS.networkWindowSeconds,
      maxHits: CLEARING_RATE_LIMITS.networkPostsPerWindow,
      admin,
    });

    const cooldown = Math.max(
      state.slowModeSeconds,
      CLEARING_DEFAULT_COOLDOWN_SECONDS,
    );
    await assertAuthorCooldown({
      authorKey: `profile:${profile.id}`,
      cooldownSeconds: cooldown,
      admin,
    });

    const authorType = input.asKeeper ? "keeper" : "outlaw";
    const displayName =
      profile.alias?.trim() ||
      `OUTLAW ${formatOutlawNumber(profile.outlawNumber)}`;

    const row = await callPostRpc(admin, {
      authorType,
      travellerId: null,
      profileId: profile.id,
      displayName,
      body,
      clientRequestId,
    });

    return {
      message: toSafeClearingMessage(row),
      reused: Boolean(row._reused),
    };
  }

  // Traveller path
  const travellerId = openTravellerCookie(input.travellerCookieRaw);
  if (!travellerId) {
    throw new ClearingError(
      "clearing_unauthorized",
      "A Traveller name is required before speaking.",
      401,
    );
  }

  const traveller = await getTravellerById(travellerId, admin);
  if (!traveller) {
    throw new ClearingError(
      "clearing_cookie_invalid",
      "Traveller session is not known",
      401,
    );
  }
  assertTravellerCanSpeak(traveller);

  const accepted = await countPublishedTravellerMessages(travellerId, admin);
  if (accepted >= CLEARING_TRAVELLER_MESSAGE_LIMIT) {
    throw new ClearingError(
      "clearing_registration_required",
      "Your travelling name has carried you this far.",
      403,
      {
        messagesRemaining: 0,
        registrationRequired: true,
      },
    );
  }

  await consumeRateBucket({
    bucketKey: `traveller:${travellerId}`,
    windowSeconds: CLEARING_RATE_LIMITS.travellerWindowSeconds,
    maxHits: CLEARING_RATE_LIMITS.travellerPostsPerWindow,
    admin,
  });
  await consumeRateBucket({
    bucketKey: `net:${input.networkKey}`,
    windowSeconds: CLEARING_RATE_LIMITS.networkWindowSeconds,
    maxHits: CLEARING_RATE_LIMITS.networkPostsPerWindow,
    admin,
  });

  const cooldown = Math.max(
    state.slowModeSeconds,
    CLEARING_TRAVELLER_COOLDOWN_SECONDS,
  );
  await assertAuthorCooldown({
    authorKey: `traveller:${travellerId}`,
    cooldownSeconds: cooldown,
    admin,
  });

  const row = await callPostRpc(admin, {
    authorType: "traveller",
    travellerId,
    profileId: null,
    displayName: traveller.display_name,
    body,
    clientRequestId,
  });

  const remaining = messagesRemainingForTraveller(
    await countPublishedTravellerMessages(travellerId, admin),
  );

  return {
    message: toSafeClearingMessage(row),
    reused: Boolean(row._reused),
    messagesRemaining: remaining,
  };
}

type RpcRow = {
  id: string;
  author_type: string;
  author_display_name_snapshot: string;
  body: string;
  created_at: string;
  client_request_id?: string;
  _reused?: boolean;
};

async function callPostRpc(
  admin: SupabaseClient,
  input: {
    authorType: string;
    travellerId: string | null;
    profileId: string | null;
    displayName: string;
    body: string;
    clientRequestId: string;
  },
): Promise<RpcRow> {
  // Pre-check for reused marker
  let existingQuery = admin
    .from("clearing_messages")
    .select("id, author_type, author_display_name_snapshot, body, created_at, client_request_id")
    .eq("client_request_id", input.clientRequestId)
    .limit(1);

  if (input.travellerId) {
    existingQuery = existingQuery.eq("traveller_id", input.travellerId);
  } else if (input.profileId) {
    existingQuery = existingQuery.eq("profile_id", input.profileId);
  }

  const existing = await existingQuery.maybeSingle();
  if (existing.data) {
    return { ...(existing.data as RpcRow), _reused: true };
  }

  const { data, error } = await admin.rpc("post_clearing_message", {
    p_author_type: input.authorType,
    p_traveller_id: input.travellerId,
    p_profile_id: input.profileId,
    p_display_name: input.displayName,
    p_body: input.body,
    p_client_request_id: input.clientRequestId,
  });

  if (error) {
    throw mapRpcError(error.message ?? "");
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) {
    throw new ClearingError(
      "clearing_internal",
      "Post returned no row",
      500,
    );
  }

  return row as RpcRow;
}
