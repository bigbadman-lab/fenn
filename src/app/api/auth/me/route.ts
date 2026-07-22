import { NextResponse } from "next/server";

import {
  AuthError,
  getVerifiedPrivyUser,
} from "@/lib/auth/get-verified-privy-user";
import {
  findApplicationForProfile,
  findProfileByPrivyUserId,
  profileDto,
} from "@/lib/profiles/queries";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const identity = await getVerifiedPrivyUser(request);
    const admin = createAdminClient();
    const profile = await findProfileByPrivyUserId(admin, identity.privyUserId);

    if (!profile) {
      return NextResponse.json({
        authenticated: true,
        registered: false,
        profile: null,
        application: null,
        wallets: identity.wallets.map((wallet) => wallet.address),
      });
    }

    // Preserve stored wallet anchor — do not rewrite from active Privy wallets.
    const application = await findApplicationForProfile(admin, profile.id);

    return NextResponse.json({
      authenticated: true,
      registered: true,
      profile: profileDto(profile),
      application,
      wallets: identity.wallets.map((wallet) => wallet.address),
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { authenticated: false, error: error.message },
        { status: error.status },
      );
    }

    console.error("[api/auth/me]", error);
    return NextResponse.json(
      { authenticated: false, error: "Internal server error" },
      { status: 500 },
    );
  }
}
