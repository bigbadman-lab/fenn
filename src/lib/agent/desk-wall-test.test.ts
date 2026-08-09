import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { evaluateAuthorityDecision } from "@/lib/agent/authority-policy";
import {
  DESK_WALL_TEST_BODY,
  DESK_WALL_TEST_VERSION,
  DESK_WALL_TEST_X_POST_ID,
  deskWallTestIdempotencyKey,
  deskWallTestSourceExternalId,
} from "@/lib/agent/desk-wall-test";
import { validateWallEffectPayload } from "@/lib/agent/effect-payload";
import { stage12WallSourceExternalId } from "@/lib/wall/stage12-tool-contract";
import { validateWriteFennWallEntryInput } from "@/lib/wall/write";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "../../..");

function read(rel: string): string {
  return readFileSync(join(repo, rel), "utf8");
}

describe("Desk Wall-only agent test — contract", () => {
  it("uses fixed body, version, reserved synthetic snowflake", () => {
    assert.equal(
      DESK_WALL_TEST_BODY,
      "THE WALL HEARD THE MACHINE.\n\nfirst live signal received.",
    );
    assert.equal(DESK_WALL_TEST_VERSION, 1);
    assert.match(DESK_WALL_TEST_X_POST_ID, /^\d+$/);
    assert.equal(
      deskWallTestSourceExternalId(),
      `${DESK_WALL_TEST_X_POST_ID}:wall`,
    );
    assert.equal(
      deskWallTestIdempotencyKey(),
      stage12WallSourceExternalId(DESK_WALL_TEST_X_POST_ID),
    );
    assert.ok(DESK_WALL_TEST_BODY.length <= 4000);
    assert.doesNotMatch(DESK_WALL_TEST_BODY, /SECRET|TOKEN|0x|api[_-]?key/i);
  });

  it("authority path is wall-only for reserved Desk ops synthetic (allowOperationalWallOnly)", () => {
    const decision = evaluateAuthorityDecision({
      perceptionEventId: "00000000-0000-4000-8000-000000000001",
      judgementId: "00000000-0000-4000-8000-000000000002",
      xPostId: DESK_WALL_TEST_X_POST_ID,
      perceptionType: "mention",
      finalStatus: "finalized",
      finalAction: "write_to_wall",
      finalReplyText: null,
      finalWallBody: DESK_WALL_TEST_BODY,
      allowOperationalWallOnly: true,
    });
    assert.equal(decision.outcome, "permitted");
    assert.equal(decision.effects.length, 1);
    assert.equal(decision.effects[0]?.type, "write_to_wall");
    assert.doesNotMatch(JSON.stringify(decision.effects), /reply_on_x/);
    assert.equal(
      decision.effects[0]?.idempotencyKey,
      `${DESK_WALL_TEST_X_POST_ID}:wall`,
    );

    const liveDenied = evaluateAuthorityDecision({
      perceptionEventId: "00000000-0000-4000-8000-000000000001",
      judgementId: "00000000-0000-4000-8000-000000000002",
      xPostId: DESK_WALL_TEST_X_POST_ID,
      perceptionType: "mention",
      finalStatus: "finalized",
      finalAction: "write_to_wall",
      finalReplyText: null,
      finalWallBody: DESK_WALL_TEST_BODY,
    });
    assert.equal(liveDenied.policyCode, "wall_requires_reply");
  });

  it("payload validates with Stage 12 wall provenance lock", () => {
    const payload = {
      body: DESK_WALL_TEST_BODY,
      sourceType: "x_agent" as const,
      sourceExternalId: deskWallTestSourceExternalId(),
    };
    const ok = validateWallEffectPayload(payload, DESK_WALL_TEST_X_POST_ID);
    assert.equal(ok.body, DESK_WALL_TEST_BODY);
    assert.equal(ok.sourceType, "x_agent");
    validateWriteFennWallEntryInput({
      body: ok.body,
      sourceType: ok.sourceType,
      sourceExternalId: ok.sourceExternalId,
    });
  });
});

describe("Desk Wall-only agent test — source safety", () => {
  it("route requires Desk authority and confirmation only", () => {
    const route = read("src/app/api/desk/agent/wall-test/route.ts");
    assert.match(route, /requireFennDeskAccess/);
    assert.match(route, /confirm:\s*z\.literal\(true\)/);
    assert.match(route, /\.strict\(\)/);
    assert.match(route, /runDeskAgentWallTest/);
    assert.match(route, /desk\.agent\.wall_test_requested/);
    assert.match(route, /desk\.agent\.wall_test_completed/);
    assert.match(route, /desk\.agent\.wall_test_idempotent/);
    assert.match(route, /desk\.agent\.wall_test_failed/);
    assert.doesNotMatch(route, /body\.body|wallBody|inscriptionText/);
    assert.doesNotMatch(route, /createXReplyAsFenn|X_BEARER|pollXMentions/);
    assert.doesNotMatch(route, /executePendingXPerceptionEffects/);
  });

  it("service helper never imports X reply client or open queue execute", () => {
    const lib = read("src/lib/agent/desk-wall-test.ts");
    assert.match(lib, /writeFennWallEntry/);
    assert.match(lib, /claimXPerceptionEffect/);
    assert.match(lib, /write_to_wall/);
    assert.match(lib, /allowOperationalWallOnly:\s*true/);
    assert.match(lib, /xAttempted:\s*false/);
    assert.doesNotMatch(lib, /createXReplyAsFenn/);
    assert.doesNotMatch(lib, /from ["']@\/lib\/x\/write-client/);
    assert.doesNotMatch(lib, /executePendingXPerceptionEffects/);
    assert.doesNotMatch(lib, /runXAgentPipeline|pollXMentions|judgePending/);
    assert.doesNotMatch(lib, /runFennPublicJudgement/);
    assert.match(
      lib,
      /claimXPerceptionEffect\(\s*\{[\s\S]*xPostId:\s*DESK_WALL_TEST_X_POST_ID/,
    );
    assert.match(lib, /effectType !== "write_to_wall"/);
  });

  it("UI requires confirmation, states no X, links /wall", () => {
    const ui = read("src/components/desk/desk-agent-panel.tsx");
    assert.match(ui, /WALL EFFECT TEST/);
    assert.match(ui, /TEST WALL EFFECT/);
    assert.match(ui, /CONFIRM WALL TEST/);
    assert.match(ui, /does not post to X|Nothing will be sent to X/i);
    assert.match(ui, /THE AGENT REACHED THE WALL/);
    assert.match(ui, /THE TEST MARK IS ALREADY ON THE WALL/);
    assert.match(ui, /THE MACHINE DID NOT REACH THE WALL/);
    assert.match(ui, /href=["']\/wall["']/);
    assert.match(ui, /confirm:\s*true/);
    assert.match(ui, /LAST WALL TEST/);
    assert.doesNotMatch(
      ui,
      /createBrowserClient|SUPABASE_SERVICE|writeFennWallEntry/,
    );
  });

  it("CLI reuses the same helper and package script", () => {
    const script = read("scripts/agent-test-wall.ts");
    const pkg = read("package.json");
    assert.match(script, /runDeskAgentWallTest/);
    assert.doesNotMatch(script, /createXReplyAsFenn|pollXMentions/);
    assert.match(pkg, /"agent:test-wall"/);
  });

  it("health includes lastWallTest without tokens", () => {
    const lib = read("src/lib/desk/agent.ts");
    assert.match(lib, /lastWallTest/);
    assert.match(lib, /getDeskWallTestLastState/);
    assert.doesNotMatch(lib, /access_token|refresh_token/);
  });
});

describe("Desk Wall test — stability", () => {
  it("idempotency keys stay version-stable", () => {
    assert.equal(deskWallTestSourceExternalId(), deskWallTestSourceExternalId());
    assert.equal(deskWallTestIdempotencyKey(), deskWallTestSourceExternalId());
  });
});
