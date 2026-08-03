import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_EVIDENCE_FORM,
  hasAnyAllowedEvidence,
  rewardPayloadFromForm,
  setEvidenceAllowed,
  setEvidenceRequired,
  suggestSlugFromTitle,
} from "@/lib/desk/deed-form-map";
import { buildDefaultDeedWallInscription } from "@/lib/desk/deed-inscription";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "../../..");

function read(rel: string): string {
  return readFileSync(join(repo, rel), "utf8");
}

describe("Desk deed form mapping", () => {
  it("suggests slug and preserves none reward", () => {
    assert.equal(suggestSlugFromTitle("Hello World"), "hello-world");
    const none = rewardPayloadFromForm("none", "", "", "");
    assert.equal(none.ok, true);
    if (none.ok) assert.equal(none.reward.type, "none");
    const fixed = rewardPayloadFromForm("fixed", "10", "", "");
    assert.equal(fixed.ok, true);
    if (fixed.ok && fixed.reward.type === "fixed") {
      assert.equal(fixed.reward.amount, 10);
    }
    const badRange = rewardPayloadFromForm("range", "", "5", "2");
    assert.equal(badRange.ok, false);
  });

  it("evidence required implies allowed; allowed off clears required", () => {
    let e = DEFAULT_EVIDENCE_FORM;
    e = setEvidenceRequired(e, "image", true);
    assert.equal(e.image.allowed, true);
    assert.equal(e.image.required, true);
    e = setEvidenceAllowed(e, "image", false);
    assert.equal(e.image.allowed, false);
    assert.equal(e.image.required, false);
    assert.equal(hasAnyAllowedEvidence(DEFAULT_EVIDENCE_FORM), true);
    const empty = setEvidenceAllowed(DEFAULT_EVIDENCE_FORM, "text", false);
    assert.equal(hasAnyAllowedEvidence(empty), false);
  });
});

describe("Default Wall inscription safety", () => {
  it("uses safe fields and never embeds evidence or ids", () => {
    const body = buildDefaultDeedWallInscription({
      deedTitle: "Leave a mark",
      displayName: "Rook",
      leafAwarded: 25,
    });
    assert.match(body, /A DEED WAS COMPLETED/);
    assert.match(body, /Rook/);
    assert.match(body, /Leave a mark/);
    assert.match(body, /25 LEAF/);
    assert.doesNotMatch(body, /evidence|wallet|0x|@|http|uuid|profile/i);

    const noLeaf = buildDefaultDeedWallInscription({
      deedTitle: "Quiet work",
      displayName: null,
      leafAwarded: 0,
    });
    assert.match(noLeaf, /An outlaw/);
    assert.doesNotMatch(noLeaf, /LEAF carried/);
  });
});

describe("Desk Deeds workspace UI wiring", () => {
  it("workspace tabs and definitions board call definition APIs", () => {
    const workspace = read("src/components/desk/desk-deeds-workspace.tsx");
    assert.match(workspace, /useSearchParams|"submissions"|"definitions"/);
    const board = read("src/components/desk/desk-deed-definitions-board.tsx");
    assert.match(board, /\/api\/desk\/deeds\?filter=/);
    assert.match(board, /WRITE A DEED/);
    assert.doesNotMatch(board, /actorId|FENN_ADMIN/);
    const nav = read("src/components/desk/desk-deeds-workspace-nav.tsx");
    assert.match(nav, /DEFINITIONS/);
    assert.match(nav, /SUBMISSIONS/);
  });

  it("form does not offer common scope", () => {
    const form = read("src/components/desk/desk-deed-definition-form.tsx");
    assert.match(form, /Road/);
    assert.match(form, /Greenwood/);
    assert.doesNotMatch(form, /accessScope === "common"|common scope/i);
    assert.doesNotMatch(form, /value=\"common\"/);
  });

  it("detail panel shares only approved unshared submissions", () => {
    const detail = read("src/components/desk/desk-deed-detail-panel.tsx");
    assert.match(detail, /INSCRIBE ON THE WALL/);
    assert.match(detail, /share-to-wall/);
    assert.match(detail, /wallShare\?\.shared|wallShare\.shared/);
    assert.match(detail, /buildDefaultDeedWallInscription/);
    assert.doesNotMatch(detail, /evidence_image_path|signedUrl.*wall/);
  });

  it("submission list surfaces WALL marker from wallShared", () => {
    const board = read("src/components/desk/desk-deeds-board.tsx");
    assert.match(board, /wallShared/);
    assert.match(board, /WALL/);
  });

  it("publish path keeps busy flag managed and uses confirm", () => {
    const panel = read("src/components/desk/desk-deed-definition-panel.tsx");
    assert.match(panel, /manageBusy: false/);
    assert.match(panel, /confirm: true/);
    assert.match(panel, /RELEASE INTO THE WORLD/);
    assert.match(panel, /previewFromForm/);
  });

  it("datetime helpers avoid Date.parse for datetime-local", () => {
    const map = read("src/lib/desk/deed-form-map.ts");
    assert.match(map, /new Date\(year, month - 1/);
    assert.doesNotMatch(map, /Date\.parse\(local\)/);
  });
});
