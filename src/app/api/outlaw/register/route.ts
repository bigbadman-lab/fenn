import { NextResponse } from "next/server";

import {
  AuthError,
  getVerifiedPrivyUser,
} from "@/lib/auth/get-verified-privy-user";
import {
  RegisterError,
  registerOutlaw,
} from "@/lib/profiles/register";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const identity = await getVerifiedPrivyUser(request);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON body", code: "invalid_json" },
        { status: 400 },
      );
    }

    const result = await registerOutlaw(identity, body);

    return NextResponse.json(
      {
        ok: true,
        created: result.created,
        profile: result.profile,
        application: result.application,
      },
      { status: result.created ? 201 : 200 },
    );
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { error: error.message, code: "unauthorized" },
        { status: error.status },
      );
    }

    if (error instanceof RegisterError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    }

    console.error("[api/outlaw/register]", error);
    return NextResponse.json(
      { error: "Internal server error", code: "internal_error" },
      { status: 500 },
    );
  }
}
