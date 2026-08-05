import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  CLEARING_RATE_LIMITS,
  CLEARING_TRAVELLER_COOKIE_NAME,
} from "@/lib/clearing/config";
import { travellerCookieOptions } from "@/lib/clearing/cookie";
import { ClearingError } from "@/lib/clearing/errors";
import {
  consumeRateBucket,
  networkKeyFromRequest,
} from "@/lib/clearing/rate-limit";
import { isMutedUntil } from "@/lib/clearing/moderation";
import {
  mintOrResumeTraveller,
  resolveTravellerResume,
} from "@/lib/clearing/traveller";

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
 */
export async function POST(request: Request) {
  try {
    const store = await cookies();
    const existing = store.get(CLEARING_TRAVELLER_COOKIE_NAME)?.value ?? null;
    const networkKey = networkKeyFromRequest(request);

    // Rate-limit new mints (including orphaned cookies) before insert.
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

    return NextResponse.json({
      ok: true,
      created: result.created,
      traveller: result.identity,
      speaking: speakingForTraveller(result.traveller),
    });
  } catch (error) {
    if (error instanceof ClearingError) {
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
