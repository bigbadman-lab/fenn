import { NextResponse } from "next/server";

import {
  AuthError,
  getVerifiedPrivyUser,
} from "@/lib/auth/get-verified-privy-user";
import { createDeedSubmissionBodySchema } from "@/lib/deeds/submission-evaluate";
import {
  DeedSubmissionError,
  createDeedSubmission,
} from "@/lib/deeds/submissions";
import { findProfileByPrivyUserId } from "@/lib/profiles/queries";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    const { id: deedId } = await context.params;
    const identity = await getVerifiedPrivyUser(request);
    const admin = createAdminClient();
    const profile = await findProfileByPrivyUserId(admin, identity.privyUserId);

    if (!profile) {
      return NextResponse.json(
        {
          error: "A name must be entered in the book first",
          code: "not_registered",
        },
        { status: 403 },
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON body", code: "invalid_json" },
        { status: 400 },
      );
    }

    const parsed = createDeedSubmissionBodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", code: "invalid_json" },
        { status: 400 },
      );
    }

    const submission = await createDeedSubmission({
      profileId: profile.id,
      deedId,
      evidence: {
        text: parsed.data.evidenceText,
        url: parsed.data.evidenceUrl,
        other: parsed.data.evidenceOther,
      },
      imageRef: parsed.data.imageRef,
    });

    return NextResponse.json({ ok: true, submission }, { status: 201 });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { error: "Not authenticated", code: "unauthorized" },
        { status: error.status === 401 ? 401 : error.status },
      );
    }

    if (error instanceof DeedSubmissionError) {
      return NextResponse.json(
        {
          error: error.message,
          code: error.code,
          ...(error.evidenceErrors
            ? { evidenceErrors: error.evidenceErrors }
            : {}),
        },
        { status: error.status },
      );
    }

    console.error("[api/deeds/submissions]", error);
    return NextResponse.json(
      { error: "Internal server error", code: "internal_error" },
      { status: 500 },
    );
  }
}
