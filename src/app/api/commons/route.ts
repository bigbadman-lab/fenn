import { NextResponse } from "next/server";

import { CommonsError } from "@/lib/commons/errors";
import { getPublicCommonsSnapshot } from "@/lib/commons/snapshot";
import type { PublicCommonsSnapshot } from "@/lib/commons/types";

export const runtime = "nodejs";

/**
 * Commons is DB-backed accounting, not live chain state.
 * no-store keeps MVP simple and avoids implying stale-but-cached commitments
 * are current after an admin change. Not blockchain realtime.
 */
export const dynamic = "force-dynamic";

/**
 * GET /api/commons
 *
 * Public authoritative Commons snapshot.
 * No Privy authentication — Commons is public product state.
 *
 * Ready (including empty commitments / unavailable history) → HTTP 200.
 * Failure to read current commitments → non-2xx.
 */
export async function GET() {
  return handleCommonsGet();
}

/** Testable handler — production uses getPublicCommonsSnapshot. */
export async function handleCommonsGet(
  loadSnapshot: () => Promise<PublicCommonsSnapshot> = getPublicCommonsSnapshot,
) {
  try {
    const commons = await loadSnapshot();
    return NextResponse.json(
      { ok: true, commons },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    return mapCommonsRouteError(error);
  }
}

function mapCommonsRouteError(error: unknown) {
  if (error instanceof CommonsError) {
    console.error("[GET /api/commons]", error.code);
    return NextResponse.json(
      { ok: false, error: error.message, code: error.code },
      { status: error.status },
    );
  }
  console.error("[GET /api/commons]", error);
  return NextResponse.json(
    {
      ok: false,
      error: "Commons snapshot failed",
      code: "commons_read_failed",
    },
    { status: 500 },
  );
}
