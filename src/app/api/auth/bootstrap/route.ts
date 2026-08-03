import { NextResponse } from "next/server";

import {
  AuthError,
  getVerifiedPrivyUser,
} from "@/lib/auth/get-verified-privy-user";
import { getAuthenticatedWorldBootstrap } from "@/lib/auth/bootstrap";

export const runtime = "nodejs";

/**
 * Single authenticated snapshot for home / outlaw / shell first paint.
 * One Privy verify, one profile load, parallel First Thirty + invite.
 * no-store — per-member private data.
 */
export async function GET(request: Request) {
  const t0 = performance.now();
  try {
    const identity = await getVerifiedPrivyUser(request);
    const verifyMs = performance.now() - t0;

    const { bootstrap, timing } = await getAuthenticatedWorldBootstrap(identity);

    if (
      process.env.FENN_BOOTSTRAP_TIMING === "1" ||
      (process.env.NODE_ENV === "development" &&
        process.env.FENN_BOOTSTRAP_TIMING !== "0")
    ) {
      console.info(
        JSON.stringify({
          scope: "auth_bootstrap_route",
          verifyMs: Math.round(verifyMs),
          profileMs: Math.round(timing.profileMs ?? 0),
          secondaryMs: Math.round(timing.secondaryMs ?? 0),
          totalMs: Math.round(verifyMs + timing.totalMs),
        }),
      );
    }

    return NextResponse.json(
      {
        ok: true,
        ...bootstrap,
      },
      {
        status: 200,
        headers: { "Cache-Control": "private, no-store" },
      },
    );
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        {
          ok: false,
          authenticated: false,
          registered: false,
          profile: null,
          application: null,
          wallets: [],
          firstThirty: null,
          inviteSummary: null,
          errors: { firstThirty: false, inviteSummary: false },
          error: error.message,
        },
        {
          status: error.status,
          headers: { "Cache-Control": "private, no-store" },
        },
      );
    }

    console.error("[api/auth/bootstrap]", error);
    return NextResponse.json(
      {
        ok: false,
        authenticated: false,
        registered: false,
        profile: null,
        application: null,
        wallets: [],
        firstThirty: null,
        inviteSummary: null,
        errors: { firstThirty: false, inviteSummary: false },
        error: "Internal server error",
      },
      {
        status: 500,
        headers: { "Cache-Control": "private, no-store" },
      },
    );
  }
}
