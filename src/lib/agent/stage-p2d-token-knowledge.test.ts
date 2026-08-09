/**
 * P2D — official contract address verification + live knowledge blocks.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  extractEvmAddressCandidates,
  verifyCandidateAgainstOfficialContract,
} from "@/lib/agent/official-token-address-verify";
import {
  buildCandidateVerificationNote,
  formatOfficialTokenLiveContextBlock,
  officialContractFromTokenFact,
  questionNeedsOfficialTokenLiveState,
} from "@/lib/agent/token-live-knowledge";
import type { PublicFactEvidence } from "@/lib/agent/public-fact-evidence";
import { getFennCanonDocument } from "@/content/canon";
import {
  looksLikeTokenIdentity,
  runSelfKnowledgeCalibration,
} from "@/lib/agent/self-knowledge-calibration";
import type { RetrievedFennKnowledge } from "@/lib/memory/retrieve";

const OFFICIAL = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const OTHER = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const FAKE = "0x1111111111111111111111111111111111111111";
const PURSE = "0xcccccccccccccccccccccccccccccccccccccccc";

function factAvailable(contract: string): PublicFactEvidence {
  return {
    key: "official_fenn_token",
    available: true,
    value: true,
    detail: `symbol=FENN; chain_id=4663; contract=${contract}; explorer=https://example.test/${contract}; status=official_public_contract_configured`,
    observedAt: "2026-01-01T00:00:00.000Z",
    source: "test",
    privacy: "public_config",
  };
}

function factUnavailable(): PublicFactEvidence {
  return {
    key: "official_fenn_token",
    available: false,
    value: null,
    detail: null,
    observedAt: "2026-01-01T00:00:00.000Z",
    source: "test",
    privacy: "public_config",
  };
}

function chunk(
  overrides: Partial<RetrievedFennKnowledge> &
    Pick<RetrievedFennKnowledge, "memoryId" | "title" | "text">,
): RetrievedFennKnowledge {
  return {
    memoryId: overrides.memoryId,
    layer: overrides.layer ?? "canon",
    title: overrides.title,
    text: overrides.text,
    chunkIndex: overrides.chunkIndex ?? 0,
    score: overrides.score ?? 0.9,
    visibility: overrides.visibility ?? "public",
  };
}

describe("P2D address verification", () => {
  it("match / mismatch / unavailable / invalid", () => {
    assert.equal(
      verifyCandidateAgainstOfficialContract({
        candidateRaw: OFFICIAL,
        officialContract: OFFICIAL,
      }).status,
      "match",
    );
    assert.equal(
      verifyCandidateAgainstOfficialContract({
        candidateRaw: OTHER,
        officialContract: OFFICIAL,
      }).status,
      "mismatch",
    );
    assert.equal(
      verifyCandidateAgainstOfficialContract({
        candidateRaw: FAKE,
        officialContract: null,
      }).status,
      "unavailable",
    );
    assert.equal(
      verifyCandidateAgainstOfficialContract({
        candidateRaw: "not-an-address",
        officialContract: OFFICIAL,
      }).status,
      "invalid_candidate",
    );
    assert.equal(
      verifyCandidateAgainstOfficialContract({
        candidateRaw: OFFICIAL.toUpperCase(),
        officialContract: OFFICIAL,
      }).status,
      "match",
    );
  });

  it("never confuses Purse for official solely by verification input", () => {
    assert.equal(
      verifyCandidateAgainstOfficialContract({
        candidateRaw: PURSE,
        officialContract: OFFICIAL,
      }).status,
      "mismatch",
    );
  });

  it("extracts candidates from free text", () => {
    const xs = extractEvmAddressCandidates(
      `Is ${FAKE} the official FENN contract?`,
    );
    assert.deepEqual(xs, [FAKE]);
  });
});

describe("P2D token live knowledge helpers", () => {
  it("detects CA / launch-live questions", () => {
    assert.equal(questionNeedsOfficialTokenLiveState("What is the FENN contract?"), true);
    assert.equal(questionNeedsOfficialTokenLiveState("What is your CA?"), true);
    assert.equal(questionNeedsOfficialTokenLiveState("Has FENN launched?"), true);
    assert.equal(
      questionNeedsOfficialTokenLiveState(`Is ${FAKE} the official FENN contract?`),
      true,
    );
    assert.equal(questionNeedsOfficialTokenLiveState("What is $FENN?"), false);
    assert.equal(questionNeedsOfficialTokenLiveState("Where was FENN launched?"), false);
  });

  it("parses contract from fact detail", () => {
    assert.equal(officialContractFromTokenFact(factAvailable(OFFICIAL)), OFFICIAL);
    assert.equal(officialContractFromTokenFact(factUnavailable()), null);
  });

  it("pre-launch block has no invented CA; post-launch exposes exact CA", () => {
    const pre = formatOfficialTokenLiveContextBlock(factUnavailable());
    assert.match(pre, /UNAVAILABLE/i);
    assert.doesNotMatch(pre, /0x[a-f0-9]{40}/i);

    const post = formatOfficialTokenLiveContextBlock(factAvailable(OFFICIAL));
    assert.match(post, new RegExp(OFFICIAL));
    assert.doesNotMatch(post, new RegExp(PURSE));
  });

  it("verification notes match / mismatch / unavailable", () => {
    const matchNote = buildCandidateVerificationNote(
      `Is ${OFFICIAL} official?`,
      factAvailable(OFFICIAL),
    );
    assert.match(matchNote ?? "", /MATCH/);

    const mismatch = buildCandidateVerificationNote(
      `Is ${FAKE} official?`,
      factAvailable(OFFICIAL),
    );
    assert.match(mismatch ?? "", /MISMATCH/);

    const unavail = buildCandidateVerificationNote(
      `Is ${FAKE} official?`,
      factUnavailable(),
    );
    assert.match(unavail ?? "", /cannot verify/i);
  });

  it("canon does not store official address while post-launch fact does", () => {
    const token = getFennCanonDocument("fenn.token.identity")!;
    assert.doesNotMatch(token.content, /0x[a-fA-F0-9]{40}/);
    assert.equal(
      looksLikeTokenIdentity({ title: token.title, text: token.content }),
      true,
    );
    assert.match(
      formatOfficialTokenLiveContextBlock(factAvailable(OFFICIAL)),
      new RegExp(OFFICIAL),
    );
  });
});

describe("P2D self-knowledge pre/post launch with injected token fact", () => {
  it("pre-launch: token identity retrieved; CA unavailable; no invented address in context", async () => {
    const token = getFennCanonDocument("fenn.token.identity")!;
    let userSeen = "";
    const result = await runSelfKnowledgeCalibration(
      { text: "What is the FENN contract?" },
      {
        retrieve: async () => [
          chunk({
            memoryId: "token",
            title: token.title,
            text: token.content,
          }),
        ],
        loadOfficialTokenFact: async () => factUnavailable(),
        callModel: async (args) => {
          userSeen = args.user;
          return {
            engage: true,
            action: "reply_on_x",
            reasonCode: "answered_from_public_knowledge",
            replyText: "Official contract is not configured yet.",
            wallBody: null,
            needsLiveState: [],
            identityUnverified: false,
            responseMode: "canon",
            wallCandidate: null,
          };
        },
      },
    );
    assert.equal(result.ok, true);
    assert.equal(result.retrievedTokenIdentity, true);
    assert.equal(result.officialTokenLiveFactLoaded, true);
    assert.equal(result.officialTokenAvailable, false);
    assert.equal(result.officialTokenContract, null);
    assert.match(userSeen, /UNAVAILABLE/i);
    assert.doesNotMatch(userSeen, /0x[a-f0-9]{40}/i);
    assert.doesNotMatch(userSeen, new RegExp(PURSE));
    assert.equal(result.sideEffectsAttempted, false);
    assert.equal(result.purseCallAttempted, false);
    assert.equal(result.chainBroadcastAttempted, false);
  });

  it("post-launch: exact trusted contract in context; match notes", async () => {
    const token = getFennCanonDocument("fenn.token.identity")!;
    let userSeen = "";
    const result = await runSelfKnowledgeCalibration(
      { text: `Is ${OFFICIAL} the official FENN contract?` },
      {
        retrieve: async () => [
          chunk({
            memoryId: "token",
            title: token.title,
            text: token.content,
          }),
        ],
        loadOfficialTokenFact: async () => factAvailable(OFFICIAL),
        callModel: async (args) => {
          userSeen = args.user;
          return {
            engage: true,
            action: "reply_on_x",
            reasonCode: "answered_from_public_knowledge",
            replyText: `Yes, ${OFFICIAL} is the official contract.`,
            wallBody: null,
            needsLiveState: [],
            identityUnverified: false,
            responseMode: "fact",
            wallCandidate: null,
          };
        },
      },
    );
    assert.equal(result.ok, true);
    assert.equal(result.officialTokenAvailable, true);
    assert.equal(result.officialTokenContract, OFFICIAL);
    assert.match(userSeen, new RegExp(OFFICIAL));
    assert.match(userSeen, /MATCH/);
    assert.equal(result.retrievedTokenIdentity, true);
    assert.doesNotMatch(token.content, new RegExp(OFFICIAL));
    // PONS provenance remains only in canon sheet (not required in every truncated chunk)
  });

  it("PONS and LEAF questions stay knowledge-only with no live token required", async () => {
    const token = getFennCanonDocument("fenn.token.identity")!;
    for (const text of [
      "Where was FENN launched?",
      "Does PONS control FENN?",
      "Is LEAF the same as FENN?",
    ]) {
      const result = await runSelfKnowledgeCalibration(
        { text },
        {
          retrieve: async () => [
            chunk({
              memoryId: "token",
              title: token.title,
              text: token.content,
            }),
          ],
          skipOfficialTokenLiveFact: true,
          callModel: async () => ({
            engage: true,
            action: "reply_on_x",
            reasonCode: "answered_from_public_knowledge",
            replyText: "grounded mock",
            wallBody: null,
            needsLiveState: [],
            identityUnverified: false,
            responseMode: "canon",
            wallCandidate: null,
          }),
        },
      );
      assert.equal(result.ok, true);
      assert.equal(result.retrievedTokenIdentity, true);
      assert.equal(result.officialTokenLiveFactLoaded, false);
      assert.equal(result.sideEffectsAttempted, false);
    }
  });

  it("source surface never activates settlement or Purse writes", () => {
    const src = readFileSync(
      join(process.cwd(), "src/lib/agent/self-knowledge-calibration.ts"),
      "utf8",
    );
    const live = readFileSync(
      join(process.cwd(), "src/lib/agent/token-live-knowledge.ts"),
      "utf8",
    );
    assert.doesNotMatch(src, /try_activate_official_settlement|executePending|executeTransfer/);
    assert.doesNotMatch(src, /from\("treasury_assets"\)|\.from\("purse_config"\)/);
    assert.doesNotMatch(live, /executeTransfer|try_activate_official_settlement/);
  });
});
