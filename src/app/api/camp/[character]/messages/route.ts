import { NextResponse } from "next/server";

import {
  AuthError,
  getVerifiedPrivyUser,
} from "@/lib/auth/get-verified-privy-user";
import { CampAiError } from "@/lib/camp/errors";
import { getCampConversation } from "@/lib/camp/conversation";
import { sendCampMessage } from "@/lib/camp/send-message";
import { sendCampMessageBodySchema } from "@/lib/camp/request";
import { findProfileByPrivyUserId } from "@/lib/profiles/queries";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ character: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  try {
    const { character } = await context.params;
    const identity = await getVerifiedPrivyUser(request);
    const admin = createAdminClient();
    const profile = await findProfileByPrivyUserId(admin, identity.privyUserId);

    if (!profile) {
      return NextResponse.json(
        {
          error: "The fire does not know your name",
          code: "camp_not_registered",
        },
        { status: 403 },
      );
    }

    const conversation = await getCampConversation({
      profileId: profile.id,
      characterSlug: character,
      admin,
    });

    return NextResponse.json({ ok: true, conversation });
  } catch (error) {
    return mapCampRouteError(error, "GET");
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const { character } = await context.params;
    const identity = await getVerifiedPrivyUser(request);
    const admin = createAdminClient();
    const profile = await findProfileByPrivyUserId(admin, identity.privyUserId);

    if (!profile) {
      return NextResponse.json(
        {
          error: "The fire does not know your name",
          code: "camp_not_registered",
        },
        { status: 403 },
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON body", code: "camp_message_invalid" },
        { status: 400 },
      );
    }

    const parsed = sendCampMessageBodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", code: "camp_message_invalid" },
        { status: 400 },
      );
    }

    const result = await sendCampMessage({
      profileId: profile.id,
      outlawNumber: profile.outlaw_number,
      characterSlug: character,
      message: parsed.data.message,
      clientMessageId: parsed.data.clientMessageId,
      admin,
    });

    return NextResponse.json(
      {
        ok: true,
        userMessage: result.userMessage,
        assistantMessage: result.assistantMessage,
        reused: result.reused,
      },
      { status: result.reused ? 200 : 201 },
    );
  } catch (error) {
    return mapCampRouteError(error, "POST");
  }
}

function mapCampRouteError(error: unknown, method: string) {
  if (error instanceof AuthError) {
    return NextResponse.json(
      { error: "Not authenticated", code: "camp_not_authenticated" },
      { status: 401 },
    );
  }
  if (error instanceof CampAiError) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: error.status },
    );
  }
  console.error(`[api/camp/messages ${method}]`, error);
  return NextResponse.json(
    { error: "Internal server error", code: "internal_error" },
    { status: 500 },
  );
}
