import { NextResponse } from "next/server";

import { CommonsError } from "@/lib/commons/errors";
import { getPublicCommonsSnapshot } from "@/lib/commons/snapshot";
import type { PublicCommonsSnapshot } from "@/lib/commons/types";

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
