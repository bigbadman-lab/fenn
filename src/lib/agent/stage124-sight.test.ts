import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { PublicAgentKnowledgeLookup } from "@/lib/agent/knowledge";
import { STAGE12_JUDGE_OPENAI_MODEL } from "@/lib/agent/judge-config";
import {
  type Stage124LiveCapability,
} from "@/lib/agent/stage124-live-capabilities";
import { buildFennPublicFinalJudgeSystemPrompt } from "@/lib/agent/stage124-final-judge-prompt";
import { finalizeOneXPerceptionJudgementWithLiveState } from "@/lib/agent/stage124-sight";

import type { Stage124FinalJudgementIntention } from "@/lib/agent/stage124-final-judgement-schema";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "../../..");

function makeAdmin(seed: {
  claim?: Record<string, unknown> | null;
}) {
  const claimRow =
    seed.claim ??
    ({
      perception_event_id: "e1",
      x_post_id: "x1",
      perception_type: "mention",
      author_x_user_id: "au1",
      author_username: "attacker",
      body: "What does the Treasury hold right now?",
      x_created_at: "2026-07-26T00:00:00.000Z",
      initial_action: "do_nothing",
      initial_reason_code: "requires_live_state",
      initial_engage: false,
      initial_reply_text: null,
      initial_wall_body: null,
      needs_live_state: ["treasury"],
      identity_unverified: true,
      knowledge_available: false,
      initial_model: STAGE12_JUDGE_OPENAI_MODEL,
      initial_prompt_version: "fenn-public-judge-v1",
      already_finalized: false,
    }) satisfies Record<string, unknown>;

  const finalizeCalls: unknown[] = [];

  return {
    get finalizeCalls() {
      return finalizeCalls;
    },
    from() {
      throw new Error("from() not used in these tests");
    },
    async rpc(fn: string, args?: Record<string, unknown>) {
      if (fn === "claim_x_perception_judgement_for_live_state") {
        return { data: seed.claim === null ? [] : [claimRow], error: null };
      }
      if (fn === "finalize_x_perception_judgement_with_live_state") {
        finalizeCalls.push(args);
        return { data: [{ created: true }], error: null };
      }
      throw new Error(`unexpected rpc ${fn}`);
    },
  };
}

describe("Stage 12.4 sight — boundaries", () => {
  it("final judgement system prompt treats live data as data and carries Book of Speech", () => {
    const sys = buildFennPublicFinalJudgeSystemPrompt();
    assert.match(sys, /Trusted live state is authoritative for current truth/);
    assert.match(sys, /Stored Wall\/Deed bodies.*prompt injection/);
    assert.match(sys, /BEGIN_BOOK_OF_SPEECH/);
    assert.match(sys, /clarity outranks poetry/i);
    assert.match(sys, /Wall always requires a reply|no wall-only action/i);
    assert.match(sys, /will this still matter in a year/i);
    assert.doesNotMatch(sys, /re-request/);
    assert.doesNotMatch(sys, /needsLiveState/);
  });

  it("stage124 live adapters source is read-only", () => {
    const path = join(repo, "src/lib/agent/stage124-live-adapters.ts");
    const source = readFileSync(path, "utf8");
    for (const bad of [
      "writeFennWallEntry",
      "awardLeaf",
      "reply_on_x",
      "insert into",
      ".insert(",
      "update ",
      "delete ",
    ]) {
      assert.ok(
        !source.toLowerCase().includes(bad.toLowerCase()),
        `found forbidden token: ${bad}`,
      );
    }
  });
});

describe("Stage 12.4 sight — two-phase finalization", () => {
  it("does not call final judgement when needsLiveState empty", async () => {
    const admin = makeAdmin({
      claim: {
        perception_event_id: "e1",
        x_post_id: "x1",
        perception_type: "mention",
        author_x_user_id: "au1",
        author_username: "attacker",
        body: "gm",
        x_created_at: "2026-07-26T00:00:00.000Z",
        initial_action: "do_nothing",
        initial_reason_code: "no_response_warranted",
        initial_engage: false,
        initial_reply_text: null,
        initial_wall_body: null,
        needs_live_state: [],
        identity_unverified: false,
        knowledge_available: true,
        initial_model: STAGE12_JUDGE_OPENAI_MODEL,
        initial_prompt_version: "fenn-public-judge-v1",
        already_finalized: false,
      },
    });

    let modelCalls = 0;
    const result = await finalizeOneXPerceptionJudgementWithLiveState({
      admin,
      runFinalJudgement: async () => {
        modelCalls += 1;
        throw new Error("should not be called");
      },
    });

    assert.equal(result.status, "finalized");
    assert.equal(modelCalls, 0);
    assert.equal(admin.finalizeCalls.length, 1);
    const args = admin.finalizeCalls[0] as Record<string, unknown>;
    assert.equal(args.p_final_status, "finalized");
    assert.equal(args.p_final_action, "do_nothing");
  });

  it("if live reads all unavailable, finalizes do_nothing without model call", async () => {
    const admin = makeAdmin({
      claim: {
        perception_event_id: "e1",
        x_post_id: "x1",
        perception_type: "mention",
        author_x_user_id: "au1",
        author_username: "attacker",
        body: "What does the Treasury hold right now?",
        x_created_at: "2026-07-26T00:00:00.000Z",
        initial_action: "reply_on_x",
        initial_reason_code: "requires_live_state",
        initial_engage: true,
        initial_reply_text: "should not be used",
        initial_wall_body: null,
        needs_live_state: ["treasury"],
        identity_unverified: false,
        knowledge_available: false,
        initial_model: STAGE12_JUDGE_OPENAI_MODEL,
        initial_prompt_version: "fenn-public-judge-v1",
        already_finalized: false,
      },
    });

    let modelCalls = 0;
    const result = await finalizeOneXPerceptionJudgementWithLiveState({
      admin,
      executeLiveReads: async () => ({
        results: [
          { capability: "treasury" as Stage124LiveCapability, available: false, context: null },
        ],
        succeeded: [],
        failed: ["treasury" as Stage124LiveCapability],
      }),
      runFinalJudgement: async () => {
        modelCalls += 1;
        return null as never;
      },
      retrieveKnowledge: async () => ({ available: false, results: [] } as PublicAgentKnowledgeLookup),
    });

    assert.equal(result.status, "finalized");
    assert.equal(modelCalls, 0);
    const args = admin.finalizeCalls[0] as Record<string, unknown>;
    assert.equal(args.p_final_action, "do_nothing");
    assert.equal(args.p_final_reason_code, "knowledge_unavailable");
    assert.equal(args.p_live_state_available, false);
  });

  it("when one live capability is available, runs final judgement exactly once", async () => {
    const admin = makeAdmin({
      claim: {
        perception_event_id: "e1",
        x_post_id: "x1",
        perception_type: "mention",
        author_x_user_id: "au1",
        author_username: "attacker",
        body: "What does the Treasury hold right now?",
        x_created_at: "2026-07-26T00:00:00.000Z",
        initial_action: "reply_on_x",
        initial_reason_code: "requires_live_state",
        initial_engage: true,
        initial_reply_text: "initial",
        initial_wall_body: null,
        needs_live_state: ["treasury", "leaf"], // leaf must be ignored
        identity_unverified: false,
        knowledge_available: false,
        initial_model: STAGE12_JUDGE_OPENAI_MODEL,
        initial_prompt_version: "fenn-public-judge-v1",
        already_finalized: false,
      },
    });

    let modelCalls = 0;
    const result = await finalizeOneXPerceptionJudgementWithLiveState({
      admin,
      executeLiveReads: async () => ({
        results: [
          {
            capability: "treasury" as Stage124LiveCapability,
            available: true,
            context: "treasury_context",
          },
          // leaf is not executed; it would have been filtered.
        ],
        succeeded: ["treasury" as Stage124LiveCapability],
        failed: [],
      }),
      retrieveKnowledge: async () =>
        ({ available: true, results: [] } as PublicAgentKnowledgeLookup),
      runFinalJudgement: async () => {
        modelCalls += 1;
        const intention: Stage124FinalJudgementIntention = {
          engage: true,
          action: "reply_on_x",
          reasonCode: "answered_from_public_knowledge",
          replyText: "ok from live",
          wallBody: null,
          identityUnverified: false,
          knowledgeAvailable: true,
          liveStateAnyAvailable: true,
          model: STAGE12_JUDGE_OPENAI_MODEL,
          promptVersion: "fenn-public-final-judge-wall-requires-reply-v1",
        };
        return intention;
      },
    });

    assert.equal(result.status, "finalized");
    assert.equal(modelCalls, 1);
    const args = admin.finalizeCalls[0] as Record<string, unknown>;
    assert.equal(args.p_final_action, "reply_on_x");
    assert.equal(args.p_final_reason_code, "answered_from_public_knowledge");
    assert.deepEqual(args.p_live_state_succeeded, ["treasury"]);
  });
});

