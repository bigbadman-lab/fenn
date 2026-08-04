import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildCreatePayload,
  emptyDeedFormValues,
  formValuesFromDefinition,
  validateForPublish,
} from "@/components/desk/desk-deed-definition-form";
import type { DeskDeedDefinition } from "@/lib/desk/deed-definition-types";
import {
  DEFAULT_EVIDENCE_FORM,
  NO_EVIDENCE_PAYLOAD,
  evidenceFromSimpleSelection,
  isNoEvidenceSelection,
  isSimpleEvidenceConfig,
  rewardPayloadFromForm,
  simpleEvidenceFromForm,
  suggestSlugFromTitle,
  toggleSimpleEvidence,
} from "@/lib/desk/deed-form-map";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "../../..");

function read(rel: string): string {
  return readFileSync(join(repo, rel), "utf8");
}

function baseDefinition(
  partial: Partial<DeskDeedDefinition> = {},
): DeskDeedDefinition {
  return {
    id: "deed-1",
    title: "Scout the ridge",
    loreDescription: "Along the ridge.",
    instructions: "Walk the ridge and return.",
    status: "draft",
    slug: "scout-the-ridge",
    category: null,
    accessScope: "road",
    reward: { type: "fixed", amount: 10 },
    evidenceRequirements: { ...DEFAULT_EVIDENCE_FORM },
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
    eligibility: {},
    sponsorContributionId: null,
    commonTargetCount: null,
    commonProgressCount: 0,
    createdAt: null,
    updatedAt: null,
    ...partial,
  };
}

describe("Write a Deed simplified authoring UI (source)", () => {
  it("exposes primary field labels and Advanced collapsed by default structure", () => {
    const form = read("src/components/desk/desk-deed-definition-form.tsx");
    assert.match(form, /What should Outlaws do\?/);
    assert.match(form, /Describe the deed/);
    assert.match(form, /How much LEAF is it worth\?/);
    assert.match(form, /How should they prove completion\?/);
    assert.match(form, /Who can complete it\?/);
    assert.match(form, /No reward/);
    assert.match(form, /Fixed reward/);
    assert.match(form, /Screenshot/);
    assert.match(form, /Written response/);
    assert.match(form, /No evidence/);
    assert.match(form, /Unlimited/);
    assert.match(form, /First 10/);
    assert.match(form, /Custom limit/);
    assert.match(form, /ADVANCED/);
    assert.match(form, /advancedOpen/);
    assert.match(form, /useState\(preferAdvancedOpen\)/);
    // Slug not a primary label
    assert.doesNotMatch(form, /label className="desk-register__field">\s*Slug/);
    assert.match(form, /Page path/);
    // Keeper-facing copy must not surface these schema phrases as labels.
    assert.doesNotMatch(form, />Access scope</);
    assert.doesNotMatch(form, /Evidence JSON/);
    assert.doesNotMatch(form, />Deed definition</i);
    assert.doesNotMatch(form, />Slug</);
  });

  it("panel shows live preview and Save Draft / Publish hierarchy", () => {
    const panel = read("src/components/desk/desk-deed-definition-panel.tsx");
    assert.match(panel, /WRITE A DEED/);
    assert.match(panel, /HOW OUTLAWS WILL SEE IT/);
    assert.match(panel, /Save Draft/);
    assert.match(panel, /Publish/);
    assert.match(panel, /desk-deed-write__btn--primary/);
    assert.match(panel, /DeskDeedPreview/);
    assert.match(panel, /previewFromForm/);
    assert.match(panel, /Stop accepting submissions/);
    assert.match(panel, /\/api\/desk\/deeds/);
    assert.match(panel, /\/publish/);
    assert.match(panel, /deferRedirect/);
    assert.doesNotMatch(panel, /Definition board/i);
  });
});

describe("Authoring form helpers and payload mapping", () => {
  it("defaults new form to fixed LEAF, screenshot, unlimited", () => {
    const v = emptyDeedFormValues();
    assert.equal(v.rewardMode, "fixed");
    assert.equal(v.fixedAmount, "25");
    assert.equal(v.capMode, "unlimited");
    assert.deepEqual(v.evidence, DEFAULT_EVIDENCE_FORM);
    assert.ok(v.evidence.image.required);
  });

  it("auto-suggests slug from title for new deeds; preserves existing slug when not auto", () => {
    assert.equal(suggestSlugFromTitle("Hello World"), "hello-world");
    const existing = formValuesFromDefinition(
      baseDefinition({ slug: "kept-slug", title: "Changed Title" }),
    );
    assert.equal(existing.slug, "kept-slug");
    assert.equal(existing.title, "Changed Title");
  });

  it("maps no reward and fixed reward payloads", () => {
    assert.deepEqual(rewardPayloadFromForm("none", "0", "", ""), {
      ok: true,
      reward: { type: "none" },
    });
    assert.deepEqual(rewardPayloadFromForm("fixed", "25", "", ""), {
      ok: true,
      reward: { type: "fixed", amount: 25 },
    });
    const noneVals = {
      ...emptyDeedFormValues(),
      title: "T",
      rewardMode: "none" as const,
      fixedAmount: "",
    };
    const noneBody = buildCreatePayload(noneVals);
    assert.ok(noneBody.ok);
    if (noneBody.ok) {
      assert.deepEqual(noneBody.body.reward, { type: "none" });
    }
    const fixedVals = {
      ...emptyDeedFormValues(),
      title: "T",
      rewardMode: "fixed" as const,
      fixedAmount: "40",
    };
    const fixedBody = buildCreatePayload(fixedVals);
    assert.ok(fixedBody.ok);
    if (fixedBody.ok) {
      assert.deepEqual(fixedBody.body.reward, { type: "fixed", amount: 40 });
    }
  });

  it("maps screenshot, link, written evidence and no-evidence exclusive choice", () => {
    const multi = evidenceFromSimpleSelection({
      screenshot: true,
      link: true,
      written: true,
      none: false,
    });
    assert.equal(multi.image.allowed && multi.image.required, true);
    assert.equal(multi.url.allowed && multi.url.required, true);
    assert.equal(multi.text.allowed && multi.text.required, true);
    assert.equal(multi.other.allowed, false);

    const none = evidenceFromSimpleSelection({
      screenshot: false,
      link: false,
      written: false,
      none: true,
    });
    assert.ok(isNoEvidenceSelection(none));
    assert.deepEqual(none, NO_EVIDENCE_PAYLOAD);
    assert.ok(isSimpleEvidenceConfig(none));

    const toggled = toggleSimpleEvidence(multi, "none");
    assert.ok(isNoEvidenceSelection(toggled));
    const back = toggleSimpleEvidence(toggled, "screenshot");
    assert.equal(back.image.required, true);
    assert.equal(isNoEvidenceSelection(back), false);
  });

  it("maps unlimited, first 10, and custom completion limits", () => {
    const unlimited = buildCreatePayload({
      ...emptyDeedFormValues(),
      title: "T",
      capMode: "unlimited",
      maxCompletions: "",
    });
    assert.ok(unlimited.ok);
    if (unlimited.ok) assert.equal(unlimited.body.maxCompletions, null);

    const first10 = buildCreatePayload({
      ...emptyDeedFormValues(),
      title: "T",
      capMode: "first10",
      maxCompletions: "10",
    });
    assert.ok(first10.ok);
    if (first10.ok) assert.equal(first10.body.maxCompletions, 10);

    const customBad = buildCreatePayload({
      ...emptyDeedFormValues(),
      title: "T",
      capMode: "custom",
      maxCompletions: "",
    });
    assert.equal(customBad.ok, false);

    const customOk = buildCreatePayload({
      ...emptyDeedFormValues(),
      title: "T",
      capMode: "custom",
      maxCompletions: "50",
    });
    assert.ok(customOk.ok);
    if (customOk.ok) assert.equal(customOk.body.maxCompletions, 50);
  });

  it("preserves range reward and complex evidence on load without losing data", () => {
    const range = formValuesFromDefinition(
      baseDefinition({
        reward: { type: "range", min: 3, max: 9 },
        externalRewardNote: "swag",
        evidenceRequirements: {
          text: { allowed: true, required: false },
          url: { allowed: true, required: true },
          image: { allowed: false, required: false },
          other: { allowed: true, required: false },
        },
      }),
    );
    assert.equal(range.rewardMode, "range");
    assert.equal(range.minAmount, "3");
    assert.equal(range.maxAmount, "9");
    assert.equal(range.externalRewardNote, "swag");
    assert.equal(isSimpleEvidenceConfig(range.evidence), false);
    const body = buildCreatePayload({ ...range, title: range.title });
    assert.ok(body.ok);
    if (body.ok) {
      assert.deepEqual(body.body.reward, { type: "range", min: 3, max: 9 });
      assert.equal(body.body.externalRewardNote, "swag");
      assert.deepEqual(body.body.evidenceRequirements, range.evidence);
    }
  });

  it("fills blank lore from instructions so publish requirements can pass", () => {
    const v = {
      ...emptyDeedFormValues(),
      title: "Title",
      instructions: "Do the thing.",
      loreDescription: "",
    };
    const body = buildCreatePayload(v);
    assert.ok(body.ok);
    if (body.ok) {
      assert.equal(body.body.loreDescription, "Do the thing.");
      assert.equal(body.body.instructions, "Do the thing.");
    }
  });

  it("validateForPublish requires instructions", () => {
    const missing = validateForPublish({
      ...emptyDeedFormValues(),
      title: "Has title",
      instructions: "",
    });
    assert.equal(missing.ok, false);
    if (!missing.ok) assert.equal(missing.field, "instructions");

    const ok = validateForPublish({
      ...emptyDeedFormValues(),
      title: "Has title",
      instructions: "Do it.",
      fixedAmount: "25",
    });
    assert.equal(ok.ok, true);
  });

  it("simple evidence selection serializes from form state", () => {
    const form = simpleEvidenceFromForm(
      evidenceFromSimpleSelection({
        screenshot: true,
        link: false,
        written: false,
        none: false,
      }),
    );
    assert.deepEqual(form, {
      screenshot: true,
      link: false,
      written: false,
      none: false,
    });
  });
});

describe("Live deed remains read-only in panel source", () => {
  it("marks non-draft as readOnly and shows inspect language", () => {
    const panel = read("src/components/desk/desk-deed-definition-panel.tsx");
    assert.match(panel, /status !== "draft"/);
    assert.match(panel, /readOnly/);
    assert.match(panel, /for inspection/);
  });
});
