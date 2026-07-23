import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createDeedSubmissionBodySchema,
  evaluateCreateDeedSubmission,
  evaluateDeedUploadEligibility,
  ownDeedSubmissionFilters,
} from "./submission-evaluate";
import { toSafeDeedSubmission } from "./submission-dto";
import type {
  DeedEvidenceRequirements,
  DeedSubmissionRow,
  SafeDeed,
} from "./types";

const textRequired: DeedEvidenceRequirements = {
  text: { allowed: true, required: true },
  url: { allowed: false, required: false },
  image: { allowed: false, required: false },
  other: { allowed: false, required: false },
};

const textAndUrl: DeedEvidenceRequirements = {
  text: { allowed: true, required: true },
  url: { allowed: true, required: false },
  image: { allowed: false, required: false },
  other: { allowed: false, required: false },
};

const imageRequired: DeedEvidenceRequirements = {
  text: { allowed: true, required: false },
  url: { allowed: false, required: false },
  image: { allowed: true, required: true },
  other: { allowed: false, required: false },
};

function baseDeed(overrides: Partial<SafeDeed> = {}): SafeDeed {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    slug: "test-deed",
    title: "Test",
    loreDescription: "Lore",
    instructions: "Do it",
    category: null,
    accessScope: "road",
    status: "active",
    reward: { type: "fixed", amount: 25 },
    evidenceRequirements: textRequired,
    evidenceRequirementsInvalid: false,
    startsAt: null,
    endsAt: null,
    maxCompletions: null,
    completionsCount: 0,
    isRepeatable: false,
    isPublic: true,
    sponsorName: null,
    externalRewardNote: null,
    publishedAt: null,
    ...overrides,
  };
}

const now = new Date("2026-07-15T12:00:00.000Z");

describe("evaluateCreateDeedSubmission", () => {
  it("allows registered Road user with valid required text", () => {
    const result = evaluateCreateDeedSubmission({
      deed: baseDeed(),
      existingSubmissions: [],
      evidence: { text: "I did the work" },
      now,
      greenwoodEnteredAt: null,
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.evidence.text, "I did the work");
      assert.equal(result.evidence.imagePath, null);
    }
  });

  it("rejects missing deed", () => {
    const result = evaluateCreateDeedSubmission({
      deed: null,
      existingSubmissions: [],
      evidence: { text: "x" },
      now,
      greenwoodEnteredAt: null,
    });
    assert.deepEqual(result, { ok: false, code: "deed_not_found" });
  });

  it("rejects non-public deed as not found", () => {
    const result = evaluateCreateDeedSubmission({
      deed: baseDeed({ isPublic: false }),
      existingSubmissions: [],
      evidence: { text: "x" },
      now,
      greenwoodEnteredAt: null,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "deed_not_found");
  });

  it("rejects missing required evidence", () => {
    const result = evaluateCreateDeedSubmission({
      deed: baseDeed(),
      existingSubmissions: [],
      evidence: { text: "   " },
      now,
      greenwoodEnteredAt: null,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "invalid_evidence");
  });

  it("rejects disallowed evidence", () => {
    const result = evaluateCreateDeedSubmission({
      deed: baseDeed({ evidenceRequirements: textRequired }),
      existingSubmissions: [],
      evidence: { text: "ok", url: "https://example.com" },
      now,
      greenwoodEnteredAt: null,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "invalid_evidence");
  });

  it("rejects malformed URL", () => {
    const result = evaluateCreateDeedSubmission({
      deed: baseDeed({ evidenceRequirements: textAndUrl }),
      existingSubmissions: [],
      evidence: { text: "ok", url: "javascript:alert(1)" },
      now,
      greenwoodEnteredAt: null,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "invalid_evidence");
  });

  it("image-required Deed accepts verified image path", () => {
    const path =
      "pending/11111111-1111-4111-8111-111111111111/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222.jpg";
    const result = evaluateCreateDeedSubmission({
      deed: baseDeed({ evidenceRequirements: imageRequired }),
      existingSubmissions: [],
      evidence: { text: "ok", imagePath: path },
      imagePathVerified: true,
      now,
      greenwoodEnteredAt: null,
    });
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.evidence.imagePath, path);
  });

  it("image-required without image rejects", () => {
    const result = evaluateCreateDeedSubmission({
      deed: baseDeed({ evidenceRequirements: imageRequired }),
      existingSubmissions: [],
      evidence: { text: "ok" },
      imagePathVerified: false,
      now,
      greenwoodEnteredAt: null,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "invalid_evidence");
  });

  it("image-disallowed with verified path rejects", () => {
    const result = evaluateCreateDeedSubmission({
      deed: baseDeed({ evidenceRequirements: textRequired }),
      existingSubmissions: [],
      evidence: {
        text: "ok",
        imagePath:
          "pending/11111111-1111-4111-8111-111111111111/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222.jpg",
      },
      imagePathVerified: true,
      now,
      greenwoodEnteredAt: null,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "invalid_evidence");
  });

  it("combined text+image validates", () => {
    const result = evaluateCreateDeedSubmission({
      deed: baseDeed({
        evidenceRequirements: {
          text: { allowed: true, required: true },
          url: { allowed: false, required: false },
          image: { allowed: true, required: true },
          other: { allowed: false, required: false },
        },
      }),
      existingSubmissions: [],
      evidence: {
        text: "notes",
        imagePath:
          "pending/11111111-1111-4111-8111-111111111111/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222.png",
      },
      imagePathVerified: true,
      now,
      greenwoodEnteredAt: null,
    });
    assert.equal(result.ok, true);
  });

  it("rejects unverified client imagePath", () => {
    const result = evaluateCreateDeedSubmission({
      deed: baseDeed({
        evidenceRequirements: {
          text: { allowed: true, required: true },
          url: { allowed: false, required: false },
          image: { allowed: true, required: false },
          other: { allowed: false, required: false },
        },
      }),
      existingSubmissions: [],
      evidence: { text: "ok", imagePath: "uploads/x.png" },
      imagePathVerified: false,
      now,
      greenwoodEnteredAt: null,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "invalid_image_ref");
  });

  it("rejects imagePath key on body schema (use imageRef)", () => {
    assert.equal(
      createDeedSubmissionBodySchema.safeParse({
        evidenceText: "x",
        imagePath: "pending/a/b/c.jpg",
      }).success,
      false,
    );
  });

  it("Greenwood Deed blocks non-members", () => {
    const result = evaluateCreateDeedSubmission({
      deed: baseDeed({ accessScope: "greenwood" }),
      existingSubmissions: [],
      evidence: { text: "ok" },
      now,
      greenwoodEnteredAt: null,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "greenwood_membership_required");
  });

  it("Greenwood Deed allows permanent members", () => {
    const result = evaluateCreateDeedSubmission({
      deed: baseDeed({ accessScope: "greenwood" }),
      existingSubmissions: [],
      evidence: { text: "ok" },
      now,
      greenwoodEnteredAt: "2026-07-01T00:00:00.000Z",
    });
    assert.equal(result.ok, true);
  });

  it("Greenwood Deed blocks eligible-but-not-admitted (null membership)", () => {
    // Standing/eligibility is irrelevant — only greenwood_entered_at matters.
    const result = evaluateCreateDeedSubmission({
      deed: baseDeed({ accessScope: "greenwood" }),
      existingSubmissions: [],
      evidence: { text: "ok" },
      now,
      greenwoodEnteredAt: null,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "greenwood_membership_required");
  });

  it("Common Deed fails closed", () => {
    const result = evaluateCreateDeedSubmission({
      deed: baseDeed({ accessScope: "common" }),
      existingSubmissions: [],
      evidence: { text: "ok" },
      now,
      greenwoodEnteredAt: null,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "common_not_available_yet");
  });

  it("closed Deed rejected", () => {
    const result = evaluateCreateDeedSubmission({
      deed: baseDeed({ status: "closed" }),
      existingSubmissions: [],
      evidence: { text: "ok" },
      now,
      greenwoodEnteredAt: null,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "deed_not_open");
  });

  it("future Deed rejected", () => {
    const result = evaluateCreateDeedSubmission({
      deed: baseDeed({ startsAt: "2026-08-01T00:00:00.000Z" }),
      existingSubmissions: [],
      evidence: { text: "ok" },
      now,
      greenwoodEnteredAt: null,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "deed_not_open");
  });

  it("ended Deed rejected", () => {
    const result = evaluateCreateDeedSubmission({
      deed: baseDeed({ endsAt: "2026-07-01T00:00:00.000Z" }),
      existingSubmissions: [],
      evidence: { text: "ok" },
      now,
      greenwoodEnteredAt: null,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "deed_not_open");
  });

  it("completion cap rejected", () => {
    const result = evaluateCreateDeedSubmission({
      deed: baseDeed({ maxCompletions: 2, completionsCount: 2 }),
      existingSubmissions: [],
      evidence: { text: "ok" },
      now,
      greenwoodEnteredAt: null,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "deed_not_open");
  });

  it("existing pending rejected", () => {
    const result = evaluateCreateDeedSubmission({
      deed: baseDeed(),
      existingSubmissions: [{ status: "pending" }],
      evidence: { text: "ok" },
      now,
      greenwoodEnteredAt: null,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "submission_already_pending");
  });

  it("non-repeatable already-approved rejected", () => {
    const result = evaluateCreateDeedSubmission({
      deed: baseDeed({ isRepeatable: false }),
      existingSubmissions: [{ status: "approved" }],
      evidence: { text: "ok" },
      now,
      greenwoodEnteredAt: null,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "non_repeatable_complete");
  });

  it("non-repeatable with only rejected history may resubmit", () => {
    const result = evaluateCreateDeedSubmission({
      deed: baseDeed({ isRepeatable: false }),
      existingSubmissions: [{ status: "rejected" }],
      evidence: { text: "try again" },
      now,
      greenwoodEnteredAt: null,
    });
    assert.equal(result.ok, true);
  });

  it("repeatable approved history may resubmit when no pending", () => {
    const result = evaluateCreateDeedSubmission({
      deed: baseDeed({ isRepeatable: true }),
      existingSubmissions: [{ status: "approved" }],
      evidence: { text: "again" },
      now,
      greenwoodEnteredAt: null,
    });
    assert.equal(result.ok, true);
  });
});

describe("createDeedSubmissionBodySchema", () => {
  it("accepts evidence fields only", () => {
    const parsed = createDeedSubmissionBodySchema.safeParse({
      evidenceText: "hello",
      evidenceUrl: "https://example.com",
      evidenceOther: null,
    });
    assert.equal(parsed.success, true);
  });

  it("rejects profileId, status, LEAF, imagePath, greenwoodEnteredAt", () => {
    assert.equal(
      createDeedSubmissionBodySchema.safeParse({
        evidenceText: "x",
        profileId: "11111111-1111-4111-8111-111111111111",
      }).success,
      false,
    );
    assert.equal(
      createDeedSubmissionBodySchema.safeParse({
        evidenceText: "x",
        status: "approved",
      }).success,
      false,
    );
    assert.equal(
      createDeedSubmissionBodySchema.safeParse({
        evidenceText: "x",
        leafAwarded: 40,
      }).success,
      false,
    );
    assert.equal(
      createDeedSubmissionBodySchema.safeParse({
        evidenceText: "x",
        imagePath: "x.png",
      }).success,
      false,
    );
    assert.equal(
      createDeedSubmissionBodySchema.safeParse({
        evidenceText: "x",
        greenwoodEnteredAt: "2026-07-01T00:00:00.000Z",
      }).success,
      false,
    );
  });

  it("accepts imageRef field", () => {
    assert.equal(
      createDeedSubmissionBodySchema.safeParse({
        evidenceText: "x",
        imageRef: "pending/a/b/c.jpg",
      }).success,
      true,
    );
  });
});

describe("toSafeDeedSubmission", () => {
  it("maps pending rows and hides actor / ledger ids", () => {
    const row: DeedSubmissionRow = {
      id: "22222222-2222-4222-8222-222222222222",
      deed_id: "11111111-1111-4111-8111-111111111111",
      profile_id: "33333333-3333-4333-8333-333333333333",
      status: "pending",
      evidence_text: "done",
      evidence_url: null,
      evidence_image_path: null,
      evidence_other: null,
      submitted_at: "2026-07-15T12:00:00.000Z",
      reviewed_at: null,
      reviewed_by_actor_id: "profile:secret",
      review_note: null,
      leaf_awarded: null,
      leaf_ledger_id: "44444444-4444-4444-8444-444444444444",
    };

    const safe = toSafeDeedSubmission(row);
    assert.equal(safe.status, "pending");
    assert.equal(safe.evidenceText, "done");
    assert.equal(safe.hasImageEvidence, false);
    assert.equal("reviewed_by_actor_id" in safe, false);
    assert.equal("leafLedgerId" in safe, false);
    assert.equal("profile_id" in safe, false);
  });
});

describe("ownDeedSubmissionFilters", () => {
  it("always scopes by both profile and deed ids", () => {
    const filters = ownDeedSubmissionFilters(
      "33333333-3333-4333-8333-333333333333",
      "11111111-1111-4111-8111-111111111111",
    );
    assert.deepEqual(filters, {
      profile_id: "33333333-3333-4333-8333-333333333333",
      deed_id: "11111111-1111-4111-8111-111111111111",
    });
    assert.throws(() =>
      ownDeedSubmissionFilters("", "11111111-1111-4111-8111-111111111111"),
    );
  });
});

describe("evaluateDeedUploadEligibility", () => {
  it("allows eligible Road image Deed", () => {
    const result = evaluateDeedUploadEligibility({
      deed: baseDeed({
        evidenceRequirements: {
          text: { allowed: true, required: true },
          url: { allowed: false, required: false },
          image: { allowed: true, required: true },
          other: { allowed: false, required: false },
        },
      }),
      existingSubmissions: [],
      now,
      greenwoodEnteredAt: null,
    });
    assert.equal(result.ok, true);
  });

  it("rejects Greenwood non-members; allows members; rejects Common", () => {
    assert.equal(
      evaluateDeedUploadEligibility({
        deed: baseDeed({
          accessScope: "greenwood",
          evidenceRequirements: imageRequired,
        }),
        existingSubmissions: [],
        now,
      greenwoodEnteredAt: null,
      }).ok,
      false,
    );
    assert.equal(
      evaluateDeedUploadEligibility({
        deed: baseDeed({
          accessScope: "greenwood",
          evidenceRequirements: imageRequired,
        }),
        existingSubmissions: [],
        now,
      greenwoodEnteredAt: "2026-07-01T00:00:00.000Z",
      }).ok,
      true,
    );
    assert.equal(
      evaluateDeedUploadEligibility({
        deed: baseDeed({
          accessScope: "common",
          evidenceRequirements: imageRequired,
        }),
        existingSubmissions: [],
        now,
      greenwoodEnteredAt: "2026-07-01T00:00:00.000Z",
      }).ok,
      false,
    );
    assert.equal(
      evaluateDeedUploadEligibility({
        deed: baseDeed({
          status: "closed",
          evidenceRequirements: imageRequired,
        }),
        existingSubmissions: [],
        now,
      greenwoodEnteredAt: null,
      }).ok,
      false,
    );
  });

  it("rejects when image not allowed or pending exists", () => {
    assert.equal(
      evaluateDeedUploadEligibility({
        deed: baseDeed({ evidenceRequirements: textRequired }),
        existingSubmissions: [],
        now,
      greenwoodEnteredAt: null,
    }).ok,
      false,
    );
    assert.equal(
      evaluateDeedUploadEligibility({
        deed: baseDeed({ evidenceRequirements: imageRequired }),
        existingSubmissions: [{ status: "pending" }],
        now,
      greenwoodEnteredAt: null,
    }).ok,
      false,
    );
  });
});
