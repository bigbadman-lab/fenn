import { NextResponse } from "next/server";

import { TreasuryError } from "@/lib/treasury/errors";
import { getPublicTreasurySnapshot } from "@/lib/treasury/snapshot";
import type { PublicTreasurySnapshot } from "@/lib/treasury/types";

export const runtime = "nodejs";

/**
 * Live Treasury holdings change onchain; do not statically cache this route.
 * Stage 9.4 must not claim second-by-second realtime without stronger guarantees.
 */
export const dynamic = "force-dynamic";

/**
 * GET /api/treasury
 *
 * Public authoritative Treasury snapshot.
 * No Privy authentication — Treasury is public product state.
 *
 * Domain states (unconfigured / ready / unavailable) return HTTP 200.
 * Unexpected internal failures return non-2xx without leaking RPC/provider details.
 */
export async function GET() {
  return handleTreasuryGet();
}

/** Testable handler — production uses getPublicTreasurySnapshot. */
export async function handleTreasuryGet(
  loadSnapshot: () => Promise<PublicTreasurySnapshot> = getPublicTreasurySnapshot,
) {
  try {
    const treasury = await loadSnapshot();
    return NextResponse.json(
      { ok: true, treasury },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    return mapTreasuryRouteError(error);
  }
}

function mapTreasuryRouteError(error: unknown) {
  if (error instanceof TreasuryError) {
    console.error("[GET /api/treasury]", error.code);
    return NextResponse.json(
      { ok: false, error: error.message, code: error.code },
      { status: error.status },
    );
  }
  console.error("[GET /api/treasury]", error);
  return NextResponse.json(
    {
      ok: false,
      error: "Treasury snapshot failed",
      code: "treasury_config_failed",
    },
    { status: 500 },
  );
}
