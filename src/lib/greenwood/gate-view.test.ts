import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  canSubmitGreenwoodEnter,
  resolveAuthGateBranch,
  viewFromAdmissionResult,
  viewFromGreenwoodStatus,
} from "./gate-view";

const here = dirname(fileURLToPath(import.meta.url));
const componentsRoot = join(here, "../../components/greenwood");
const appGreenwoodPage = join(here, "../../app/greenwood/page.tsx");

describe("resolveAuthGateBranch", () => {
  it("routes logged out users to login", () => {
    assert.equal(
      resolveAuthGateBranch({ authenticated: false, registered: false }),
      "login",
    );
  });

  it("routes authenticated unregistered users to register", () => {
    assert.equal(
      resolveAuthGateBranch({ authenticated: true, registered: false }),
      "register",
    );
  });

  it("routes registered users to status", () => {
    assert.equal(
      resolveAuthGateBranch({ authenticated: true, registered: true }),
      "status",
    );
  });
});

describe("viewFromGreenwoodStatus", () => {
  it("maps ineligible standing without inventing numbers", () => {
    const mapped = viewFromGreenwoodStatus({
      state: "ineligible",
      lifetimeLeaf: 18,
      threshold: 30,
      remainingLeaf: 12,
      greenwoodEnteredAt: null,
    });
    assert.equal(mapped.view, "ineligible");
    assert.deepEqual(mapped.standing, {
      lifetimeLeaf: 18,
      threshold: 30,
      remainingLeaf: 12,
    });
  });

  it("maps eligible standing", () => {
    const mapped = viewFromGreenwoodStatus({
      state: "eligible",
      lifetimeLeaf: 34,
      threshold: 30,
      remainingLeaf: 0,
      greenwoodEnteredAt: null,
    });
    assert.equal(mapped.view, "eligible");
    assert.equal(mapped.standing?.remainingLeaf, 0);
  });

  it("maps exact threshold as eligible standing input", () => {
    const mapped = viewFromGreenwoodStatus({
      state: "eligible",
      lifetimeLeaf: 30,
      threshold: 30,
      remainingLeaf: 0,
      greenwoodEnteredAt: null,
    });
    assert.equal(mapped.view, "eligible");
    assert.equal(mapped.standing?.lifetimeLeaf, 30);
    assert.equal(mapped.standing?.threshold, 30);
    assert.equal(mapped.standing?.remainingLeaf, 0);
  });

  it("maps above-threshold eligible standing", () => {
    const mapped = viewFromGreenwoodStatus({
      state: "eligible",
      lifetimeLeaf: 50,
      threshold: 30,
      remainingLeaf: 0,
      greenwoodEnteredAt: null,
    });
    assert.equal(mapped.view, "eligible");
    assert.equal(mapped.standing?.lifetimeLeaf, 50);
  });

  it("maps returning member with completed ceremony straight to interior", () => {
    const sigil = {
      slug: "ember-notch",
      asciiBody: "||",
      a11yLabel: "Ember notch",
      width: 2,
      height: 3,
      isFallback: false,
    };
    const mapped = viewFromGreenwoodStatus({
      state: "member",
      greenwoodEnteredAt: "2026-07-01T00:00:00.000Z",
      thresholdAtEntry: 30,
      lifetimeLeafAtEntry: 34,
      currentLifetimeLeaf: 34,
      standingRank: 2,
      standingTotalMembers: 5,
      sigil,
      arrivalCeremonyPending: false,
    });
    assert.equal(mapped.view, "interior");
    assert.deepEqual(mapped.member, {
      greenwoodEnteredAt: "2026-07-01T00:00:00.000Z",
      thresholdAtEntry: 30,
      lifetimeLeafAtEntry: 34,
      currentLifetimeLeaf: 34,
      standingRank: 2,
      standingTotalMembers: 5,
      sigil,
      arrivalCeremonyPending: false,
    });
  });

  it("maps member with pending arrival ceremony to ceremony view", () => {
    const mapped = viewFromGreenwoodStatus({
      state: "member",
      greenwoodEnteredAt: "2026-08-02T12:00:00.000Z",
      thresholdAtEntry: 30,
      lifetimeLeafAtEntry: 31,
      currentLifetimeLeaf: 31,
      standingRank: 1,
      standingTotalMembers: 1,
      sigil: null,
      arrivalCeremonyPending: true,
    });
    assert.equal(mapped.view, "member");
    assert.equal(mapped.member?.arrivalCeremonyPending, true);
  });
});

describe("viewFromAdmissionResult", () => {
  it("treats admitted as arrival ceremony recognition", () => {
    const mapped = viewFromAdmissionResult({
      status: "admitted",
      greenwoodEnteredAt: "2026-07-23T12:00:00.000Z",
      thresholdAtEntry: 30,
      lifetimeLeafAtEntry: 31,
      arrivalCeremonyPending: true,
    });
    assert.equal(mapped.view, "member");
    assert.equal(mapped.member?.lifetimeLeafAtEntry, 31);
    assert.equal(mapped.member?.arrivalCeremonyPending, true);
  });

  it("treats already_member with completed ceremony as interior", () => {
    const mapped = viewFromAdmissionResult({
      status: "already_member",
      greenwoodEnteredAt: "2026-07-01T00:00:00.000Z",
      thresholdAtEntry: 30,
      lifetimeLeafAtEntry: 30,
      arrivalCeremonyPending: false,
    });
    assert.equal(mapped.view, "interior");
    assert.equal(mapped.member?.lifetimeLeafAtEntry, 30);
  });

  it("maps not_eligible back to ineligible with server values", () => {
    const mapped = viewFromAdmissionResult({
      status: "not_eligible",
      lifetimeLeaf: 18,
      threshold: 30,
      remainingLeaf: 12,
    });
    assert.equal(mapped.view, "ineligible");
    assert.deepEqual(mapped.standing, {
      lifetimeLeaf: 18,
      threshold: 30,
      remainingLeaf: 12,
    });
  });
});

describe("canSubmitGreenwoodEnter", () => {
  it("allows eligible and enter_error only", () => {
    assert.equal(canSubmitGreenwoodEnter("eligible"), true);
    assert.equal(canSubmitGreenwoodEnter("enter_error"), true);
    assert.equal(canSubmitGreenwoodEnter("entering"), false);
    assert.equal(canSubmitGreenwoodEnter("ineligible"), false);
    assert.equal(canSubmitGreenwoodEnter("member"), false);
    assert.equal(canSubmitGreenwoodEnter("loading"), false);
    assert.equal(canSubmitGreenwoodEnter("status_error"), false);
  });
});

describe("greenwood gate source safety (Book of the Road threshold)", () => {
  it("gateway uses Stage 8.2 APIs and never hardcodes threshold eligibility", () => {
    const gateway = readFileSync(
      join(componentsRoot, "greenwood-gateway.tsx"),
      "utf8",
    );
    assert.match(gateway, /fetchGreenwoodStatus/);
    assert.match(gateway, /postGreenwoodEnter/);
    assert.match(gateway, /getAuthHeaders/);
    assert.match(gateway, /formatOutlawNumber/);
    assert.match(gateway, /GreenwoodGateStranger/);
    assert.match(gateway, /GreenwoodGateUnnamed/);
    assert.match(gateway, /configuredThreshold/);
    assert.doesNotMatch(gateway, /leafLifetimeEarned\s*>=\s*30/);
    assert.doesNotMatch(gateway, /threshold\s*===\s*30/);
    assert.match(gateway, /GreenwoodMember/);
    assert.match(gateway, /GreenwoodArrivalCeremony/);
    assert.doesNotMatch(gateway, /GreenwoodGateHoldingMessage/);
    assert.doesNotMatch(gateway, /GreenwoodGateInterior/);
    // Public path must not treat ENTER as authentication.
    assert.doesNotMatch(gateway, /login\(\)/);
    assert.doesNotMatch(gateway, /handlePublicEnter/);
  });

  it("page loads configured threshold from app_settings path (not invent 30)", () => {
    const page = readFileSync(appGreenwoodPage, "utf8");
    assert.match(page, /getConfiguredGreenwoodLifetimeThreshold/);
    assert.match(page, /configuredThreshold/);
    assert.doesNotMatch(page, /threshold\s*=\s*30/);
    assert.doesNotMatch(page, /lifetime_leaf_threshold["']\s*,\s*30/);
  });

  it("gate UI answers Road questions for every visitor state", () => {
    const gate = readFileSync(join(componentsRoot, "greenwood-gate.tsx"), "utf8");

    // Stranger — identity, earned entry, law, LEAF paths, free road
    assert.match(gate, /GreenwoodGateStranger/);
    assert.match(gate, /The oldest part of FENN/);
    assert.match(gate, /Entry is earned/);
    assert.match(gate, /formatStandingRequiredLaw/);
    assert.match(gate, /Camp, Deeds, and contribution/);
    assert.match(gate, /BECOME AN OUTLAW/);
    assert.match(gate, /RETURN TO THE MAP/);

    // Unnamed — wallet ≠ standing
    assert.match(gate, /GreenwoodGateUnnamed/);
    assert.match(gate, /Your wallet is known/);
    assert.match(gate, /Your name is not/);
    assert.match(gate, /CLAIM THE NAME/);
    assert.match(gate, /wallet alone cannot carry standing/i);

    // Below threshold — measurable standing + remaining + continuations
    assert.match(gate, /GreenwoodGateIneligible/);
    assert.match(gate, /STANDING/);
    assert.match(gate, /formatStandingFraction/);
    assert.match(gate, /formatStandingRemainLine/);
    assert.match(gate, /LEAF is not spent/);
    assert.match(gate, /GO TO CAMP/);
    assert.match(gate, /FIND A DEED/);
    assert.match(gate, /\/camp/);
    assert.match(gate, /\/deeds/);
    assert.match(gate, /\/#the-map/);
    assert.match(gate, /\/#outlaw-register/);
    assert.match(gate, /NOTHING IS SPENT HERE/i);

    // Eligible — standing met, CROSS ceremony preserved
    assert.match(gate, /GreenwoodGateEligible/);
    assert.match(gate, /You have reached the standing required/);
    assert.match(gate, /The Greenwood now opens/);
    assert.match(gate, /\[\s*CROSS\s*\]/);
    assert.doesNotMatch(gate, /auto.?admit/i);

    // Law + lore both present
    assert.match(gate, /The Greenwood remembers/);
    assert.match(gate, /THE LAW/);

    // Language: one word, one action — no ENTER overload for auth/membership
    assert.doesNotMatch(gate, /ENTER THE GREENWOOD/);
    assert.doesNotMatch(gate, /\[\s*ENTER\s*\]/);
    assert.doesNotMatch(gate, /RETURN TO THE ROAD/);

    // Error states keep continuations (no dead end)
    assert.match(gate, /THE GATE IS LISTENING/);
    assert.match(gate, /THE GATE CANNOT HEAR YOU/);
    assert.match(gate, /THE GATE DID NOT OPEN/);
    assert.doesNotMatch(gate, /progress|skeleton|spinner/i);

    // Standing is presentation of server numbers — not gamified bars
    assert.doesNotMatch(gate, /progress-bar|ProgressBar/i);
  });

  it("crossing frames still hold the final frame for 2000ms", () => {
    const frames = readFileSync(
      join(componentsRoot, "greenwood-frames.ts"),
      "utf8",
    );
    assert.match(frames, /holdMs:\s*2000/);
    assert.match(frames, /THE ROAD ENDS HERE/);
  });

  it("client enter helper posts no request payload", () => {
    const client = readFileSync(join(here, "client.ts"), "utf8");
    const enterFn = client.slice(client.indexOf("export async function postGreenwoodEnter"));
    assert.match(enterFn, /method:\s*"POST"/);
    assert.match(enterFn, /\/api\/greenwood\/enter/);
    assert.doesNotMatch(enterFn, /JSON\.stringify/);
    assert.doesNotMatch(enterFn, /^\s*body:/m);
    assert.doesNotMatch(enterFn, /p_profile_id/);
  });
});
