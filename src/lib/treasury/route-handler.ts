import { NextResponse } from "next/server";

import { TreasuryError } from "@/lib/treasury/errors";
import { getPublicTreasurySnapshot } from "@/lib/treasury/snapshot";
import type { PublicTreasurySnapshot } from "@/lib/treasury/types";

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
