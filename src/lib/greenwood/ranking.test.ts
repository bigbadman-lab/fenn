import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  computeGreenwoodStandingRank,
  toRomanNumeral,
  type GreenwoodStandingRow,
} from "./ranking";

describe("computeGreenwoodStandingRank", () => {
  it("ranks by leafLifetimeEarned desc", () => {
    const members: GreenwoodStandingRow[] = [
      { profileId: "a", outlawNumber: 2, leafLifetimeEarned: 10 },
      { profileId: "b", outlawNumber: 1, leafLifetimeEarned: 12 },
      { profileId: "c", outlawNumber: 9, leafLifetimeEarned: 11 },
    ];

    const rB = computeGreenwoodStandingRank({ profileId: "b", members });
    assert.deepEqual(rB, { rank: 1, total: 3 });

    const rA = computeGreenwoodStandingRank({ profileId: "a", members });
    assert.deepEqual(rA, { rank: 3, total: 3 });
  });

  it("breaks ties deterministically by outlawNumber asc", () => {
    const members: GreenwoodStandingRow[] = [
      { profileId: "a", outlawNumber: 7, leafLifetimeEarned: 10 },
      { profileId: "b", outlawNumber: 3, leafLifetimeEarned: 10 },
      { profileId: "c", outlawNumber: 5, leafLifetimeEarned: 10 },
    ];

    const rB = computeGreenwoodStandingRank({ profileId: "b", members });
    const rC = computeGreenwoodStandingRank({ profileId: "c", members });
    const rA = computeGreenwoodStandingRank({ profileId: "a", members });

    assert.deepEqual(rB, { rank: 1, total: 3 });
    assert.deepEqual(rC, { rank: 2, total: 3 });
    assert.deepEqual(rA, { rank: 3, total: 3 });
  });

  it("final tie-break uses profileId lexicographic order", () => {
    const members: GreenwoodStandingRow[] = [
      { profileId: "b", outlawNumber: 3, leafLifetimeEarned: 10 },
      { profileId: "a", outlawNumber: 3, leafLifetimeEarned: 10 },
    ];

    const rA = computeGreenwoodStandingRank({ profileId: "a", members });
    const rB = computeGreenwoodStandingRank({ profileId: "b", members });

    assert.deepEqual(rA, { rank: 1, total: 2 });
    assert.deepEqual(rB, { rank: 2, total: 2 });
  });
});

describe("toRomanNumeral", () => {
  it("renders common small ranks", () => {
    assert.equal(toRomanNumeral(1), "I");
    assert.equal(toRomanNumeral(4), "IV");
    assert.equal(toRomanNumeral(12), "XII");
    assert.equal(toRomanNumeral(39), "XXXIX");
  });

  it("falls back safely for out-of-range input", () => {
    assert.equal(toRomanNumeral(0), "?");
    assert.equal(toRomanNumeral(-2), "?");
    assert.equal(toRomanNumeral(5000), "5000");
  });
});

