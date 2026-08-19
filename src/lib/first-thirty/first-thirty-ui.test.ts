import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  FIRST_THIRTY_CHECKLIST,
  FIRST_THIRTY_MILESTONE_LABELS,
  FIRST_THIRTY_REVEAL_TITLE,
  firstThirtyChecklistMarkLabel,
  firstThirtyChecklistMarks,
  firstThirtyThresholdTotal,
} from "@/lib/first-thirty/copy";
import {
  FIRST_THIRTY_DEEDS_COPY,
  FIRST_THIRTY_DEEDS_HREF,
  FIRST_THIRTY_FAILURE_COPY,
  FIRST_THIRTY_GREENWOOD_HREF,
  FIRST_THIRTY_INELIGIBLE_COPY,
  firstDeedEventFromTransition,
  firstThirtyEventSessionKey,
  firstThirtyJourneyPresentation,
  firstThirtyNextDescription,
  firstThirtyNextStepLines,
  firstThirtyPrimaryAction,
  formatActualLeafGrantLine,
  formatCompactFirstThirtyLine,
  formatEligibleExchangeQuiet,
  formatFirstThirtyLeafLine,
  shouldAnnounceFirstThirtyEvent,
  shouldShowActiveFirstThirty,
  shouldShowFirstThirtyJourneySurface,
  shouldShowGreenwoodOpenAction,
} from "@/lib/first-thirty/presentation";
import { CANOPY_DISPLAY } from "@/lib/site/world-vocabulary";
import {
  buildUnstartedFirstThirtyProgress,
  type SafeFirstThirtyProgress,
} from "@/lib/first-thirty/types";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "../../..");

function read(rel: string): string {
  return readFileSync(join(repo, rel), "utf8");
}

function activeProgress(
  partial: Partial<SafeFirstThirtyProgress> = {},
): SafeFirstThirtyProgress {
  const milestones = {
    firstCamp: false,
    thirdCamp: false,
    firstDeed: false,
    ...partial.milestones,
  };
  return {
    active: true,
    completed: false,
    terminated: false,
    greenwoodOpen: false,
    eligibleCampExchanges: 0,
    milestoneLeafGranted: 0,
    lifetimeLeaf: 0,
    leafUntilGreenwood: 30,
    nextMilestone: "first_camp",
    ...partial,
    milestones,
  };
}

describe("THE FIRST THIRTY — presentation helpers", () => {
  it("shows active progress only when backend reports active", () => {
    assert.equal(shouldShowActiveFirstThirty(activeProgress()), true);
    assert.equal(
      shouldShowActiveFirstThirty(
        activeProgress({ active: false, greenwoodOpen: true }),
      ),
      false,
    );
    assert.equal(shouldShowActiveFirstThirty(null), false);
  });

  it("hides inactive First Thirty checklist", () => {
    const inactive = buildUnstartedFirstThirtyProgress({
      lifetimeLeaf: 30,
      greenwoodThreshold: 30,
      isGreenwoodMember: false,
    });
    assert.equal(shouldShowActiveFirstThirty(inactive), false);
  });

  it("Greenwood members see open action, not active checklist", () => {
    const member = buildUnstartedFirstThirtyProgress({
      lifetimeLeaf: 5,
      greenwoodThreshold: 30,
      isGreenwoodMember: true,
    });
    assert.equal(shouldShowActiveFirstThirty(member), false);
    assert.equal(shouldShowGreenwoodOpenAction(member), true);
  });

  it("shows exact lifetime LEAF from progress, not assumed +10 steps", () => {
    const p = activeProgress({
      lifetimeLeaf: 17,
      leafUntilGreenwood: 13,
      milestones: { firstCamp: true, thirdCamp: true, firstDeed: false },
      milestoneLeafGranted: 13,
    });
    assert.equal(formatFirstThirtyLeafLine(p), "17 / 30 LEAF");
    assert.equal(formatCompactFirstThirtyLine(p), "FIRST THIRTY · 17 / 30");
    assert.equal(firstThirtyThresholdTotal(p), 30);
  });

  it("never uses raw message counts for progress lines", () => {
    const helpers = read("src/lib/first-thirty/presentation.ts");
    const camp = read("src/components/camp/camp-conversation.tsx");
    assert.doesNotMatch(helpers, /messages\.length|messageCount|localStorage/);
    assert.doesNotMatch(camp, /messages\.length\s*[+\-*/]|localStorage/);
    assert.match(helpers, /eligibleCampExchanges/);
  });

  it("first milestone actual grant formatting never shows +0", () => {
    assert.equal(formatActualLeafGrantLine(10), "+10 LEAF");
    assert.equal(formatActualLeafGrantLine(3), "+3 LEAF");
    assert.equal(formatActualLeafGrantLine(0), null);
    assert.equal(formatActualLeafGrantLine(-1), null);
  });

  it("quiet line for eligible second exchange uses trusted count", () => {
    const p = activeProgress({
      exchangeCounted: true,
      eligibleCampExchanges: 2,
      milestones: { firstCamp: true, thirdCamp: false, firstDeed: false },
      lifetimeLeaf: 10,
      leafUntilGreenwood: 20,
    });
    assert.equal(
      formatEligibleExchangeQuiet(p),
      "ONE MEANINGFUL EXCHANGE REMAINS",
    );
  });

  it("ineligible exchange (not counted) has no quiet progress", () => {
    const p = activeProgress({
      exchangeCounted: false,
      eligibleCampExchanges: 1,
    });
    assert.equal(formatEligibleExchangeQuiet(p), null);
  });

  it("session keys prevent replaying announcements", () => {
    const event = {
      milestone: "camp_first" as const,
      newlySatisfied: true,
      nominalGrant: 10,
      actualGrant: 10,
      greenwoodOpen: false,
    };
    const key = firstThirtyEventSessionKey({
      messageId: "msg-1",
      event,
      lifetimeLeaf: 10,
    });
    const seen = new Set<string>([key]);
    assert.equal(
      shouldAnnounceFirstThirtyEvent({ event, eventKey: key, seenKeys: seen }),
      false,
    );
    assert.equal(
      shouldAnnounceFirstThirtyEvent({
        event,
        eventKey: "ft:other:camp_first",
        seenKeys: seen,
      }),
      true,
    );
  });

  it("deed transition synthesizes trusted actual grant only after prior progress", () => {
    const previous = activeProgress({
      milestones: { firstCamp: true, thirdCamp: true, firstDeed: false },
      nextMilestone: "first_deed",
      lifetimeLeaf: 20,
      leafUntilGreenwood: 10,
    });
    const next: SafeFirstThirtyProgress = {
      ...previous,
      active: false,
      greenwoodOpen: true,
      milestones: { firstCamp: true, thirdCamp: true, firstDeed: true },
      milestoneGrants: { firstCamp: 10, thirdCamp: 10, firstDeed: 3 },
      lifetimeLeaf: 33,
      leafUntilGreenwood: 0,
      nextMilestone: null,
    };
    const event = firstDeedEventFromTransition({ previous, next });
    assert.ok(event);
    assert.equal(event!.actualGrant, 3);
    assert.equal(event!.greenwoodOpen, true);

    assert.equal(
      firstDeedEventFromTransition({ previous: null, next }),
      null,
    );
  });

  it("zero onboarding grant on first_deed transition is explicit zero", () => {
    const previous = activeProgress({
      milestones: { firstCamp: true, thirdCamp: true, firstDeed: false },
    });
    const next = activeProgress({
      active: false,
      greenwoodOpen: true,
      milestones: { firstCamp: true, thirdCamp: true, firstDeed: true },
      milestoneGrants: { firstCamp: 10, thirdCamp: 10, firstDeed: 0 },
      lifetimeLeaf: 30,
      leafUntilGreenwood: 0,
    });
    const event = firstDeedEventFromTransition({ previous, next });
    assert.equal(event?.actualGrant, 0);
    assert.equal(formatActualLeafGrantLine(event!.actualGrant), null);
  });

  it("checklist labels match THE FIRST THIRTY voice", () => {
    assert.equal(
      FIRST_THIRTY_MILESTONE_LABELS.firstCamp.completed,
      "THE FIRE HEARD YOU",
    );
    assert.equal(
      FIRST_THIRTY_MILESTONE_LABELS.thirdCamp.completed,
      "YOUR WORDS WERE KEPT",
    );
    assert.equal(
      FIRST_THIRTY_MILESTONE_LABELS.firstDeed.completed,
      "A DEED WAS WITNESSED",
    );
    assert.equal(
      FIRST_THIRTY_MILESTONE_LABELS.firstCamp.incomplete,
      "SPEAK SO THE FIRE MAY HEAR YOU",
    );
    assert.equal(
      FIRST_THIRTY_MILESTONE_LABELS.thirdCamp.incomplete,
      "LET YOUR WORDS CARRY FURTHER",
    );
    assert.equal(
      FIRST_THIRTY_MILESTONE_LABELS.firstDeed.incomplete,
      "A DEED MUST BE WITNESSED",
    );
    assert.equal(FIRST_THIRTY_CHECKLIST.firstCamp, "THE FIRE HEARD YOU");
    assert.equal(FIRST_THIRTY_CHECKLIST.thirdCamp, "YOUR WORDS WERE KEPT");
    assert.equal(FIRST_THIRTY_CHECKLIST.firstDeed, "A DEED WAS WITNESSED");
    assert.equal(
      firstThirtyChecklistMarkLabel("thirdCamp", false),
      "LET YOUR WORDS CARRY FURTHER",
    );
    assert.equal(
      firstThirtyChecklistMarkLabel("firstDeed", true),
      "A DEED WAS WITNESSED",
    );
  });

  it("zero-progress checklist is Camp → Camp → Deed, never Greenwood milestone", () => {
    const marks = firstThirtyChecklistMarks({
      firstCamp: false,
      thirdCamp: false,
      firstDeed: false,
    });
    assert.deepEqual(
      marks.map((m) => m.label),
      [
        "SPEAK SO THE FIRE MAY HEAR YOU",
        "LET YOUR WORDS CARRY FURTHER",
        "A DEED MUST BE WITNESSED",
      ],
    );
    assert.equal(marks.length, 3);
    assert.ok(marks.every((m) => !m.done));
  });

  it("10-LEAF (first CAMP done) labels first complete and third incomplete", () => {
    const marks = firstThirtyChecklistMarks({
      firstCamp: true,
      thirdCamp: false,
      firstDeed: false,
    });
    assert.equal(marks[0]?.label, "THE FIRE HEARD YOU");
    assert.equal(marks[0]?.done, true);
    assert.equal(marks[1]?.label, "LET YOUR WORDS CARRY FURTHER");
    assert.equal(marks[1]?.done, false);
    assert.equal(marks[2]?.label, "A DEED MUST BE WITNESSED");
  });

  it("acknowledgement titles never say GREENWOOD REMEMBERED", () => {
    assert.equal(
      FIRST_THIRTY_REVEAL_TITLE.camp_three,
      "YOUR WORDS WERE KEPT",
    );
    assert.equal(
      FIRST_THIRTY_REVEAL_TITLE.first_deed_witnessed,
      "A DEED WAS WITNESSED",
    );
    assert.equal(
      FIRST_THIRTY_REVEAL_TITLE.first_deed_greenwood_open,
      CANOPY_DISPLAY.hasOpened,
    );
  });

  it("Greenwood walk uses existing crossing route", () => {
    assert.equal(FIRST_THIRTY_GREENWOOD_HREF, "/greenwood?crossing=1");
    assert.equal(FIRST_THIRTY_DEEDS_HREF, "/deeds");
  });

  it("failure and ineligible copy stay non-technical", () => {
    assert.equal(FIRST_THIRTY_FAILURE_COPY.line1, "The words remain.");
    assert.match(FIRST_THIRTY_FAILURE_COPY.line2, /could not be counted/);
    assert.equal(
      FIRST_THIRTY_INELIGIBLE_COPY,
      "Not every word leaves a mark.",
    );
    assert.doesNotMatch(FIRST_THIRTY_FAILURE_COPY.line2, /rpc|sql|score|spam/i);
  });

  it("deeds pending copy does not grant LEAF", () => {
    assert.equal(
      FIRST_THIRTY_DEEDS_COPY.pendingWitness,
      "YOUR DEED IS WAITING TO BE WITNESSED",
    );
    assert.doesNotMatch(
      FIRST_THIRTY_DEEDS_COPY.pendingWitness,
      /\+\d+\s*LEAF/,
    );
  });
  it("quiet line for first counted exchange without full milestone thrash", () => {
    const p = activeProgress({
      exchangeCounted: true,
      eligibleCampExchanges: 1,
      milestones: { firstCamp: true, thirdCamp: false, firstDeed: false },
      lastEvent: undefined,
      lifetimeLeaf: 10,
      leafUntilGreenwood: 20,
    });
    // After first milestone, lastEvent present suppresses quiet — without event:
    const quiet = formatEligibleExchangeQuiet({
      ...p,
      milestones: { firstCamp: false, thirdCamp: false, firstDeed: false },
    });
    assert.match(quiet ?? "", /1 \/ 3 MEANINGFUL EXCHANGES/);
  });

  it("Greenwood-open state removes remaining checklist visibility", () => {
    const open = activeProgress({
      active: false,
      greenwoodOpen: true,
      lifetimeLeaf: 30,
      leafUntilGreenwood: 0,
      nextMilestone: null,
      milestones: { firstCamp: true, thirdCamp: true, firstDeed: true },
    });
    assert.equal(shouldShowActiveFirstThirty(open), false);
    assert.equal(shouldShowGreenwoodOpenAction(open), true);
  });
});

describe("THE FIRST THIRTY — UI source contracts", () => {
  it("reusable progress component uses trusted lifetime and ASCII markers", () => {
    const ui = read("src/components/first-thirty/first-thirty-progress.tsx");
    assert.match(ui, /lifetimeLeaf/);
    assert.match(ui, /leafUntilGreenwood/);
    assert.match(ui, /\[x\]/);
    assert.match(ui, /\[ \]/);
    assert.match(ui, /progress\.active/);
    assert.match(ui, /FIRST_THIRTY_GREENWOOD_HREF/);
    assert.match(ui, /\[ FIND A DEED \]/);
    assert.match(ui, /FIRST_THIRTY_DEEDS_HREF/);
    assert.match(ui, /firstThirtyChecklistMarks/);
    assert.doesNotMatch(ui, /completed:|not yet:/);
    assert.doesNotMatch(ui, /THE GREENWOOD REMEMBERED|GREENWOOD REMEMBERED/);
    assert.doesNotMatch(ui, /localStorage|messageCount|reward_recommendation/);
  });

  it("milestone acknowledge uses actualGrant and aria-live polite", () => {
    const ui = read(
      "src/components/first-thirty/first-thirty-acknowledge.tsx",
    );
    assert.match(ui, /actualGrant/);
    assert.match(ui, /aria-live="polite"/);
    assert.match(ui, /prefers-reduced-motion/);
    assert.match(ui, /formatActualLeafGrantLine/);
    assert.match(ui, /FIRST_THIRTY_REVEAL_TITLE/);
    assert.match(ui, /first_deed_witnessed/);
    assert.match(ui, /first_deed_greenwood_open/);
    assert.doesNotMatch(ui, /THE GREENWOOD REMEMBERED|GREENWOOD REMEMBERED/);
    assert.doesNotMatch(ui, /YOUR DEED WAS WITNESSED/);
    assert.match(ui, /WALK TO THE CANOPY|walkToGreenwood/);
    assert.match(ui, /FIRST_THIRTY_GREENWOOD_HREF/);
    assert.match(ui, /\[ FIND A DEED \]/);
    assert.match(ui, /formatActualLeafGrantLine\(actual\)/);
  });

  it("CAMP conversation uses API firstThirty and GET status, not invent progress", () => {
    const camp = read("src/components/camp/camp-conversation.tsx");
    assert.match(camp, /useFirstThirtyProgress/);
    assert.match(camp, /firstThirty/);
    assert.match(camp, /FirstThirtyAcknowledge/);
    assert.match(camp, /FirstThirtyProgressPanel/);
    assert.match(camp, /formatEligibleExchangeQuiet/);
    assert.match(camp, /firstThirtyUnavailable/);
    assert.match(camp, /FIRST_THIRTY_FAILURE_COPY/);
    assert.match(camp, /FIRST_THIRTY_INELIGIBLE_COPY/);
    assert.match(camp, /shouldAnnounceFirstThirtyEvent/);
    assert.match(camp, /seenEventsRef/);
    assert.doesNotMatch(camp, /localStorage/);
    assert.doesNotMatch(camp, /reward_recommendation|spam|repetition/i);
  });

  it("CAMP orientation uses First Thirty voice", () => {
    const ground = read("src/components/camp/camp-ground.tsx");
    assert.match(ground, /Speak with care/);
    assert.match(ground, /The Fire does not answer noise/);
    assert.match(ground, /Not every word leaves a mark/);
    assert.match(ground, /LEAF CAN BE FOUND HERE/);
    assert.match(ground, /CampLeafReadout/);
    assert.match(ground, /FirstThirtyProgressPanel/);
    assert.match(ground, /useFirstThirtyProgress/);
    // LEAF status + LEAF CAN BE FOUND HERE live once under the ASCII intro.
    assert.equal((ground.match(/<CampLeafReadout/g) ?? []).length, 1);
    assert.equal((ground.match(/LEAF CAN BE FOUND HERE/g) ?? []).length, 1);
    assert.match(ground, /camp__intro[\s\S]*camp__leaf-note[\s\S]*CampLeafReadout/);
    assert.doesNotMatch(ground, /camp__leaf-rule/);
  });

  it("send-message exposes firstThirtyUnavailable without blocking AI", () => {
    const send = read("src/lib/camp/send-message.ts");
    assert.match(send, /firstThirtyUnavailable/);
    assert.match(send, /applyFirstThirty/);
    const route = read("src/app/api/camp/[character]/messages/route.ts");
    assert.match(route, /firstThirtyUnavailable/);
  });

  it("Deeds surface pending / orientation / greenwood path without new routes", () => {
    const deeds = read(
      "src/components/first-thirty/first-thirty-deed-surface.tsx",
    );
    assert.match(deeds, /FIRST_THIRTY_DEEDS_COPY\.oneDeedRemains/);
    assert.match(deeds, /FIRST_THIRTY_DEEDS_COPY\.pendingWitness/);
    assert.match(deeds, /firstDeedEventFromTransition/);
    assert.match(deeds, /FIRST_THIRTY_GREENWOOD_HREF/);
    assert.match(deeds, /useFirstThirtyProgress/);
    const page = read("src/app/deeds/page.tsx");
    assert.match(page, /FirstThirtyDeedSurface/);
    const panel = read("src/components/deeds/deed-submission-panel.tsx");
    assert.match(panel, /FirstThirtyDeedSurface/);
    assert.match(panel, /YOUR DEED IS WAITING TO BE WITNESSED/);
  });

  it("exchangeCounted is surfaced on camp apply without schema change", () => {
    const service = read("src/lib/first-thirty/service.ts");
    assert.match(service, /exchangeCounted:\s*Boolean\(row\.counted\)/);
  });

  it("milestone grants exposed for post-approval discovery", () => {
    const types = read("src/lib/first-thirty/types.ts");
    assert.match(types, /milestoneGrants/);
    assert.match(types, /first_deed_leaf_granted/);
  });

  it("ordinary CAMP rewards remain rewardGranted display after First Thirty", () => {
    const camp = read("src/components/camp/camp-conversation.tsx");
    assert.match(camp, /rewardGranted/);
    assert.match(camp, /camp-talk__reward/);
    assert.match(camp, /\+\{message\.rewardGranted\}/);
  });

  it("CSS supports mobile, forced colours, reduced motion, no rounded cards", () => {
    const css = read("src/app/globals.css");
    assert.match(css, /\.ft-progress/);
    assert.match(css, /\.ft-reveal/);
    assert.match(css, /forced-colors:\s*active/);
    assert.match(css, /CanvasText/);
    assert.match(css, /prefers-reduced-motion:\s*reduce/);
    assert.match(css, /max-width:\s*360px/);
    assert.doesNotMatch(css, /\.ft-reveal[^{]*\{[^}]*border-radius/);
  });

  it("progress fetch failures leave CAMP usable", () => {
    const hook = read("src/hooks/use-first-thirty.ts");
    assert.match(hook, /bootstrapSeed|firstThirtySnapshot/);
    assert.match(hook, /\/api\/first-thirty/);
    const camp = read("src/components/camp/camp-conversation.tsx");
    assert.match(camp, /fetchedProgress/);
    // Conversation still renders when progress is null
    assert.match(camp, /camp-talk__form/);
  });

  it("Desk First Thirty summary remains operator-facing", () => {
    const panel = read("src/components/desk/desk-register-member-panel.tsx");
    assert.match(panel, /member\.firstThirty/);
    assert.match(panel, /Eligible Camp exchanges/);
    assert.match(panel, /Onboarding LEAF granted/);
  });

  it("does not add First Thirty to global shell Fire status", () => {
    const shell = read("src/components/shell/shell-fire-status.tsx");
    assert.doesNotMatch(shell, /FirstThirty|first-thirty|FIRST THIRTY/);
  });

  it("Greenwood arrival ceremony sources are unchanged in shape", () => {
    const ceremony = read(
      "src/components/greenwood/greenwood-arrival-ceremony.tsx",
    );
    assert.match(ceremony, /greenwood-arrival/);
    assert.doesNotMatch(ceremony, /FirstThirty|first_thirty/);
  });
});

describe("THE FIRST THIRTY — homepage and outlaw journey", () => {
  it("primary action maps from nextMilestone only (not raw LEAF)", () => {
    assert.deepEqual(
      firstThirtyPrimaryAction(
        activeProgress({ nextMilestone: "first_camp" }),
      ),
      { href: "/camp", label: "[ GO TO CAMP ]" },
    );
    assert.deepEqual(
      firstThirtyPrimaryAction(
        activeProgress({
          nextMilestone: "third_camp",
          milestones: { firstCamp: true, thirdCamp: false, firstDeed: false },
        }),
      ),
      { href: "/camp", label: "[ RETURN TO CAMP ]" },
    );
    assert.deepEqual(
      firstThirtyPrimaryAction(
        activeProgress({
          nextMilestone: "first_deed",
          milestones: { firstCamp: true, thirdCamp: true, firstDeed: false },
        }),
      ),
      { href: "/deeds", label: "[ FIND A DEED ]" },
    );
    assert.deepEqual(
      firstThirtyPrimaryAction(
        activeProgress({
          active: false,
          greenwoodOpen: true,
          nextMilestone: null,
          lifetimeLeaf: 30,
          leafUntilGreenwood: 0,
        }),
      ),
      {
        href: FIRST_THIRTY_GREENWOOD_HREF,
        label: CANOPY_DISPLAY.walkToLink,
      },
    );
    // high leaf without greenwoodOpen/active must not invent CAMPness from balance
    assert.equal(
      firstThirtyPrimaryAction(
        activeProgress({
          active: false,
          greenwoodOpen: false,
          lifetimeLeaf: 5,
          leafUntilGreenwood: 25,
          nextMilestone: null,
        }),
      ),
      null,
    );
  });

  it("next-step lines follow trusted milestone stage without status duplication", () => {
    const zero = firstThirtyNextDescription(
      activeProgress({ nextMilestone: "first_camp" }),
      "home",
    );
    assert.deepEqual(zero, ["The road begins in Camp."]);
    assert.equal(zero.filter((l) => l === "The road begins in Camp.").length, 1);
    assert.ok(!zero.some((l) => /Speak with care|Not every word/i.test(l)));

    const mid = firstThirtyNextDescription(
      activeProgress({
        nextMilestone: "third_camp",
        milestones: { firstCamp: true, thirdCamp: false, firstDeed: false },
        eligibleCampExchanges: 1,
      }),
      "home",
    );
    assert.ok(mid.some((l) => /Return to Camp/i.test(l)));
    assert.ok(mid.some((l) => /words carry further/i.test(l)));
    assert.ok(mid.some((l) => /2 MEANINGFUL EXCHANGES REMAIN/i.test(l)));
    assert.ok(!mid.some((l) => /Fire heard|Greenwood remembered/i.test(l)));

    const deed = firstThirtyNextDescription(
      activeProgress({
        nextMilestone: "first_deed",
        milestones: { firstCamp: true, thirdCamp: true, firstDeed: false },
      }),
      "home",
    );
    assert.deepEqual(deed, [
      "Offer a Deed to the world.",
      "The Greenwood opens when it is witnessed.",
    ]);
    assert.ok(!deed.some((l) => /Greenwood remembered/i.test(l)));

    // Alias still works
    assert.deepEqual(
      firstThirtyNextStepLines(
        activeProgress({ nextMilestone: "first_camp" }),
      ),
      ["The road begins in Camp."],
    );
  });

  it("homepage presentation separates body principle from next action", () => {
    const zero = firstThirtyJourneyPresentation(
      activeProgress({ nextMilestone: "first_camp" }),
      "home",
    );
    assert.ok(zero.bodyLines.some((l) => /first thirty leaves/i.test(l)));
    assert.deepEqual(zero.nextDescription, ["The road begins in Camp."]);
    assert.equal(zero.nextLabel, "NEXT");
    assert.equal(zero.showMilestoneList, true);
    // No shared string between body and next
    for (const line of zero.nextDescription) {
      assert.ok(!zero.bodyLines.includes(line));
    }
    assert.ok(!zero.bodyLines.some((l) => /Speak with care/i.test(l)));
    assert.ok(!zero.nextDescription.some((l) => /Speak with care/i.test(l)));

    const open = firstThirtyJourneyPresentation(
      activeProgress({
        active: false,
        greenwoodOpen: true,
        nextMilestone: null,
        lifetimeLeaf: 30,
        leafUntilGreenwood: 0,
      }),
      "home",
    );
    assert.equal(open.nextLabel, null);
    assert.deepEqual(open.nextDescription, []);
    assert.equal(open.showMilestoneList, false);
  });

  it("journey surface hiders: unauthenticated, unregistered, Greenwood members", () => {
    assert.equal(
      shouldShowFirstThirtyJourneySurface({
        authenticated: false,
        registered: false,
        greenwoodMember: false,
      }),
      false,
    );
    assert.equal(
      shouldShowFirstThirtyJourneySurface({
        authenticated: true,
        registered: true,
        greenwoodMember: true,
      }),
      false,
    );
    assert.equal(
      shouldShowFirstThirtyJourneySurface({
        authenticated: true,
        registered: true,
        greenwoodMember: false,
      }),
      true,
    );
  });

  it("homepage places First Thirty after welcome and before map identity", () => {
    const page = read("src/app/page.tsx");
    assert.match(page, /HomeFirstThirty/);
    const welcome = page.indexOf("<HomeWelcome");
    const journey = page.indexOf("<HomeFirstThirty");
    const identity = page.indexOf("<HomeIdentity");
    assert.ok(welcome >= 0 && journey > welcome && identity > journey);
  });

  it("homepage journey uses trusted hook and never celebrations", () => {
    const home = read("src/components/home/home-first-thirty.tsx");
    assert.match(home, /useFirstThirtyProgress/);
    assert.match(home, /greenwoodEnteredAt/);
    assert.match(home, /shouldShowFirstThirtyJourneySurface/);
    assert.doesNotMatch(home, /FirstThirtyAcknowledge|lastEvent|localStorage/);
  });

  it("shared journey component for home and outlaw", () => {
    const journey = read(
      "src/components/first-thirty/first-thirty-journey.tsx",
    );
    assert.match(journey, /surface:\s*"home"\s*\|\s*"outlaw"/);
    assert.match(journey, /firstThirtyJourneyPresentation/);
    assert.match(journey, /firstThirtyChecklistMarks/);
    assert.match(journey, /formatFirstThirtyLeafLine/);
    assert.match(journey, /FIRST_THIRTY_JOURNEY_COPY\.loading/);
    assert.match(journey, /FIRST_THIRTY_JOURNEY_COPY\.fetchFail/);
    assert.doesNotMatch(journey, /completed:|not yet:/);
    assert.doesNotMatch(journey, /THE GREENWOOD REMEMBERED|GREENWOOD REMEMBERED/);
    assert.doesNotMatch(journey, /lastEvent|newlySatisfied|router\.push/);
    assert.doesNotMatch(journey, /reward_recommendation|\"terminated\"/);
    assert.doesNotMatch(journey, /zeroBody|ft-journey__zero/);
    assert.match(journey, /aria-labelledby/);
    assert.match(journey, /\[x\]/);
  });

  it("/outlaw places journey after identity and before account LEAF", () => {
    const page = read("src/app/outlaw/page.tsx");
    assert.match(page, /OutlawFirstThirty/);
    assert.match(page, /known as/);
    assert.match(page, /OutlawWallet/);
    assert.match(page, /lifetime leaf/);
    const identityKnown = page.indexOf("known as");
    const journey = page.indexOf("<OutlawFirstThirty");
    const wallet = page.indexOf("<OutlawWallet");
    const account = page.indexOf("outlaw-page__account");
    assert.ok(identityKnown >= 0 && journey > identityKnown && wallet > journey);
    assert.ok(wallet < account);
  });

  it("hook never invents progress and reports failed without killing hosts", () => {
    const hook = read("src/hooks/use-first-thirty.ts");
    assert.match(hook, /failed/);
    assert.match(hook, /bootstrapSeed|Never invents zero progress/);
    assert.match(hook, /\/api\/first-thirty/);
    assert.doesNotMatch(hook, /localStorage|sessionStorage/);
    assert.doesNotMatch(hook, /leaf_balance\s*<\s*30|leafBalance\s*<\s*30/);
  });

  it("CSS journey compact mobile home and forced colours", () => {
    const css = read("src/app/globals.css");
    assert.match(css, /\.ft-journey/);
    assert.match(css, /\.home-first-thirty/);
    assert.match(css, /ft-journey__compact-next/);
    assert.match(css, /forced-colors:\s*active[\s\S]*ft-journey__title/);
    assert.doesNotMatch(css, /\.ft-journey[^{]*\{[^}]*border-radius:\s*[1-9]/);
  });

  it("does not auto-route on homepage or outlaw", () => {
    const home = read("src/components/home/home-first-thirty.tsx");
    const outlaw = read("src/components/outlaw/outlaw-first-thirty.tsx");
    const journey = read(
      "src/components/first-thirty/first-thirty-journey.tsx",
    );
    for (const source of [home, outlaw, journey]) {
      assert.doesNotMatch(source, /router\.(push|replace)|window\.location|redirect\(/);
    }
  });
});
