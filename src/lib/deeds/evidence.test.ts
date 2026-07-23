import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  EMPTY_EVIDENCE_REQUIREMENTS,
  isAbsoluteHttpUrl,
  normalizeSubmissionEvidence,
  parseEvidenceRequirements,
  validateSubmissionEvidence,
} from "@/lib/deeds/evidence";
import {
  canTransitionSubmissionStatus,
  isDeedOpenForSubmission,
  isDeedPubliclyListable,
  mapDbReward,
  toSafeDeed,
  validateChosenApprovalReward,
} from "@/lib/deeds/rules";
import type { DeedEvidenceRequirements, DeedRow, SafeDeed } from "@/lib/deeds/types";

const allOptionalText: DeedEvidenceRequirements = {
  text: { allowed: true, required: false },
  url: { allowed: false, required: false },
  image: { allowed: false, required: false },
  other: { allowed: false, required: false },
};

const requiredText: DeedEvidenceRequirements = {
  text: { allowed: true, required: true },
  url: { allowed: false, required: false },
  image: { allowed: false, required: false },
  other: { allowed: false, required: false },
};

const requiredUrl: DeedEvidenceRequirements = {
  text: { allowed: false, required: false },
  url: { allowed: true, required: true },
  image: { allowed: false, required: false },
  other: { allowed: false, required: false },
};

const combinedRequired: DeedEvidenceRequirements = {
  text: { allowed: true, required: true },
  url: { allowed: true, required: true },
  image: { allowed: true, required: false },
  other: { allowed: false, required: false },
};

function baseSafeDeed(overrides: Partial<SafeDeed> = {}): SafeDeed {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    slug: "test-deed",
    title: "Test",
    loreDescription: "Lore",
    instructions: "Do it",
    category: null,
    accessScope: "road",
    status: "active",
    reward: { type: "none" },
    evidenceRequirements: requiredText,
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

describe("evidence — requirements parsing", () => {
  it("required implies allowed", () => {
    const parsed = parseEvidenceRequirements({
      text: { allowed: false, required: true },
      url: { allowed: false, required: false },
      image: { allowed: false, required: false },
      other: { allowed: false, required: false },
    });
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.deepEqual(parsed.value.text, { allowed: true, required: true });
    }
  });

  it("malformed evidence_requirements fails closed", () => {
    const parsed = parseEvidenceRequirements({ text: true });
    assert.equal(parsed.ok, false);
    assert.deepEqual(parsed.value, EMPTY_EVIDENCE_REQUIREMENTS);

    const emptyObject = parseEvidenceRequirements({});
    assert.equal(emptyObject.ok, false);

    const unknownKeys = parseEvidenceRequirements({
      text: { allowed: true, required: false },
      url: { allowed: false, required: false },
      image: { allowed: false, required: false },
      other: { allowed: false, required: false },
      nested: { allowed: true, required: true },
    });
    assert.equal(unknownKeys.ok, false);

    const noneAllowed = parseEvidenceRequirements({
      text: { allowed: false, required: false },
      url: { allowed: false, required: false },
      image: { allowed: false, required: false },
      other: { allowed: false, required: false },
    });
    assert.equal(noneAllowed.ok, false);
    assert.deepEqual(noneAllowed.value, EMPTY_EVIDENCE_REQUIREMENTS);
  });
});

describe("evidence — validation", () => {
  it("required text accepted when present", () => {
    const result = validateSubmissionEvidence(requiredText, {
      text: "  did the thing  ",
    });
    assert.equal(result.valid, true);
    assert.equal(result.evidence.text, "did the thing");
  });

  it("required text rejected when blank", () => {
    const result = validateSubmissionEvidence(requiredText, { text: "   " });
    assert.equal(result.valid, false);
    assert.ok(
      result.errors.some((e) => e.code === "REQUIRED_TEXT_MISSING"),
    );
  });

  it("required URL rejects malformed URL", () => {
    const result = validateSubmissionEvidence(requiredUrl, {
      url: "javascript:alert(1)",
    });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.code === "INVALID_URL"));
  });

  it("URL accepts absolute http/https", () => {
    assert.equal(isAbsoluteHttpUrl("https://example.com/x"), true);
    assert.equal(isAbsoluteHttpUrl("http://example.com"), true);
    assert.equal(isAbsoluteHttpUrl("/relative"), false);
    assert.equal(isAbsoluteHttpUrl("data:text/plain,hi"), false);

    const https = validateSubmissionEvidence(requiredUrl, {
      url: "https://example.com/proof",
    });
    assert.equal(https.valid, true);
  });

  it("evidence supplied to disallowed type is rejected", () => {
    const result = validateSubmissionEvidence(allOptionalText, {
      text: "ok",
      url: "https://example.com",
    });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.code === "URL_NOT_ALLOWED"));
  });

  it("combined evidence works", () => {
    const result = validateSubmissionEvidence(combinedRequired, {
      text: "notes",
      url: "https://example.com/p",
      imagePath: "deeds/abc.png",
    });
    assert.equal(result.valid, true);
  });

  it("blank-only evidence normalizes away", () => {
    const normalized = normalizeSubmissionEvidence({
      text: "  ",
      url: "",
      other: null,
    });
    assert.deepEqual(normalized, {
      text: null,
      url: null,
      imagePath: null,
      other: null,
    });
  });

  it("no evidence is rejected", () => {
    const result = validateSubmissionEvidence(allOptionalText, {});
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.code === "NO_EVIDENCE"));
  });

  it("invalid requirements fail closed for submission validation", () => {
    const result = validateSubmissionEvidence(
      EMPTY_EVIDENCE_REQUIREMENTS,
      { text: "x" },
      { requirementsValid: false },
    );
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.code === "INVALID_REQUIREMENTS"));
  });
});

describe("deed state — listing and submission", () => {
  const now = new Date("2026-07-01T12:00:00.000Z");

  it("active public Deed is listable", () => {
    const result = isDeedPubliclyListable(baseSafeDeed(), now);
    assert.equal(result.listable, true);
    assert.equal(result.reason, "ok");
  });

  it("draft is not listable", () => {
    assert.equal(
      isDeedPubliclyListable(baseSafeDeed({ status: "draft" }), now).listable,
      false,
    );
  });

  it("non-public is not listable", () => {
    assert.equal(
      isDeedPubliclyListable(baseSafeDeed({ isPublic: false }), now).listable,
      false,
    );
  });

  it("future starts_at prevents listing/open state", () => {
    const deed = baseSafeDeed({
      startsAt: "2026-08-01T00:00:00.000Z",
    });
    assert.equal(isDeedPubliclyListable(deed, now).reason, "not_started");
    assert.equal(isDeedOpenForSubmission(deed, now).reason, "not_started");
  });

  it("expired ends_at prevents submission", () => {
    const deed = baseSafeDeed({
      endsAt: "2026-06-01T00:00:00.000Z",
    });
    assert.equal(isDeedOpenForSubmission(deed, now).reason, "ended");
    assert.equal(isDeedPubliclyListable(deed, now).reason, "ended");
  });

  it("max_completions prevents submission at cap", () => {
    const deed = baseSafeDeed({
      maxCompletions: 3,
      completionsCount: 3,
    });
    assert.equal(
      isDeedOpenForSubmission(deed, now).reason,
      "completion_cap_reached",
    );
  });

  it("closed Deed cannot accept submissions", () => {
    assert.equal(
      isDeedOpenForSubmission(baseSafeDeed({ status: "closed" }), now).reason,
      "closed",
    );
  });
});

describe("reward mapping and chosen amount", () => {
  it("fixed reward maps correctly", () => {
    const mapped = mapDbReward({
      reward_leaf_fixed: 40,
      reward_leaf_min: null,
      reward_leaf_max: null,
    });
    assert.deepEqual(mapped, {
      ok: true,
      reward: { type: "fixed", amount: 40 },
    });
  });

  it("valid range maps correctly", () => {
    const mapped = mapDbReward({
      reward_leaf_fixed: null,
      reward_leaf_min: 10,
      reward_leaf_max: 25,
    });
    assert.deepEqual(mapped, {
      ok: true,
      reward: { type: "range", min: 10, max: 25 },
    });
  });

  it("chosen amount outside range rejected", () => {
    const result = validateChosenApprovalReward(
      { type: "range", min: 10, max: 25 },
      26,
    );
    assert.equal(result.valid, false);
    assert.ok(result.errors.includes("AMOUNT_OUT_OF_RANGE"));
  });

  it("chosen fixed amount cannot differ", () => {
    const result = validateChosenApprovalReward(
      { type: "fixed", amount: 40 },
      39,
    );
    assert.equal(result.valid, false);
    assert.ok(result.errors.includes("AMOUNT_MUST_MATCH_FIXED"));
  });

  it("malformed/impossible DB reward shape is handled safely", () => {
    const mapped = mapDbReward({
      reward_leaf_fixed: 10,
      reward_leaf_min: 1,
      reward_leaf_max: 5,
    });
    assert.equal(mapped.ok, false);
    assert.deepEqual(mapped.reward, { type: "none" });

    const row: DeedRow = {
      id: "11111111-1111-4111-8111-111111111111",
      slug: "x",
      title: "t",
      lore_description: "l",
      instructions: "i",
      category: null,
      access_scope: "road",
      status: "active",
      reward_leaf_fixed: 10,
      reward_leaf_min: 1,
      reward_leaf_max: 5,
      evidence_requirements: requiredText,
      eligibility: {},
      starts_at: null,
      ends_at: null,
      max_completions: null,
      completions_count: 0,
      is_public: true,
      is_repeatable: false,
      sponsor_name: null,
      external_reward_note: null,
      published_at: null,
    };
    const safe = toSafeDeed(row);
    assert.deepEqual(safe.reward, { type: "none" });
  });
});

describe("moderation transitions", () => {
  it("pending → approved allowed", () => {
    assert.equal(
      canTransitionSubmissionStatus("pending", "approved").allowed,
      true,
    );
  });

  it("pending → rejected allowed", () => {
    assert.equal(
      canTransitionSubmissionStatus("pending", "rejected").allowed,
      true,
    );
  });

  it("approved → anything rejected", () => {
    assert.equal(
      canTransitionSubmissionStatus("approved", "rejected").allowed,
      false,
    );
    assert.equal(
      canTransitionSubmissionStatus("approved", "approved").allowed,
      false,
    );
    assert.equal(
      canTransitionSubmissionStatus("approved", "pending").allowed,
      false,
    );
  });

  it("rejected → anything rejected", () => {
    assert.equal(
      canTransitionSubmissionStatus("rejected", "approved").allowed,
      false,
    );
    assert.equal(
      canTransitionSubmissionStatus("rejected", "rejected").allowed,
      false,
    );
    assert.equal(
      canTransitionSubmissionStatus("rejected", "pending").allowed,
      false,
    );
  });
});
