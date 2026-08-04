import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  announcementStyleFromMetadata,
  DEFAULT_GATHERING_ANNOUNCEMENT_STYLE,
  metadataWithAnnouncementStyle,
  parseGatheringAnnouncementStyle,
} from "@/lib/greenwood/gatherings/announcement-style";
import {
  GATHERING_DURATION_MAX_MINUTES,
  GATHERING_DURATION_MIN_MINUTES,
  isValidGatheringDurationMinutes,
} from "@/lib/greenwood/gatherings/duration";
import { deskFacingGatheringError } from "@/lib/desk/gathering-facing-errors";
import { GreenwoodError } from "@/lib/greenwood/errors";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "../../..");

function read(rel: string): string {
  return readFileSync(join(repo, rel), "utf8");
}

describe("Gathering announcement style metadata", () => {
  it("defaults missing and invalid values to quiet", () => {
    assert.equal(parseGatheringAnnouncementStyle(undefined), "quiet");
    assert.equal(parseGatheringAnnouncementStyle("nope"), "quiet");
    assert.equal(announcementStyleFromMetadata({}), "quiet");
    assert.equal(announcementStyleFromMetadata(null), "quiet");
    assert.equal(
      announcementStyleFromMetadata({ announcementStyle: "fire_calling" }),
      "fire_calling",
    );
    assert.equal(DEFAULT_GATHERING_ANNOUNCEMENT_STYLE, "quiet");
  });

  it("stores only the announcementStyle key without channel flags", () => {
    const meta = metadataWithAnnouncementStyle(
      { unrelated: true },
      "fire_calling",
    );
    assert.equal(meta.announcementStyle, "fire_calling");
    assert.equal(meta.unrelated, true);
    assert.equal("channels" in meta, false);
    assert.equal("homepage" in meta, false);
  });
});

describe("Gathering duration validation", () => {
  it("accepts whole minutes within bounds", () => {
    assert.equal(isValidGatheringDurationMinutes(5), true);
    assert.equal(isValidGatheringDurationMinutes(60), true);
    assert.equal(isValidGatheringDurationMinutes(720), true);
    assert.equal(isValidGatheringDurationMinutes(4), false);
    assert.equal(isValidGatheringDurationMinutes(721), false);
    assert.equal(isValidGatheringDurationMinutes(60.5), false);
    assert.equal(isValidGatheringDurationMinutes("60"), false);
    assert.equal(GATHERING_DURATION_MIN_MINUTES, 5);
    assert.equal(GATHERING_DURATION_MAX_MINUTES, 720);
  });
});

describe("Desk begin Gathering orchestration contracts", () => {
  it("begin route uses Desk auth, duration body, and orchestration helper", () => {
    const route = read("src/app/api/desk/gatherings/begin/route.ts");
    const begin = read("src/lib/desk/begin-gathering.ts");
    assert.match(route, /requireFennDeskAccess/);
    assert.match(route, /deskBeginGathering/);
    assert.match(route, /parseBeginGatheringBody/);
    assert.match(begin, /startsAt = new Date\(nowMs\)/);
    assert.match(begin, /durationMinutes \* 60_000/);
    assert.match(begin, /adminCreateGatheringDraft/);
    assert.match(begin, /adminPublishGathering/);
    assert.doesNotMatch(begin, /body\.startsAt|trusted client start/i);
  });

  it("CreateGatheringInput and admin insert accept announcementStyle metadata", () => {
    const adminOps = read("src/lib/greenwood/gatherings/admin-ops.ts");
    assert.match(adminOps, /announcementStyle/);
    assert.match(adminOps, /metadataWithAnnouncementStyle/);
    assert.match(adminOps, /metadata:/);
  });

  it("safe member projection includes announcementStyle only from metadata", () => {
    const memberOps = read("src/lib/greenwood/gatherings/member-ops.ts");
    assert.match(memberOps, /announcementStyleFromMetadata/);
    assert.match(memberOps, /announcementStyle:/);
  });
});

describe("Desk Gatherings Keeper UX contracts", () => {
  it("create form is duration-based without datetime-local fields", () => {
    const form = read("src/components/desk/desk-gathering-call-form.tsx");
    assert.match(form, /CALL A GATHERING/);
    assert.match(form, /WHY ARE WE GATHERING/);
    assert.match(form, /WHAT SHOULD OUTLAWS KNOW/);
    assert.match(form, /HOW LONG WILL THE GATHERING LAST/);
    assert.match(form, /WHO IS CALLED/);
    assert.match(form, /Greenwood members/);
    assert.match(form, /QUIET NOTICE/);
    assert.match(form, /THE FIRE CALLS/);
    assert.match(form, /BEGIN GATHERING/);
    assert.match(form, /LIMIT THE FIRE/);
    assert.match(form, /AFTER THE FIRE/);
    assert.match(form, /Possible Hollow reward/);
    assert.match(form, /LEAF is not granted automatically/);
    assert.doesNotMatch(form, /datetime-local/);
    assert.doesNotMatch(form, /all Outlaws|public visitors/i);
    assert.match(form, /\/api\/desk\/gatherings\/begin/);
    assert.match(form, /busy \|\| !formValid/);
  });

  it("preview reuses Fire card and Fire Calling banner", () => {
    const preview = read("src/components/desk/desk-gathering-preview.tsx");
    assert.match(preview, /HOW THE GREENWOOD WILL SEE IT/);
    assert.match(preview, /GatheringFireCard/);
    assert.match(preview, /GatheringCallBanner/);
    assert.match(preview, /fire_calling/);
    assert.match(preview, /not automatic/);
  });

  it("board groups LIVE / UPCOMING / AFTER THE FIRE and unfinished drafts", () => {
    const board = read("src/components/desk/desk-gatherings-board.tsx");
    assert.match(board, /LIVE/);
    assert.match(board, /UPCOMING/);
    assert.match(board, /AFTER THE FIRE/);
    assert.match(board, /UNFINISHED CALLS/);
    assert.match(board, /Call a Gathering/);
    assert.doesNotMatch(board, /closed_hands_no_campaign|Filter/);
  });

  it("operate mode end/cancel/hands/hollow with Keeper language", () => {
    const operate = read("src/components/desk/desk-gathering-operate.tsx");
    assert.match(operate, /THE FIRE IS BURNING/);
    assert.match(operate, /THE FIRE HAS GONE QUIET/);
    assert.match(operate, /END GATHERING/);
    assert.match(operate, /CANCEL GATHERING/);
    assert.match(operate, /CLOSE THE RECORD/);
    assert.match(operate, /CREATE HOLLOW CAMPAIGN/);
    assert.match(operate, /view hands/);
    assert.match(operate, /\/close/);
    assert.match(operate, /\/cancel/);
  });

  it("detail route supports resume draft and full operate", () => {
    const detail = read(
      "src/components/desk/desk-gathering-detail-panel.tsx",
    );
    assert.match(detail, /DeskGatheringOperate/);
    assert.match(detail, /DeskGatheringCallForm/);
    assert.match(detail, /resume call|UNFINISHED CALL/);
  });
});

describe("Greenwood Fire Calling member surface", () => {
  it("banner only for fire_calling scheduled/active and shares pulse parent", () => {
    const member = read("src/components/greenwood/greenwood-member.tsx");
    const banner = read(
      "src/components/greenwood/greenwood-gathering-call-banner.tsx",
    );
    const call = read("src/components/greenwood/gathering-call-banner.tsx");
    assert.match(member, /useGreenwoodFireGatherings/);
    assert.match(member, /GreenwoodGatheringCallBanner snapshot=/);
    assert.match(banner, /fire_calling/);
    assert.match(banner, /resolvedState !== "active"/);
    assert.doesNotMatch(banner, /handCount|attendance|openHand/i);
    assert.match(call, /THE FIRE IS CALLING|THE FIRE WILL CALL/);
    assert.match(call, /Go to the Fire|See the Gathering/);
    assert.doesNotMatch(call, /arrival_ceremony|greenwood_arrival/i);
  });

  it("does not wire homepage, outlaw, wall, speaks, or map gathering alerts", () => {
    const home = read("src/app/page.tsx");
    assert.doesNotMatch(home, /announcementStyle|fire_calling|greenwood_gatherings/i);
    const wallWrite = read("src/lib/wall/write.ts");
    assert.doesNotMatch(wallWrite, /gathering|announcementStyle/i);
  });
});

describe("Keeper-facing Gathering errors", () => {
  it("maps overlap and generic failures without SQL leakage", () => {
    assert.equal(
      deskFacingGatheringError(
        new GreenwoodError(
          "greenwood_gathering_overlap",
          "FENN_GATHERING_OVERLAP xyz",
          409,
        ),
      ),
      "Another Gathering already holds the Fire during this time.",
    );
    assert.equal(
      deskFacingGatheringError(
        new GreenwoodError(
          "greenwood_gathering_failed",
          "Duration must be a whole number between 5 and 720 minutes",
          400,
        ),
      ),
      "The duration must be between 5 minutes and 12 hours.",
    );
    assert.doesNotMatch(
      deskFacingGatheringError(
        new GreenwoodError(
          "greenwood_gathering_failed",
          "prevent_overlapping_fire_gatherings",
          500,
        ),
      ),
      /prevent_overlapping|23P01|PostgREST/i,
    );
  });
});

describe("No migration added for announcement styles", () => {
  it("persists announcement style via metadata helpers only", () => {
    assert.match(
      read("src/lib/greenwood/gatherings/announcement-style.ts"),
      /announcementStyle/,
    );
    assert.match(
      read("src/lib/greenwood/gatherings/admin-ops.ts"),
      /metadataWithAnnouncementStyle/,
    );
    assert.doesNotMatch(
      read("src/lib/greenwood/gatherings/admin-ops.ts"),
      /CREATE TABLE|ALTER TABLE/,
    );
  });
});
