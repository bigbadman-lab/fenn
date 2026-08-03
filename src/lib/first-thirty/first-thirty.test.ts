import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  FIRST_THIRTY_ACK,
  FIRST_THIRTY_NOMINAL_GRANT,
  buildUnstartedFirstThirtyProgress,
  isFirstThirtySuppressingCamp,
  nextMilestoneFromFlags,
  progressFromRow,
} from "@/lib/first-thirty/types";
import { leafIdempotencyKeys } from "@/lib/leaf/validate";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "../../..");

function read(rel: string): string {
  return readFileSync(join(repo, rel), "utf8");
}

describe("THE FIRST THIRTY — pure progress helpers", () => {
  it("unstarted under threshold is active with first_camp next", () => {
    const p = buildUnstartedFirstThirtyProgress({
      lifetimeLeaf: 0,
      greenwoodThreshold: 30,
      isGreenwoodMember: false,
    });
    assert.equal(p.active, true);
    assert.equal(p.greenwoodOpen, false);
    assert.equal(p.nextMilestone, "first_camp");
    assert.equal(p.leafUntilGreenwood, 30);
    assert.equal(p.milestoneLeafGranted, 0);
  });

  it("unstarted at or above threshold is finished without grants", () => {
    const p = buildUnstartedFirstThirtyProgress({
      lifetimeLeaf: 30,
      greenwoodThreshold: 30,
      isGreenwoodMember: false,
    });
    assert.equal(p.active, false);
    assert.equal(p.terminated, true);
    assert.equal(p.greenwoodOpen, true);
    assert.equal(p.nextMilestone, null);
  });

  it("Greenwood members never open an active path", () => {
    const p = buildUnstartedFirstThirtyProgress({
      lifetimeLeaf: 5,
      greenwoodThreshold: 30,
      isGreenwoodMember: true,
    });
    assert.equal(p.active, false);
    assert.equal(p.greenwoodOpen, true);
  });

  it("suppresses ordinary CAMP only while active", () => {
    assert.equal(isFirstThirtySuppressingCamp({ active: true }), true);
    assert.equal(isFirstThirtySuppressingCamp({ active: false }), false);
  });

  it("next milestone order is camp_first → third → first_deed", () => {
    assert.equal(
      nextMilestoneFromFlags({
        active: true,
        firstCamp: false,
        thirdCamp: false,
        firstDeed: false,
      }),
      "first_camp",
    );
    assert.equal(
      nextMilestoneFromFlags({
        active: true,
        firstCamp: true,
        thirdCamp: false,
        firstDeed: false,
      }),
      "third_camp",
    );
    assert.equal(
      nextMilestoneFromFlags({
        active: true,
        firstCamp: true,
        thirdCamp: true,
        firstDeed: false,
      }),
      "first_deed",
    );
    assert.equal(
      nextMilestoneFromFlags({
        active: false,
        firstCamp: true,
        thirdCamp: true,
        firstDeed: false,
      }),
      null,
    );
  });

  it("progressFromRow closes active when Greenwood is already open", () => {
    const p = progressFromRow({
      row: {
        profile_id: "p",
        status: "active",
        eligible_camp_exchange_count: 1,
        first_camp_satisfied_at: "2026-01-01",
        third_camp_satisfied_at: null,
        first_deed_satisfied_at: null,
        first_camp_leaf_granted: 10,
        third_camp_leaf_granted: 0,
        first_deed_leaf_granted: 0,
        onboarding_leaf_granted: 10,
        finished_reason: null,
      },
      lifetimeLeaf: 30,
      greenwoodThreshold: 30,
      isGreenwoodMember: false,
    });
    assert.equal(p.active, false);
    assert.equal(p.greenwoodOpen, true);
    assert.equal(p.milestoneLeafGranted, 10);
  });

  it("locks nominal grant and ack copy", () => {
    assert.equal(FIRST_THIRTY_NOMINAL_GRANT, 10);
    assert.equal(FIRST_THIRTY_ACK.camp_first, "THE FIRE LEFT SOMETHING BEHIND");
    assert.equal(FIRST_THIRTY_ACK.camp_three, "THE GREENWOOD REMEMBERED");
    assert.equal(FIRST_THIRTY_ACK.first_deed, "THE GREENWOOD OPENS");
  });
});

describe("THE FIRST THIRTY — architecture wiring", () => {
  it("ledger source onboarding and idemp keys", () => {
    assert.equal(
      leafIdempotencyKeys.firstThirty("prof-1", "camp_first"),
      "first_thirty:prof-1:camp_first",
    );
    assert.equal(
      leafIdempotencyKeys.firstThirty("prof-1", "first_deed"),
      "first_thirty:prof-1:first_deed",
    );
    const award = read("src/lib/leaf/award.ts");
    assert.match(award, /onboarding/);
    const types = read("src/lib/leaf/types.ts");
    assert.match(types, /onboarding/);
  });

  it("migration adds source_type and RPCs", () => {
    const sql = read(
      "supabase/migrations/20260803110000_40_first_thirty.sql",
    );
    assert.match(sql, /'onboarding'/);
    assert.match(sql, /CREATE TABLE public\.first_thirty_progress/);
    assert.match(sql, /apply_first_thirty_camp_exchange/);
    assert.match(sql, /apply_first_thirty_first_deed/);
    assert.match(sql, /LEAST\(10, GREATEST\(0, v_threshold/);
    assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.apply_first_thirty_camp_exchange/);
  });

  it("migration 41 uses first_thirty_eligible not reward_recommendation gate", () => {
    const sql = read(
      "supabase/migrations/20260803120000_41_first_thirty_camp_eligibility.sql",
    );
    assert.match(sql, /first_thirty_eligible boolean/);
    assert.match(sql, /first_thirty_eligibility_reason/);
    assert.match(sql, /COALESCE\(v_msg\.first_thirty_eligible, false\)/);
    assert.doesNotMatch(
      sql,
      /COALESCE\(v_msg\.reward_recommendation, 0\) >= 1/,
    );
  });

  it("Camp send derives First Thirty eligibility separately from ordinary reward", () => {
    const send = read("src/lib/camp/send-message.ts");
    assert.match(send, /deriveFirstThirtyCampEligibility/);
    assert.match(send, /first_thirty_eligible/);
    assert.match(send, /firstThirtyEligibilityReason|first_thirty_eligibility_reason/);
    assert.match(send, /applyFirstThirty|apply_first_thirty/);
    assert.match(send, /suppressCamp|suppressOrdinaryCampReward|first_thirty_suppressed/);
  });

  it("Deed approval hooks first_deed after finalisation", () => {
    const mod = read("src/lib/deeds/moderation.ts");
    assert.match(mod, /applyFirstThirtyFirstDeed/);
    assert.match(mod, /first_thirty/);
  });

  it("member read path does not invent progress rows", () => {
    const service = read("src/lib/first-thirty/service.ts");
    assert.match(service, /buildUnstartedFirstThirtyProgress/);
    assert.match(service, /maybeSingle/);
    const route = read("src/app/api/first-thirty/route.ts");
    assert.match(route, /getFirstThirtyProgress/);
    assert.doesNotMatch(route, /insert\(|ensure_first_thirty/);
  });

  it("Desk register exposes First Thirty summary", () => {
    const types = read("src/lib/desk/register-types.ts");
    assert.match(types, /DeskRegisterFirstThirty/);
    const panel = read(
      "src/components/desk/desk-register-member-panel.tsx",
    );
    assert.match(panel, /THE FIRST THIRTY/);
  });
});
