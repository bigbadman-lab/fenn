import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  CLEARING_RATE_LIMITS,
  CLEARING_TRAVELLER_COOKIE_NAME,
} from "@/lib/clearing/config";
import { travellerCookieOptions } from "@/lib/clearing/cookie";
import { ClearingError } from "@/lib/clearing/errors";
import { logClearing } from "@/lib/clearing/log";
import {
  consumeRateBucket,
  networkKeyFromRequest,
} from "@/lib/clearing/rate-limit";
import {
  mintOrResumeTraveller,
  resolveTravellerResume,
} from "@/lib/clearing/traveller";
import { isMutedUntil } from "@/lib/clearing/moderation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SpeakingBlock = "ok" | "muted" | "banned";

function speakingForTraveller(row: {
  banned_at: string | null;
  muted_until: string | null;
}): SpeakingBlock {
  if (row.banned_at) return "banned";
  if (isMutedUntil(row.muted_until)) return "muted";
  return "ok";
}

/**
 * Mint or resume a signed Traveller identity.
 * Browser never supplies id or display name.
 * Empty body; no large payload required.
 */
export async function POST(request: Request) {
  try {
    // Reject oversized junk on mint posts (body optional)
    const lengthHeader = request.headers.get("content-length");
    if (lengthHeader) {
      const n = Number.parseInt(lengthHeader, 10);
      if (Number.isFinite(n) && n > 2048) {
        throw new ClearingError(
          "clearing_payload_too_large",
          "Request body is too large",
          413,
        );
      }
    }

    const store = await cookies();
    const existing = store.get(CLEARING_TRAVELLER_COOKIE_NAME)?.value ?? null;
    const networkKey = networkKeyFromRequest(request);

    const resume = await resolveTravellerResume({
      existingCookieRaw: existing,
    });
    if (!resume) {
      await consumeRateBucket({
        bucketKey: `mint:${networkKey}`,
        windowSeconds: CLEARING_RATE_LIMITS.networkMintWindowSeconds,
        maxHits: CLEARING_RATE_LIMITS.networkMintPerWindow,
      });
    }

    const result = await mintOrResumeTraveller({
      existingCookieRaw: existing,
    });

    store.set(
      CLEARING_TRAVELLER_COOKIE_NAME,
      result.cookieValue,
      travellerCookieOptions(),
    );

    logClearing({
      event: "traveller_mint",
      ok: true,
      detail: result.created ? "created" : "resumed",
      networkHashPrefix: networkKey,
    });

    return NextResponse.json({
      ok: true,
      created: result.created,
      traveller: result.identity,
      speaking: speakingForTraveller(result.traveller),
    });
  } catch (error) {
    if (error instanceof ClearingError) {
      logClearing({
        event: "traveller_mint_fail",
        ok: false,
        code: error.code,
      });
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
    console.error("[api/clearing/traveller]", error);
    return NextResponse.json(
      { ok: false, error: "Internal server error", code: "clearing_internal" },
      { status: 500 },
    );
  }
}
