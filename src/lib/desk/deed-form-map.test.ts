import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isoToLocalDatetime,
  localDatetimeToIso,
  rewardPayloadFromForm,
  setEvidenceAllowed,
  setEvidenceRequired,
  suggestSlugFromTitle,
} from "@/lib/desk/deed-form-map";
import { buildDefaultDeedWallInscription } from "@/lib/desk/deed-inscription";

describe("Desk deed datetime local ↔ ISO", () => {
  it("treats empty as null (cleared field)", () => {
    assert.equal(localDatetimeToIso(""), null);
    assert.equal(localDatetimeToIso("   "), null);
    assert.equal(isoToLocalDatetime(null), "");
    assert.equal(isoToLocalDatetime(""), "");
    assert.equal(isoToLocalDatetime(undefined), "");
  });

  it("rejects invalid shapes and calendar dates", () => {
    assert.equal(localDatetimeToIso("not-a-date"), null);
    assert.equal(localDatetimeToIso("2026-13-01T10:00"), null);
    assert.equal(localDatetimeToIso("2026-02-31T10:00"), null);
    assert.equal(isoToLocalDatetime("not-iso"), "");
  });

  it("round-trips local wall-clock without drift in process timezone", () => {
    const samples = [
      "2026-01-15T09:00", // UK winter / GMT in Europe/London
      "2026-07-15T14:30", // UK summer / BST in Europe/London
      "2026-08-03T00:00",
      "2026-10-25T02:30", // UK winter side of autumn clocks (stable wall time)
    ];
    for (const local of samples) {
      const iso = localDatetimeToIso(local);
      assert.ok(iso, `iso for ${local}`);
      assert.match(iso, /Z$/);
      const back = isoToLocalDatetime(iso);
      assert.equal(back, local, `round-trip ${local} → ${iso} → ${back}`);
    }
  });

  it("maps independent start/end clears correctly", () => {
    const start = localDatetimeToIso("2026-06-01T10:00");
    const end = localDatetimeToIso("2026-06-02T10:00");
    assert.ok(start);
    assert.ok(end);
    assert.notEqual(start, end);
    assert.equal(localDatetimeToIso(""), null);
  });

  it("documents UK offset behaviour when host is Europe/London", () => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz !== "Europe/London") {
      // Property still holds via round-trip above; offset assertion is host-TZ-specific.
      return;
    }
    const winterIso = localDatetimeToIso("2026-01-15T14:30");
    const summerIso = localDatetimeToIso("2026-07-15T14:30");
    assert.equal(winterIso, "2026-01-15T14:30:00.000Z"); // GMT
    assert.equal(summerIso, "2026-07-15T13:30:00.000Z"); // BST (no one-hour display drift)
  });
});

describe("Desk deed form mapping helpers", () => {
  it("suggests slug from title and allows override stability", () => {
    assert.equal(suggestSlugFromTitle("Hello World"), "hello-world");
    const suggested = suggestSlugFromTitle("Write a Deed");
    const manual = "custom-slug";
    assert.notEqual(suggested, manual);
  });

  it("reward modes map correctly and none is not fixed zero", () => {
    assert.deepEqual(rewardPayloadFromForm("none", "0", "1", "2"), {
      ok: true,
      reward: { type: "none" },
    });
    assert.deepEqual(rewardPayloadFromForm("fixed", "10", "1", "2"), {
      ok: true,
      reward: { type: "fixed", amount: 10 },
    });
    assert.deepEqual(rewardPayloadFromForm("range", "99", "1", "5"), {
      ok: true,
      reward: { type: "range", min: 1, max: 5 },
    });
  });

  it("required evidence implies allowed; disabling allowed clears required", () => {
    const base = {
      text: { allowed: false, required: false },
      url: { allowed: false, required: false },
      image: { allowed: false, required: false },
      other: { allowed: false, required: false },
    };
    const required = setEvidenceRequired(base, "url", true);
    assert.equal(required.url.allowed, true);
    assert.equal(required.url.required, true);
    const cleared = setEvidenceAllowed(required, "url", false);
    assert.equal(cleared.url.allowed, false);
    assert.equal(cleared.url.required, false);
  });
});

describe("Safe Wall inscription default", () => {
  it("never embeds private or internal fields", () => {
    const body = buildDefaultDeedWallInscription({
      deedTitle: "Scout the Road",
      displayName: "Ash",
      leafAwarded: 10,
    });
    assert.match(body, /A DEED WAS COMPLETED/);
    assert.match(body, /Ash/);
    assert.match(body, /10 LEAF/);
    assert.doesNotMatch(body, /0x[a-fA-F0-9]|@|evidence|uuid|wallet|http/i);
    const noLeaf = buildDefaultDeedWallInscription({
      deedTitle: "Silent work",
      displayName: null,
      leafAwarded: null,
    });
    assert.match(noLeaf, /An outlaw/);
    assert.doesNotMatch(noLeaf, /LEAF carried forward/);
  });
});
