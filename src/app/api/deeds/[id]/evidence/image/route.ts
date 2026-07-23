import { NextResponse } from "next/server";

import {
  AuthError,
  getVerifiedPrivyUser,
} from "@/lib/auth/get-verified-privy-user";
import { evaluateDeedUploadEligibility } from "@/lib/deeds/submission-evaluate";
import {
  DeedSubmissionError,
  assertDeedId,
  getMySubmissionsForDeed,
} from "@/lib/deeds/submissions";
import { toSafeDeed } from "@/lib/deeds/rules";
import type { DeedRow } from "@/lib/deeds/types";
import {
  DeedImageError,
  uploadPendingDeedEvidenceImage,
} from "@/lib/deeds/image-upload";
import { findProfileByPrivyUserId } from "@/lib/profiles/queries";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const DEED_SELECT =
  "id, slug, title, lore_description, instructions, category, access_scope, status, reward_leaf_fixed, reward_leaf_min, reward_leaf_max, evidence_requirements, starts_at, ends_at, max_completions, completions_count, is_public, is_repeatable, sponsor_name, external_reward_note, published_at";

/**
 * Upload private image evidence for a Deed.
 * Does not create a deed_submissions row — submission is a separate POST.
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    const { id: rawDeedId } = await context.params;
    const deedId = assertDeedId(rawDeedId);
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

    const { data: deedRow, error: deedError } = await admin
      .from("deeds")
      .select(DEED_SELECT)
      .eq("id", deedId)
      .maybeSingle();

    if (deedError) {
      throw new Error(deedError.message);
    }
    if (!deedRow) {
      return NextResponse.json(
        { error: "Deed not found", code: "deed_not_found" },
        { status: 404 },
      );
    }

    const deed = toSafeDeed(deedRow as DeedRow);
    const existing = await getMySubmissionsForDeed(profile.id, deedId, admin);
    const eligibility = evaluateDeedUploadEligibility({
      deed,
      existingSubmissions: existing.map((s) => ({ status: s.status })),
      greenwoodEnteredAt: profile.greenwood_entered_at,
    });

    if (!eligibility.ok) {
      return NextResponse.json(
        { error: eligibility.code, code: eligibility.code },
        {
          status:
            eligibility.code === "deed_not_found"
              ? 404
              : eligibility.code === "invalid_evidence" ||
                  eligibility.code === "invalid_requirements"
                ? 400
                : 403,
        },
      );
    }

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "No image file", code: "empty_file" },
        { status: 400 },
      );
    }

    const uploaded = await uploadPendingDeedEvidenceImage({
      profileId: profile.id,
      deedId,
      file,
    });

    return NextResponse.json(
      {
        ok: true,
        imageRef: uploaded.imageRef,
        mime: uploaded.mime,
        sizeBytes: uploaded.sizeBytes,
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { error: "Not authenticated", code: "unauthorized" },
        { status: 401 },
      );
    }
    if (error instanceof DeedSubmissionError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    }
    if (error instanceof DeedImageError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    }
    console.error("[api/deeds/evidence/image]", error);
    return NextResponse.json(
      { error: "Internal server error", code: "internal_error" },
      { status: 500 },
    );
  }
}
