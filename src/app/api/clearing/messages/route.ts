import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  AuthError,
  getVerifiedPrivyUser,
} from "@/lib/auth/get-verified-privy-user";
import { CLEARING_TRAVELLER_COOKIE_NAME } from "@/lib/clearing/config";
import { ClearingError } from "@/lib/clearing/errors";
import { logClearing } from "@/lib/clearing/log";
import { postClearingMessage } from "@/lib/clearing/post";
import { networkKeyFromRequest } from "@/lib/clearing/rate-limit";
import { readClearingJsonBody } from "@/lib/clearing/request";
import {
  findProfileByPrivyUserId,
  profileDto,
} from "@/lib/profiles/queries";
import type { SafeProfile } from "@/lib/profiles/types";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/clearing/messages — server resolves identity; never trusts client author.
 */
export async function POST(request: Request) {
  try {
    const body = await readClearingJsonBody(request);

    const payload = body as {
      body?: unknown;
      clientRequestId?: unknown;
      client_request_id?: unknown;
    };

    const networkKey = networkKeyFromRequest(request);
    const store = await cookies();
    const travellerCookie =
      store.get(CLEARING_TRAVELLER_COOKIE_NAME)?.value ?? null;

    let auth:
      | null
      | { registered: false }
      | { registered: true; profile: SafeProfile } = null;

    const hasAuthHeader =
      Boolean(request.headers.get("authorization")) ||
      Boolean(request.headers.get("privy-id-token"));

    if (hasAuthHeader) {
      try {
        const identity = await getVerifiedPrivyUser(request);
        const admin = createAdminClient();
        const profile = await findProfileByPrivyUserId(
          admin,
          identity.privyUserId,
        );
        if (!profile) {
          auth = { registered: false };
        } else {
          auth = { registered: true, profile: profileDto(profile) };
        }
      } catch (error) {
        if (error instanceof AuthError) {
          auth = null;
        } else {
          throw error;
        }
      }
    }

    const result = await postClearingMessage({
      body: payload.body,
      clientRequestId: payload.clientRequestId ?? payload.client_request_id,
      travellerCookieRaw: travellerCookie,
      auth,
      networkKey,
    });

    return NextResponse.json({
      ok: true,
      message: result.message,
      reused: result.reused,
      ...(result.messagesRemaining !== undefined
        ? { messagesRemaining: result.messagesRemaining }
        : {}),
    });
  } catch (error) {
    if (error instanceof ClearingError) {
      if (
        error.code === "clearing_rate_limited" ||
        error.code === "clearing_slow_mode" ||
        error.code === "clearing_registration_required" ||
        error.code === "clearing_read_only"
      ) {
        logClearing({
          event:
            error.code === "clearing_rate_limited"
              ? "rate_limited"
              : error.code === "clearing_registration_required"
                ? "registration_required"
                : error.code === "clearing_read_only"
                  ? "read_only_block"
                  : "message_rejected",
          ok: false,
          code: error.code,
        });
      } else {
        logClearing({
          event: "message_rejected",
          ok: false,
          code: error.code,
        });
      }
      return NextResponse.json(
        {
          ok: false,
          error: error.message,
          code: error.code,
          ...error.details,
        },
        { status: error.status },
      );
    }
    console.error("[api/clearing/messages]", error);
    return NextResponse.json(
      { ok: false, error: "Internal server error", code: "clearing_internal" },
      { status: 500 },
    );
  }
}
