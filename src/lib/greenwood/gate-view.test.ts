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

  it("maps returning member straight to interior without admission ritual", () => {
    const mapped = viewFromGreenwoodStatus({
      state: "member",
      greenwoodEnteredAt: "2026-07-01T00:00:00.000Z",
      thresholdAtEntry: 30,
      lifetimeLeafAtEntry: 34,
    });
    assert.equal(mapped.view, "interior");
    assert.deepEqual(mapped.member, {
      greenwoodEnteredAt: "2026-07-01T00:00:00.000Z",
      thresholdAtEntry: 30,
      lifetimeLeafAtEntry: 34,
    });
  });
});

describe("viewFromAdmissionResult", () => {
  it("treats admitted as member recognition", () => {
    const mapped = viewFromAdmissionResult({
      status: "admitted",
      greenwoodEnteredAt: "2026-07-23T12:00:00.000Z",
      thresholdAtEntry: 30,
      lifetimeLeafAtEntry: 31,
    });
    assert.equal(mapped.view, "member");
    assert.equal(mapped.member?.lifetimeLeafAtEntry, 31);
  });

  it("treats already_member as interior success, not error", () => {
    const mapped = viewFromAdmissionResult({
      status: "already_member",
      greenwoodEnteredAt: "2026-07-01T00:00:00.000Z",
      thresholdAtEntry: 30,
      lifetimeLeafAtEntry: 30,
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

describe("greenwood gate source safety", () => {
  it("gateway uses Stage 8.2 APIs and never hardcodes threshold eligibility", () => {
    const gateway = readFileSync(
      join(componentsRoot, "greenwood-gateway.tsx"),
      "utf8",
    );
    assert.match(gateway, /fetchGreenwoodStatus/);
    assert.match(gateway, /postGreenwoodEnter/);
    assert.match(gateway, /getAuthHeaders/);
    assert.match(gateway, /formatOutlawNumber/);
    assert.match(gateway, /\/#outlaw-register/);
    assert.doesNotMatch(gateway, /leafLifetimeEarned\s*>=\s*30/);
    assert.doesNotMatch(gateway, /threshold\s*===\s*30/);
    assert.match(gateway, /GreenwoodMember/);
    assert.doesNotMatch(gateway, /GreenwoodGateHoldingMessage/);
    assert.doesNotMatch(gateway, /GreenwoodGateInterior/);
  });

  it("gate UI shows standing and closed wood for ineligible", () => {
    const gate = readFileSync(join(componentsRoot, "greenwood-gate.tsx"), "utf8");
    assert.match(gate, /YOUR STANDING/);
    assert.match(gate, /LIFETIME LEAF/);
    assert.match(gate, /LEAF REMAIN/);
    assert.match(gate, /THE WOOD REMAINS CLOSED/);
    assert.match(gate, /THE GATE IS LISTENING/);
    assert.match(gate, /THE GATE CANNOT HEAR YOU/);
    assert.match(gate, /THE GATE DID NOT OPEN/);
    assert.match(gate, /THE WOOD HAS HEARD ENOUGH/);
    assert.doesNotMatch(gate, /progress|skeleton|spinner/i);
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
