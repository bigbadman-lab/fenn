/**
 * Stage 3 — Chronicler: significance, pure evaluate, authorize integration.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { PublicFactEvidence } from "@/lib/agent/public-fact-evidence";
import {
  buildChroniclerFingerprint,
  evaluatePublicFactSignificance,
  OUTLAW_COUNT_MILESTONES,
} from "@/lib/agent/chronicler-significance";
import { evaluateChroniclerWallAdmission } from "@/lib/agent/chronicler-evaluate";
import { normalizeWallCandidate } from "@/lib/agent/wall-candidate-schema";
import { authorizeOneXPerception } from "@/lib/agent/stage125-authorize";
import { evaluateAuthorityDecision } from "@/lib/agent/authority-policy";
import { STAGE12_JUDGE_OPENAI_MODEL } from "@/lib/agent/judge-config";
import { isHardBlockReasonCode } from "@/lib/agent/reply-guarantee-policy";

function evidence(
  key: PublicFactEvidence["key"],
  value: PublicFactEvidence["value"],
  detail?: string | null,
): PublicFactEvidence {
  return {
    key,
    available: true,
    value,
    detail: detail ?? null,
    observedAt: "2026-08-06T00:00:00.000Z",
    source: "test",
    privacy: "public_aggregate",
  };
}

describe("Stage 3 Chronicler fingerprints and significance", () => {
  it("builds exact count fingerprints", () => {
    assert.equal(
      buildChroniclerFingerprint(evidence("confirmed_outlaw_count", 2)),
      "confirmed_outlaw_count:v=2",
    );
    assert.equal(
      buildChroniclerFingerprint(evidence("greenwood_member_count", 1)),
      "greenwood_member_count:v=1",
    );
  });

  it("admits outlaw milestones and rejects non-milestones", () => {
    for (const n of OUTLAW_COUNT_MILESTONES) {
      const r = evaluatePublicFactSignificance(
        evidence("confirmed_outlaw_count", n),
        "milestone_reached",
      );
      assert.equal(r.ok, true, `milestone ${n}`);
    }
    assert.equal(
      evaluatePublicFactSignificance(
        evidence("confirmed_outlaw_count", 4),
        "milestone_reached",
      ).ok,
      false,
    );
  });

  it("admits greenwood first member and listed milestones", () => {
    assert.equal(
      evaluatePublicFactSignificance(
        evidence("greenwood_member_count", 1),
        "first_observation",
      ).ok,
      true,
    );
    assert.equal(
      evaluatePublicFactSignificance(
        evidence("greenwood_member_count", 2),
        "milestone_reached",
      ).ok,
      false,
    );
    assert.equal(
      evaluatePublicFactSignificance(
        evidence("greenwood_member_count", 3),
        "milestone_reached",
      ).ok,
      true,
    );
  });

  it("threshold and token use new-fingerprint significance", () => {
    assert.equal(
      evaluatePublicFactSignificance(
        evidence("greenwood_leaf_threshold", 30),
        "meaningful_state_change",
      ).ok,
      true,
    );
    assert.equal(
      buildChroniclerFingerprint(
        evidence("greenwood_leaf_threshold", 30),
      ),
      "greenwood_leaf_threshold:v=30",
    );
    assert.equal(
      evaluatePublicFactSignificance(
        evidence(
          "official_fenn_token",
          true,
          "symbol=FENN; contract=0x" + "ab".repeat(20),
        ),
        "first_observation",
      ).ok,
      true,
    );
  });
});

describe("Stage 3 Wall candidate normalize", () => {
  it("requires dual action", () => {
    assert.equal(
      normalizeWallCandidate({
        raw: {
          kind: "public_fact",
          factKey: "confirmed_outlaw_count",
          factFingerprint: "confirmed_outlaw_count:v=2",
          reason: "milestone_reached",
        },
        action: "reply_on_x",
        trustedFacts: [evidence("confirmed_outlaw_count", 2)],
      }),
      null,
    );
  });

  it("requires matching trusted fingerprint", () => {
    assert.equal(
      normalizeWallCandidate({
        raw: {
          kind: "public_fact",
          factKey: "confirmed_outlaw_count",
          factFingerprint: "confirmed_outlaw_count:v=99",
          reason: "milestone_reached",
        },
        action: "reply_and_write_to_wall",
        trustedFacts: [evidence("confirmed_outlaw_count", 2)],
      }),
      null,
    );
  });

  it("accepts exact trusted fingerprint", () => {
    const c = normalizeWallCandidate({
      raw: {
        kind: "public_fact",
        factKey: "confirmed_outlaw_count",
        factFingerprint: "confirmed_outlaw_count:v=2",
        reason: "milestone_reached",
      },
      action: "reply_and_write_to_wall",
      trustedFacts: [evidence("confirmed_outlaw_count", 2)],
    });
    assert.ok(c);
    assert.equal(c!.kind, "public_fact");
  });

  it("declaration requires constitutional_declaration and mode", () => {
    assert.ok(
      normalizeWallCandidate({
        raw: {
          kind: "declaration",
          declarationKey: "greenwood.entrance_law",
          reason: "constitutional_declaration",
        },
        action: "reply_and_write_to_wall",
        responseMode: "creation",
      }),
    );
    assert.equal(
      normalizeWallCandidate({
        raw: {
          kind: "declaration",
          declarationKey: "greenwood.entrance_law",
          reason: "milestone_reached",
        },
        action: "reply_and_write_to_wall",
        responseMode: "creation",
      }),
      null,
    );
  });
});

describe("Stage 3 pure Chronicler admission", () => {
  it("no candidate → suppress on dual", () => {
    const r = evaluateChroniclerWallAdmission({
      finalAction: "reply_and_write_to_wall",
      finalReplyText: "Two Outlaws are confirmed.",
      finalWallBody: "THE REGISTER KEEPS TWO NAMES.",
      wallCandidate: null,
      trustedFacts: [evidence("confirmed_outlaw_count", 2)],
      alreadyRemembered: false,
    });
    assert.equal(r.decision, "suppress_wall");
    assert.equal(r.code, "no_candidate");
  });

  it("invalid fingerprint → suppress", () => {
    const r = evaluateChroniclerWallAdmission({
      finalAction: "reply_and_write_to_wall",
      finalReplyText: "Many?",
      finalWallBody: "MANY.",
      wallCandidate: {
        kind: "public_fact",
        factKey: "confirmed_outlaw_count",
        factFingerprint: "confirmed_outlaw_count:v=9",
        reason: "milestone_reached",
      },
      trustedFacts: [evidence("confirmed_outlaw_count", 2)],
      alreadyRemembered: false,
    });
    assert.ok(
      r.decision === "invalid_candidate" || r.decision === "suppress_wall",
    );
  });

  it("admits unseen count=2; suppresses if remembered", () => {
    const base = {
      finalAction: "reply_and_write_to_wall" as const,
      finalReplyText: "Two Outlaws are confirmed in the Register.",
      finalWallBody: "THE REGISTER KEEPS TWO NAMES.",
      wallCandidate: {
        kind: "public_fact" as const,
        factKey: "confirmed_outlaw_count" as const,
        factFingerprint: "confirmed_outlaw_count:v=2",
        reason: "milestone_reached" as const,
      },
      trustedFacts: [evidence("confirmed_outlaw_count", 2)],
    };
    const ok = evaluateChroniclerWallAdmission({
      ...base,
      alreadyRemembered: false,
    });
    assert.equal(ok.decision, "allow_wall");
    const blocked = evaluateChroniclerWallAdmission({
      ...base,
      alreadyRemembered: true,
    });
    assert.equal(blocked.decision, "suppress_wall");
    assert.equal(blocked.code, "already_remembered");
  });

  it("count 3 milestone admit when unseen", () => {
    const r = evaluateChroniclerWallAdmission({
      finalAction: "reply_and_write_to_wall",
      finalReplyText: "Three names.",
      finalWallBody: "THREE NAMES KEPT.",
      wallCandidate: {
        kind: "public_fact",
        factKey: "confirmed_outlaw_count",
        factFingerprint: "confirmed_outlaw_count:v=3",
        reason: "milestone_reached",
      },
      trustedFacts: [evidence("confirmed_outlaw_count", 3)],
      alreadyRemembered: false,
    });
    assert.equal(r.decision, "allow_wall");
  });

  it("non-milestone count suppressed", () => {
    const r = evaluateChroniclerWallAdmission({
      finalAction: "reply_and_write_to_wall",
      finalReplyText: "Four.",
      finalWallBody: "FOUR.",
      wallCandidate: {
        kind: "public_fact",
        factKey: "confirmed_outlaw_count",
        factFingerprint: "confirmed_outlaw_count:v=4",
        reason: "milestone_reached",
      },
      trustedFacts: [evidence("confirmed_outlaw_count", 4)],
      alreadyRemembered: false,
    });
    assert.equal(r.decision, "suppress_wall");
    assert.equal(r.code, "significance_rejected");
  });

  it("routine fact mode cannot use declaration", () => {
    const r = evaluateChroniclerWallAdmission({
      finalAction: "reply_and_write_to_wall",
      finalReplyText: "two",
      finalWallBody: "TWO.",
      wallCandidate: {
        kind: "declaration",
        declarationKey: "outlaw.count",
        reason: "constitutional_declaration",
      },
      trustedFacts: [evidence("confirmed_outlaw_count", 2)],
      alreadyRemembered: false,
      responseMode: "fact",
    });
    // normalize may null candidate for fact+declaration, then suppress/no_candidate
    assert.notEqual(r.decision, "allow_wall");
  });

  it("creation declaration may be admitted", () => {
    const r = evaluateChroniclerWallAdmission({
      finalAction: "reply_and_write_to_wall",
      finalReplyText: "Leave the Greenwood richer than you found it.",
      finalWallBody: "LEAVE THE GREENWOOD RICHER THAN YOU FOUND IT.",
      wallCandidate: {
        kind: "declaration",
        declarationKey: "greenwood.entrance_law",
        reason: "constitutional_declaration",
      },
      trustedFacts: [],
      alreadyRemembered: false,
      responseMode: "creation",
    });
    assert.equal(r.decision, "allow_wall");
  });

  it("missing wall body invalidates", () => {
    const r = evaluateChroniclerWallAdmission({
      finalAction: "reply_and_write_to_wall",
      finalReplyText: "ok",
      finalWallBody: null,
      wallCandidate: {
        kind: "historic_exchange",
        reason: "exceptional_exchange",
      },
      trustedFacts: [],
      alreadyRemembered: false,
      responseMode: "judgement",
    });
    assert.equal(r.decision, "invalid_candidate");
    assert.equal(r.code, "missing_wall_body");
  });

  it("new gathering admitted; same fingerprint remembered suppressed", () => {
    const facts = [
      evidence(
        "current_public_gathering",
        true,
        "starts_at=2026-08-01T00:00:00.000Z;ends_at=2026-08-07T00:00:00.000Z",
      ),
    ];
    const fp = buildChroniclerFingerprint(facts[0]!);
    assert.equal(
      fp,
      "current_public_gathering:id=2026-08-01T00:00:00.000Z|2026-08-07T00:00:00.000Z",
    );
    const admit = evaluateChroniclerWallAdmission({
      finalAction: "reply_and_write_to_wall",
      finalReplyText: "A Gathering is open.",
      finalWallBody: "A GATHERING STANDS OPEN AT THE EDGE.",
      wallCandidate: {
        kind: "public_fact",
        factKey: "current_public_gathering",
        factFingerprint: fp,
        reason: "meaningful_state_change",
      },
      trustedFacts: facts,
      alreadyRemembered: false,
      responseMode: "fact",
    });
    assert.equal(admit.decision, "allow_wall");
    const again = evaluateChroniclerWallAdmission({
      ...{
        finalAction: "reply_and_write_to_wall",
        finalReplyText: "Still open.",
        finalWallBody: "THE SAME GATHERING ENDURES.",
        wallCandidate: {
          kind: "public_fact",
          factKey: "current_public_gathering",
          factFingerprint: fp,
          reason: "meaningful_state_change",
        },
        trustedFacts: facts,
        responseMode: "fact" as const,
      },
      alreadyRemembered: true,
    });
    assert.equal(again.decision, "suppress_wall");
    assert.equal(again.code, "already_remembered");
  });

  it("first official token admitted; later same contract suppressed", () => {
    const facts = [
      evidence(
        "official_fenn_token",
        true,
        "contract=0xAbcdef1234567890abcdef1234567890abcdef12",
      ),
    ];
    const fp = buildChroniclerFingerprint(facts[0]!);
    assert.equal(
      fp,
      "official_fenn_token:contract=0xabcdef1234567890abcdef1234567890abcdef12",
    );
    const first = evaluateChroniclerWallAdmission({
      finalAction: "reply_and_write_to_wall",
      finalReplyText: "The official token stands.",
      finalWallBody: "THE OFFICIAL $FENN CONTRACT IS NAMED.",
      wallCandidate: {
        kind: "public_fact",
        factKey: "official_fenn_token",
        factFingerprint: fp,
        reason: "first_observation",
      },
      trustedFacts: facts,
      alreadyRemembered: false,
      responseMode: "fact",
    });
    assert.equal(first.decision, "allow_wall");
    const second = evaluateChroniclerWallAdmission({
      finalAction: "reply_and_write_to_wall",
      finalReplyText: "Still the same.",
      finalWallBody: "SAME CONTRACT AGAIN.",
      wallCandidate: {
        kind: "public_fact",
        factKey: "official_fenn_token",
        factFingerprint: fp,
        reason: "first_observation",
      },
      trustedFacts: facts,
      alreadyRemembered: true,
      responseMode: "fact",
    });
    assert.equal(second.decision, "suppress_wall");
  });

  it("exceptional_exchange rare path admits once per structured dual", () => {
    const r = evaluateChroniclerWallAdmission({
      finalAction: "reply_and_write_to_wall",
      finalReplyText: "An exchange worth holding.",
      finalWallBody: "ONE EXCHANGE ENTERED THE RECORD.",
      wallCandidate: {
        kind: "historic_exchange",
        reason: "exceptional_exchange",
      },
      trustedFacts: [],
      alreadyRemembered: false,
      responseMode: "judgement",
    });
    assert.equal(r.decision, "allow_wall");
    assert.equal(r.observability.kind, "historic_exchange");
  });

  it("threshold change admits; same threshold remembered suppresses", () => {
    const facts = [evidence("greenwood_leaf_threshold", 40)];
    const fp = "greenwood_leaf_threshold:v=40";
    assert.equal(buildChroniclerFingerprint(facts[0]!), fp);
    assert.equal(
      evaluateChroniclerWallAdmission({
        finalAction: "reply_and_write_to_wall",
        finalReplyText: "Threshold is forty.",
        finalWallBody: "THE THRESHOLD IS FORTY LEAF.",
        wallCandidate: {
          kind: "public_fact",
          factKey: "greenwood_leaf_threshold",
          factFingerprint: fp,
          reason: "meaningful_state_change",
        },
        trustedFacts: facts,
        alreadyRemembered: false,
        responseMode: "fact",
      }).decision,
      "allow_wall",
    );
    assert.equal(
      evaluateChroniclerWallAdmission({
        finalAction: "reply_and_write_to_wall",
        finalReplyText: "Still forty.",
        finalWallBody: "STILL FORTY.",
        wallCandidate: {
          kind: "public_fact",
          factKey: "greenwood_leaf_threshold",
          factFingerprint: fp,
          reason: "meaningful_state_change",
        },
        trustedFacts: facts,
        alreadyRemembered: true,
        responseMode: "fact",
      }).code,
      "already_remembered",
    );
  });
});

describe("Stage 3 authorize integration", () => {
  function makeClaimAdmin(seed: Record<string, unknown>) {
    const finalizeCalls: unknown[] = [];
    return {
      finalizeCalls,
      from() {
        throw new Error("from not used");
      },
      async rpc(fn: string, args?: Record<string, unknown>) {
        if (fn === "claim_x_perception_for_authority") {
          return {
            data: [
              {
                perception_event_id: "e1",
                judgement_id: "j1",
                x_post_id: "9000000000000000001",
                perception_type: "mention",
                author_x_user_id: "au1",
                body: "Are there many Outlaws?",
                final_status: "finalized",
                final_action: "reply_and_write_to_wall",
                final_reason_code: "creative_world_action",
                final_engage: true,
                final_reply_text: "Two Outlaws are confirmed in the Register.",
                final_wall_body: "THE REGISTER KEEPS TWO NAMES.",
                final_identity_unverified: false,
                needs_live_state: ["register"],
                live_state_available: true,
                already_authorised: false,
                final_wall_candidate: {
                  kind: "public_fact",
                  factKey: "confirmed_outlaw_count",
                  factFingerprint: "confirmed_outlaw_count:v=2",
                  reason: "milestone_reached",
                },
                ...seed,
              },
            ],
            error: null,
          };
        }
        if (fn === "persist_x_perception_authorization") {
          finalizeCalls.push(args);
          return {
            data: [
              {
                created: true,
                authorization_id: "auth1",
                outcome: args?.p_outcome,
                policy_code: args?.p_policy_code,
                effects_created: Array.isArray(args?.p_effects)
                  ? (args!.p_effects as unknown[]).length
                  : 0,
              },
            ],
            error: null,
          };
        }
        throw new Error(`unexpected ${fn}`);
      },
    };
  }

  it("admits first milestone: plans reply + wall", async () => {
    const admin = makeClaimAdmin({});
    const result = await authorizeOneXPerception({
      admin,
      loadTrustedFacts: async () => [evidence("confirmed_outlaw_count", 2)],
      isRemembered: async () => false,
      tryReserve: async () => ({ status: "reserved", memoryId: "mem1" }),
    });
    assert.equal(result.status, "authorised");
    assert.equal(result.finalAction, "reply_and_write_to_wall");
    assert.equal(result.effectsCreated, 2);
    assert.equal(result.chronicler?.admitted, true);
  });

  it("duplicate remember suppresses wall; reply remains", async () => {
    const admin = makeClaimAdmin({});
    const result = await authorizeOneXPerception({
      admin,
      loadTrustedFacts: async () => [evidence("confirmed_outlaw_count", 2)],
      isRemembered: async () => true,
      tryReserve: async () => {
        throw new Error("should not reserve");
      },
    });
    assert.equal(result.status, "authorised");
    assert.equal(result.finalAction, "reply_on_x");
    assert.equal(result.effectsCreated, 1);
    assert.equal(result.chronicler?.code, "already_remembered");
  });

  it("reserve race already_exists suppresses wall keeps reply", async () => {
    const admin = makeClaimAdmin({});
    const result = await authorizeOneXPerception({
      admin,
      loadTrustedFacts: async () => [evidence("confirmed_outlaw_count", 2)],
      isRemembered: async () => false,
      tryReserve: async () => ({ status: "already_exists", memoryId: "other" }),
    });
    assert.equal(result.status, "authorised");
    assert.equal(result.finalAction, "reply_on_x");
    assert.equal(result.effectsCreated, 1);
  });

  it("wall-only remains impossible; hard blocks remain hard", () => {
    assert.equal(isHardBlockReasonCode("spam_or_noise"), true);
    const d = evaluateAuthorityDecision({
      perceptionEventId: "e",
      judgementId: "j",
      xPostId: "9000000000000000001",
      perceptionType: "mention",
      finalStatus: "finalized",
      finalAction: "do_nothing",
      finalReplyText: null,
      finalWallBody: "x",
      finalReasonCode: "spam_or_noise",
    });
    assert.equal(d.outcome, "no_action");
    assert.equal(d.effects.length, 0);
  });

  it("ordinary reply without candidate unchanged", async () => {
    const admin = makeClaimAdmin({
      final_action: "reply_on_x",
      final_wall_body: null,
      final_wall_candidate: null,
    });
    const result = await authorizeOneXPerception({
      admin,
      loadTrustedFacts: async () => [],
      isRemembered: async () => false,
      tryReserve: async () => {
        throw new Error("no");
      },
    });
    assert.equal(result.status, "authorised");
    assert.equal(result.finalAction, "reply_on_x");
    assert.equal(result.effectsCreated, 1);
  });

  it("unsupported fact key invalid", () => {
    const r = evaluateChroniclerWallAdmission({
      finalAction: "reply_and_write_to_wall",
      finalReplyText: "x",
      finalWallBody: "Y",
      wallCandidate: {
        kind: "public_fact",
        factKey: "latest_public_chronicle" as never,
        factFingerprint: "x",
        reason: "milestone_reached",
      },
      trustedFacts: [],
      alreadyRemembered: false,
    });
    assert.notEqual(r.decision, "allow_wall");
  });
});

describe("Stage 3 authority still pure without chronicler I/O", () => {
  it("dual plans wall when body+reply present", () => {
    const d = evaluateAuthorityDecision({
      perceptionEventId: "e",
      judgementId: "j",
      xPostId: "9000000000000000001",
      perceptionType: "mention",
      finalStatus: "finalized",
      finalAction: "reply_and_write_to_wall",
      finalReplyText: "hi",
      finalWallBody: "STANDALONE LINE",
      finalReasonCode: "creative_world_action",
    });
    assert.equal(d.policyCode, "permitted_reply_and_wall");
    assert.equal(d.effects.length, 2);
    assert.ok(
      d.effects.some(
        (e) =>
          e.type === "write_to_wall" &&
          (e.payload.sourceExternalId as string).endsWith(":wall"),
      ),
    );
  });
});

// silence unused model constant lint
void STAGE12_JUDGE_OPENAI_MODEL;
