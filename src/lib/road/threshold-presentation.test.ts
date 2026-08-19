import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  formatStandingFraction,
  formatStandingRemainLine,
  formatStandingRequiredLaw,
  ROAD_THRESHOLD_CONTINUATIONS,
  standingFromLifetimeAndThreshold,
} from "@/lib/road/threshold-presentation";

describe("threshold presentation (Book of the Road)", () => {
  it("computes remaining without implying spend", () => {
    assert.deepEqual(standingFromLifetimeAndThreshold(12, 30), {
      current: 12,
      required: 30,
      remaining: 18,
    });
    assert.deepEqual(standingFromLifetimeAndThreshold(30, 30), {
      current: 30,
      required: 30,
      remaining: 0,
    });
    assert.deepEqual(standingFromLifetimeAndThreshold(40, 30), {
      current: 40,
      required: 30,
      remaining: 0,
    });
  });

  it("formats standing and law without hardcoding a world threshold", () => {
    const s = standingFromLifetimeAndThreshold(12, 30);
    assert.equal(formatStandingFraction(s), "12 / 30 LEAF");
    assert.equal(formatStandingRemainLine(s), "18 remain.");
    assert.equal(formatStandingRemainLine({ current: 29, required: 30, remaining: 1 }), "1 remains.");
    assert.equal(formatStandingRequiredLaw(30), "Standing required: 30 LEAF");
    assert.equal(formatStandingRequiredLaw(50), "Standing required: 50 LEAF");
  });

  it("exposes continuations that never leave a visitor without a next step", () => {
    assert.equal(ROAD_THRESHOLD_CONTINUATIONS.camp.href, "/camp");
    assert.equal(ROAD_THRESHOLD_CONTINUATIONS.deeds.href, "/deeds");
    assert.equal(ROAD_THRESHOLD_CONTINUATIONS.map.href, "/#the-map");
    assert.match(ROAD_THRESHOLD_CONTINUATIONS.register.label, /CLAIM A NAME/);
    assert.match(ROAD_THRESHOLD_CONTINUATIONS.claimName.label, /CLAIM A NAME/);
  });
});
