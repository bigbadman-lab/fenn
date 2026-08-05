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
import { logClearing } from "@/lib/clearing/log";
import {
  assertOutlawCanSpeak,
  assertTravellerCanSpeak,
  countAcceptedTravellerMessages,
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
  travellerCookieRaw?: string | null;
  auth: null | { registered: false } | { registered: true; profile: SafeProfile };
  networkKey: string;
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

type RpcRow = {
  id: string;
  author_type: string;
  author_display_name_snapshot: string;
  body: string;
  created_at: string;
  client_request_id?: string;
  _reused?: boolean;
};

/**
 * Lookup prior message by client_request_id for lost-response recovery.
 * Must run before rate limiting so idempotent retries do not burn budget.
 */
async function findExistingByClientRequest(
  admin: SupabaseClient,
  input: {
    clientRequestId: string;
    travellerId: string | null;
    profileId: string | null;
  },
): Promise<RpcRow | null> {
  let existingQuery = admin
    .from("clearing_messages")
    .select(
      "id, author_type, author_display_name_snapshot, body, created_at, client_request_id",
    )
    .eq("client_request_id", input.clientRequestId)
    .limit(1);

  if (input.travellerId) {
    existingQuery = existingQuery.eq("traveller_id", input.travellerId);
  } else if (input.profileId) {
    existingQuery = existingQuery.eq("profile_id", input.profileId);
  } else {
    return null;
  }

  const existing = await existingQuery.maybeSingle();
  if (existing.data) {
    return { ...(existing.data as RpcRow), _reused: true };
  }
  return null;
}

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
  const pre = await findExistingByClientRequest(admin, {
    clientRequestId: input.clientRequestId,
    travellerId: input.travellerId,
    profileId: input.profileId,
  });
  if (pre) return pre;

  const { data, error } = await admin.rpc("post_clearing_message", {
    p_author_type: input.authorType,
    p_traveller_id: input.travellerId,
    p_profile_id: input.profileId,
    p_display_name: input.displayName,
    p_body: input.body,
    p_client_request_id: input.clientRequestId,
  });

  if (error) {
    // Concurrent invent: unique conflict may race; re-read idempotent row
    const again = await findExistingByClientRequest(admin, {
      clientRequestId: input.clientRequestId,
      travellerId: input.travellerId,
      profileId: input.profileId,
    });
    if (again) return again;
    logClearing({
      event: "rpc_fail",
      ok: false,
      detail: "post_clearing_message",
    });
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

/**
 * Server-side message post. Never trusts client author fields.
 */
export async function postClearingMessage(
  input: PostClearingMessageInput,
): Promise<PostClearingMessageResult> {
  const admin = input.admin ?? (await defaultAdmin());
  const body = validateClearingMessageBody(input.body);
  const clientRequestId = requireClientRequestId(input.clientRequestId);

  let state;
  try {
    state = await getClearingState(admin);
  } catch {
    throw new ClearingError(
      "clearing_internal",
      "Clearing state unavailable",
      503,
    );
  }

  if (state.readOnly) {
    logClearing({ event: "read_only_block", ok: false });
    throw new ClearingError(
      "clearing_read_only",
      "the clearing is quiet.",
      403,
    );
  }

  if (input.auth && input.auth.registered === false) {
    logClearing({
      event: "registration_required",
      ok: false,
      detail: "authenticated_unregistered",
    });
    throw new ClearingError(
      "clearing_registration_required",
      "Claim a permanent name before speaking here.",
      403,
      { registrationRequired: true, messagesRemaining: 0 },
    );
  }

  if (input.auth && input.auth.registered === true) {
    const profile = input.auth.profile;
    const mod = await getOutlawModeration(profile.id, admin);
    try {
      assertOutlawCanSpeak(mod);
    } catch (e) {
      if (e instanceof ClearingError) {
        logClearing({
          event: "voice_block",
          ok: false,
          code: e.code,
          authorType: "outlaw",
        });
      }
      throw e;
    }

    const existing = await findExistingByClientRequest(admin, {
      clientRequestId,
      travellerId: null,
      profileId: profile.id,
    });
    if (existing) {
      logClearing({
        event: "message_accepted",
        ok: true,
        authorType: existing.author_type,
        reused: true,
        messageId: existing.id,
      });
      return {
        message: toSafeClearingMessage(existing),
        reused: true,
      };
    }

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

    logClearing({
      event: "message_accepted",
      ok: true,
      authorType,
      reused: Boolean(row._reused),
      messageId: row.id,
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
  try {
    assertTravellerCanSpeak(traveller);
  } catch (e) {
    if (e instanceof ClearingError) {
      logClearing({
        event: "voice_block",
        ok: false,
        code: e.code,
        authorType: "traveller",
      });
    }
    throw e;
  }

  const existingTraveller = await findExistingByClientRequest(admin, {
    clientRequestId,
    travellerId,
    profileId: null,
  });
  if (existingTraveller) {
    const remaining = messagesRemainingForTraveller(
      await countAcceptedTravellerMessages(travellerId, admin),
    );
    logClearing({
      event: "message_accepted",
      ok: true,
      authorType: "traveller",
      reused: true,
      messageId: existingTraveller.id,
    });
    return {
      message: toSafeClearingMessage(existingTraveller),
      reused: true,
      messagesRemaining: remaining,
    };
  }

  const accepted = await countAcceptedTravellerMessages(travellerId, admin);
  if (accepted >= CLEARING_TRAVELLER_MESSAGE_LIMIT) {
    logClearing({
      event: "registration_required",
      ok: false,
      authorType: "traveller",
    });
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
    await countAcceptedTravellerMessages(travellerId, admin),
  );

  logClearing({
    event: "message_accepted",
    ok: true,
    authorType: "traveller",
    reused: Boolean(row._reused),
    messageId: row.id,
  });

  return {
    message: toSafeClearingMessage(row),
    reused: Boolean(row._reused),
    messagesRemaining: remaining,
  };
}
