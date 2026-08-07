import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { buildEditorialBrief, buildEditorialBriefFromPack } from "@/lib/editorial/brief";
import {
  EDITORIAL_CATEGORY_QUOTAS,
  EDITORIAL_MODE_QUOTAS,
  EDITORIAL_PACKAGE_SIZE,
  categoryForMode,
  orderedCategorySlots,
  orderedModeSlots,
} from "@/lib/editorial/categories";
import {
  buildEditorialPackageSystemPrompt,
  buildEditorialPackageUserPayload,
  buildEditorialRecoverySystemPrompt,
} from "@/lib/editorial/generate-prompt";
import { generateEditorialPackage } from "@/lib/editorial/generate";
import { buildEditorialRobinhoodContext } from "@/lib/editorial/robinhood-context";
import type {
  EditorialContextPack,
  EditorialDraftTransmission,
  EditorialWorldContext,
} from "@/lib/editorial/types";
import {
  EDITORIAL_CONTEXT_CAPS,
  EDITORIAL_GENERATOR_VERSION,
  EDITORIAL_PROMPT_VERSION,
  encodeEditorialMetaSignals,
  decodeEditorialMetaSignals,
} from "@/lib/editorial/types";
import {
  assertNoInventedStats,
  assessEditorialPackage,
  detectBannedMarketing,
  EDITORIAL_BAD_FIXTURES,
  EDITORIAL_GOOD_FIXTURES,
  validateEditorialPackage,
  validateSingleTransmission,
} from "@/lib/editorial/validate";
import {
  BOOK_OF_SPEECH_VERSION,
  buildBookOfSpeechCanonBlock,
} from "@/lib/fenn-voice/book-of-speech";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "../../..");

function read(rel: string): string {
  return readFileSync(join(repo, rel), "utf8");
}

function quietWorld(partial: Partial<EditorialWorldContext> = {}): EditorialWorldContext {
  return {
    coveredDate: "2026-08-07",
    book: { written: false, title: null, preview: null },
    fireWaitingCount: 0,
    gathering: { activeTitle: null, stateLabel: "none" },
    newOutlaws: 0,
    deedSubmissionsApproved: 0,
    deedsCreated: 0,
    greenwoodAdmissions: 0,
    wallInscriptions: 0,
    campMessages: 0,
    campLeafRecognised: 0,
    leafRecognisedTotal: 0,
    leafRecognitionEvents: 0,
    fennXReplies: 0,
    fennWallWrites: 0,
    commonsAllocationEvents: 0,
    commonsState: "ready",
    treasuryState: "ready",
    quiet: true,
    signalKeys: [
      "bookWritten",
      "fireWaitingCount",
      "newOutlaws",
      "quiet",
      "treasuryState",
      "newsroom",
      "whatMattersToday",
    ],
    officialContractAddress: null,
    ...partial,
  };
}

function mockPack(
  partial: Partial<EditorialContextPack> = {},
): EditorialContextPack {
  const world = quietWorld();
  return {
    generatedAt: "2026-08-07T12:00:00.000Z",
    coveredDate: "2026-08-07",
    newsroom: {
      headlines: [],
      notableActivity: [],
      quiet: true,
    },
    worldState: {
      liveSurfaces: ["Register", "Greenwood", "Wall", "Deeds"],
      registerNote: null,
      greenwoodNote: null,
      campNote: null,
      clearingNote: null,
      wallNote: null,
      deedsNote: null,
      chronicleNote: null,
      commonsNote: null,
      ledgerNote: null,
      speaksNote: null,
      gatheringNote: null,
      xAgentNote: null,
      tokenNote: null,
      treasuryNote: null,
    },
    protectedFacts: {
      coveredDate: "2026-08-07",
      officialToken: null,
      greenwoodLeafThreshold: 30,
      outlawCount: null,
      greenwoodMemberCount: null,
      activeGathering: { active: false, title: null, stateLabel: "none" },
      treasuryState: "ready",
      commonsState: "ready",
      dayCounts: {
        newOutlaws: 0,
        deedSubmissionsApproved: 0,
        deedsCreated: 0,
        greenwoodAdmissions: 0,
        wallInscriptions: 0,
        campMessages: 0,
        leafRecognitionEvents: 0,
        leafRecognisedTotal: 0,
        fennXReplies: 0,
        fennWallWrites: 0,
        commonsAllocationEvents: 0,
        fireWaitingCount: 0,
      },
      bookWrittenToday: false,
      bookTitle: null,
      quietDay: true,
    },
    recentWriting: [],
    editorialFocus: { whatMattersToday: null },
    world,
    robinhood: buildEditorialRobinhoodContext(world),
    ...partial,
  };
}

function draft(
  mode: EditorialDraftTransmission["mode"],
  body: string,
  title = "note",
  extras: Partial<EditorialDraftTransmission> = {},
): EditorialDraftTransmission {
  return {
    mode,
    category: categoryForMode(mode),
    title,
    body,
    operatorRationale: "grounded",
    sourceSignals: ["quiet"],
    confidence: "medium",
    grounded: false,
    ...extras,
  };
}

function packageFromBodies(bodies: string[]): EditorialDraftTransmission[] {
  const slots = orderedModeSlots();
  assert.equal(bodies.length, slots.length);
  return slots.map((mode, i) => draft(mode, bodies[i]!, `t${i}`));
}

function uniqueBodies(n = 24): string[] {
  return Array.from({ length: n }, (_, i) => {
    const mode = orderedModeSlots()[i]!;
    if (mode === "wild") {
      return `wild form ${i}\n  /\\ \n /  \\ slot`;
    }
    return `Post ${i}: distinct ${mode} transmission stands alone tonight.`;
  });
}

describe("Editorial modes + categories", () => {
  it("mode quotas sum to exactly twenty-four", () => {
    const total = Object.values(EDITORIAL_MODE_QUOTAS).reduce((a, b) => a + b, 0);
    assert.equal(total, EDITORIAL_PACKAGE_SIZE);
    assert.equal(orderedModeSlots().length, 24);
  });

  it("category quotas match mode→category mapping", () => {
    const derived = Object.fromEntries(
      Object.keys(EDITORIAL_CATEGORY_QUOTAS).map((k) => [k, 0]),
    ) as Record<string, number>;
    for (const mode of orderedModeSlots()) {
      derived[categoryForMode(mode)] += 1;
    }
    assert.deepEqual(derived, { ...EDITORIAL_CATEGORY_QUOTAS });
    assert.equal(orderedCategorySlots().length, 24);
  });
});

describe("Editorial versions + Book of Speech", () => {
  it("uses prompt v2 and generator v2", () => {
    assert.equal(EDITORIAL_PROMPT_VERSION, "editorial-prompt-v2");
    assert.equal(EDITORIAL_GENERATOR_VERSION, "editorial-generator-v2");
  });

  it("injects canonical Book of Speech v2 into system prompt", () => {
    const system = buildEditorialPackageSystemPrompt();
    assert.match(system, /book-of-speech-v2/);
    assert.equal(BOOK_OF_SPEECH_VERSION, "book-of-speech-v2");
    const block = buildBookOfSpeechCanonBlock();
    assert.ok(system.includes(block.slice(0, 40)));
    assert.match(system, /Truth outranks voice/i);
    assert.match(system, /REALITY BEFORE MYTHOLOGY/);
  });
});

describe("Editorial brief (no slogan conversion)", () => {
  it("quiet brief does not invent growth slogans", () => {
    const world = quietWorld();
    const rh = buildEditorialRobinhoodContext(world);
    const brief = buildEditorialBrief(world, rh);
    assert.ok(brief.themes.some((t) => /quiet/i.test(t)));
    assert.doesNotMatch(brief.themes.join(" "), /Greenwood is growing/);
    assert.ok(brief.avoid.includes("hype"));
  });

  it("brief from pack carries keeper intent", () => {
    const pack = mockPack({
      editorialFocus: { whatMattersToday: "explain LEAF" },
      newsroom: {
        headlines: [
          {
            type: "deed",
            occurredAt: null,
            headline: "A Deed is on the board",
            detail: null,
            sourceId: "d1",
            priority: 1,
          },
        ],
        notableActivity: [],
        quiet: false,
      },
    });
    const brief = buildEditorialBriefFromPack(pack);
    assert.equal(brief.whatMattersToday, "explain LEAF");
    assert.ok(brief.themes.some((t) => /Deed/i.test(t)));
  });
});

describe("Prompt payload structure", () => {
  it("separates NEWSROOM, WORLD STATE, PROTECTED FACTS, RECENT WRITING, WHAT MATTERS TODAY", () => {
    const pack = mockPack({
      editorialFocus: { whatMattersToday: "push people into Camp" },
      recentWriting: [
        { source: "wall", text: "prior wall", createdAt: "2026-08-06T00:00:00Z" },
      ],
    });
    const brief = buildEditorialBriefFromPack(pack);
    const user = buildEditorialPackageUserPayload({ pack, brief });
    assert.match(user, /"NEWSROOM"/);
    assert.match(user, /"WORLD_STATE"/);
    assert.match(user, /"PROTECTED_FACTS"/);
    assert.match(user, /"RECENT_WRITING"/);
    assert.match(user, /"WHAT_MATTERS_TODAY"/);
    assert.match(user, /2026-08-07/);
    assert.match(user, /push people into Camp/);
    assert.match(user, /prior wall/);
  });

  it("blank keeper intent is valid", () => {
    const pack = mockPack({ editorialFocus: { whatMattersToday: null } });
    const user = buildEditorialPackageUserPayload({
      pack,
      brief: buildEditorialBriefFromPack(pack),
    });
    assert.match(user, /"WHAT_MATTERS_TODAY": null/);
  });
});

describe("Context pack bounds (unit-level caps)", () => {
  it("exports hard context caps", () => {
    assert.ok(EDITORIAL_CONTEXT_CAPS.newsroomHeadlines <= 8);
    assert.ok(EDITORIAL_CONTEXT_CAPS.notableActivity <= 6);
    assert.ok(EDITORIAL_CONTEXT_CAPS.recentEditorialWriting <= 12);
    assert.ok(EDITORIAL_CONTEXT_CAPS.otherRecentWriting <= 12);
  });

  it("mock pack keeps protectedFacts separate from newsroom", () => {
    const pack = mockPack();
    assert.ok("greenwoodLeafThreshold" in pack.protectedFacts);
    assert.ok(Array.isArray(pack.newsroom.headlines));
    assert.notEqual(pack.protectedFacts, pack.newsroom as unknown);
  });
});

describe("Meta encoding (mode/grounded without migration)", () => {
  it("round-trips mode and grounded in source_signals", () => {
    const encoded = encodeEditorialMetaSignals("current", true, [
      "newOutlaws",
      "mode:should-be-stripped",
    ]);
    const decoded = decodeEditorialMetaSignals(encoded);
    assert.equal(decoded.mode, "current");
    assert.equal(decoded.grounded, true);
    assert.deepEqual(decoded.sourceSignals, ["newOutlaws"]);
  });
});

describe("Editorial validation + quality fixtures", () => {
  it("accepts a valid 24-slot package with unique bodies", () => {
    const world = quietWorld();
    validateEditorialPackage(packageFromBodies(uniqueBodies()), world);
  });

  it("rejects short package and exact duplicates", () => {
    const world = quietWorld();
    assert.throws(
      () => validateEditorialPackage([draft("world_lore", "only one")], world),
      /24|mode|Expected/,
    );

    const bodies = uniqueBodies();
    bodies[1] = bodies[0]!;
    assert.throws(
      () => validateEditorialPackage(packageFromBodies(bodies), world),
      /duplicate/i,
    );
  });

  it("near-duplicate opens quality failure", () => {
    const bodies = uniqueBodies();
    // Make two near-identical long openings
    bodies[0] = "The same almost identical opening prefix occupies this one body here A.";
    bodies[1] = "The same almost identical opening prefix occupies this one body here B.";
    const assessment = assessEditorialPackage(
      packageFromBodies(bodies),
      quietWorld(),
    );
    assert.ok(
      assessment.qualityFailures.some((f) =>
        f.reasons.some((r) => /Near-duplicate|Repeated opening/i.test(r)),
      ) || assessment.structuralErrors.length > 0,
    );
  });

  it("repeated openings trigger quality failure", () => {
    const bodies = uniqueBodies();
    bodies[3] = "Same opening line. First variation.";
    bodies[4] = "Same opening line. Second variation.";
    const assessment = assessEditorialPackage(
      packageFromBodies(bodies),
      quietWorld(),
    );
    assert.ok(
      assessment.qualityFailures.some((f) =>
        f.reasons.some((r) => /opening/i.test(r)),
      ),
    );
  });

  it("rejects invented statistics on quiet days", () => {
    const world = quietWorld();
    assert.throws(
      () => assertNoInventedStats("5 new outlaws arrived today.", world),
      /Invented/,
    );
    assert.throws(() => assertNoInventedStats("GM #fenn to the moon", world));
  });

  it("rejects unsupported contract addresses", () => {
    assert.throws(
      () =>
        assertNoInventedStats(
          "send to 0x1234567890123456789012345678901234567890",
          quietWorld(),
        ),
      /contract address/i,
    );
  });

  it("bad fixtures trigger marketing / generic detection", () => {
    assert.ok(detectBannedMarketing(EDITORIAL_BAD_FIXTURES[0]!));
    assert.ok(detectBannedMarketing(EDITORIAL_BAD_FIXTURES[1]!));
    assert.ok(detectBannedMarketing(EDITORIAL_BAD_FIXTURES[4]!));
    for (const good of EDITORIAL_GOOD_FIXTURES) {
      assert.equal(detectBannedMarketing(good), null);
    }
  });

  it("package with marketing line fails quality", () => {
    const bodies = uniqueBodies();
    bodies[5] = EDITORIAL_BAD_FIXTURES[4]!;
    const assessment = assessEditorialPackage(
      packageFromBodies(bodies),
      quietWorld(),
    );
    assert.ok(
      assessment.qualityFailures.some((f) =>
        f.reasons.some((r) => /marketing/i.test(r)),
      ),
    );
  });

  it("regeneration rejects matching old body", () => {
    const world = quietWorld();
    assert.throws(
      () =>
        validateSingleTransmission(
          draft("world_lore", "same body again"),
          "world_lore",
          world,
          ["same body again"],
        ),
      /previous draft/,
    );
  });

  it("regeneration keeps required mode", () => {
    const world = quietWorld();
    assert.throws(
      () =>
        validateSingleTransmission(
          draft("wild", "----\nx\n----", "x"),
          "world_lore",
          world,
          [],
        ),
      /Expected mode/,
    );
  });
});

describe("Recovery path (one pass)", () => {
  it("repairs quality failures once and does not call recovery twice", async () => {
    const pack = mockPack();
    const brief = buildEditorialBriefFromPack(pack);
    const slots = orderedModeSlots();
    let packageCalls = 0;
    let recoveryCalls = 0;

    const badBodies = uniqueBodies();
    badBodies[0] = "We are excited to announce the next phase of our ecosystem.";
    badBodies[1] = "We are excited to announce the next phase of our ecosystem!!";

    const goodBodies = uniqueBodies();

    const caller = async (args: {
      mode: "package" | "single" | "recovery";
    }) => {
      if (args.mode === "package") {
        packageCalls += 1;
        return {
          transmissions: slots.map((mode, i) => ({
            mode,
            title: `t${i}`,
            body: badBodies[i]!,
            operatorRationale: "draft",
            sourceSignals: ["quiet"],
            confidence: "medium" as const,
            grounded: false,
          })),
        };
      }
      if (args.mode === "recovery") {
        recoveryCalls += 1;
        return {
          repairs: [
            {
              index: 0,
              mode: slots[0],
              title: "fixed0",
              body: goodBodies[0]!,
              operatorRationale: "repaired",
              sourceSignals: ["quiet"],
              confidence: "medium" as const,
              grounded: false,
            },
            {
              index: 1,
              mode: slots[1],
              title: "fixed1",
              body: goodBodies[1]!,
              operatorRationale: "repaired",
              sourceSignals: ["quiet"],
              confidence: "medium" as const,
              grounded: false,
            },
          ],
        };
      }
      throw new Error("unexpected mode");
    };

    const result = await generateEditorialPackage({
      pack,
      brief,
      caller: caller as never,
    });

    assert.equal(packageCalls, 1);
    assert.equal(recoveryCalls, 1);
    assert.equal(result.recoveryUsed, true);
    assert.equal(result.transmissions.length, 24);
    assert.equal(result.transmissions[0]!.body, goodBodies[0]);
  });

  it("recovery system prompt forbids rejudging strategy", () => {
    const prompt = buildEditorialRecoverySystemPrompt();
    assert.match(prompt, /Do not rejudge/i);
    assert.match(prompt, /book-of-speech-v2/);
  });
});

describe("Editorial structured output schema", () => {
  it("converts package schema for OpenAI (no unsupported optional fields)", async () => {
    const { zodResponseFormat } = await import("openai/helpers/zod");
    const {
      editorialPackageModelSchema,
      editorialRecoveryModelSchema,
      editorialSingleModelSchema,
    } = await import("@/lib/editorial/generate-schema");

    assert.doesNotThrow(() =>
      zodResponseFormat(editorialPackageModelSchema, "fenn_editorial_package"),
    );
    assert.doesNotThrow(() =>
      zodResponseFormat(editorialSingleModelSchema, "fenn_editorial_transmission"),
    );
    assert.doesNotThrow(() =>
      zodResponseFormat(editorialRecoveryModelSchema, "fenn_editorial_recovery"),
    );
  });
});

describe("Editorial Room surface and security (source)", () => {
  it("migration stores runs and transmissions with RLS service-role only", () => {
    const mig = read(
      "supabase/migrations/20260803140000_43_editorial_room.sql",
    );
    assert.match(mig, /CREATE TABLE public\.editorial_runs/);
    assert.match(mig, /CREATE TABLE public\.editorial_transmissions/);
    assert.match(mig, /ENABLE ROW LEVEL SECURITY/);
    assert.match(mig, /GRANT SELECT, INSERT, UPDATE, DELETE/);
    assert.match(mig, /TO service_role/);
    assert.doesNotMatch(mig, /GRANT[\s\S]{0,80}TO (anon|authenticated)/);
    assert.match(mig, /private key|wallet|No automatic posting/i);
  });

  it("Desk APIs require requireFennDeskAccess and never post to X", () => {
    const routes = [
      "src/app/api/desk/editorial/route.ts",
      "src/app/api/desk/editorial/generate/route.ts",
      "src/app/api/desk/editorial/transmissions/[id]/route.ts",
      "src/app/api/desk/editorial/transmissions/[id]/regenerate/route.ts",
      "src/app/api/desk/editorial/transmissions/[id]/approve/route.ts",
      "src/app/api/desk/editorial/transmissions/[id]/copy/route.ts",
    ];
    for (const path of routes) {
      const source = read(path);
      assert.match(source, /requireFennDeskAccess/);
      assert.doesNotMatch(source, /runXAgentPipeline|postTweet|tweet\.create/i);
      assert.doesNotMatch(source, /OPENAI_API_KEY|CRON_SECRET/);
    }
    const generate = read("src/app/api/desk/editorial/generate/route.ts");
    assert.match(generate, /confirm: z\.literal\(true\)/);
    assert.match(generate, /desk\.editorial\.generate/);
    assert.match(generate, /whatMattersToday/);
  });

  it("generation supports package, single, recovery; no private keys", () => {
    const gen = read("src/lib/editorial/generate.ts");
    assert.match(gen, /generateEditorialPackage/);
    assert.match(gen, /generateEditorialSingle/);
    assert.match(gen, /mode: "package"/);
    assert.match(gen, /mode: "single"/);
    assert.match(gen, /mode: "recovery"/);
    assert.match(gen, /recoveryUsed/);
    assert.doesNotMatch(gen, /useGetWalletPrivateKey|privateKey/);
  });

  it("context pack uses fail-closed settleOrNull pattern", () => {
    const pack = read("src/lib/editorial/context-pack.ts");
    assert.match(pack, /buildEditorialContextPack/);
    assert.match(pack, /settleOrNull/);
    assert.match(pack, /listPublicWallEntries/);
    assert.match(pack, /listPublicDeeds/);
    assert.match(pack, /getCurrentPublishedFireMessage/);
  });

  it("UI has newsroom, intent, operator controls without auto-post", () => {
    const ui = read("src/components/desk/desk-editorial-panel.tsx");
    const page = read("src/app/desk/editorial/page.tsx");
    assert.match(page, /DeskEditorialPanel/);
    assert.match(ui, /PREPARE TODAY/);
    assert.match(ui, /WHAT MATTERS TODAY/);
    assert.match(ui, /TODAY IN THE WOOD/);
    assert.match(ui, /FROM TODAY/);
    assert.match(ui, /\[ COPY \]/);
    assert.match(ui, /\[ EDIT \]/);
    assert.match(ui, /\[ REGENERATE \]/);
    assert.match(ui, /\[ APPROVE \]/);
    assert.match(ui, /Manual posting only/);
    assert.doesNotMatch(ui, /schedule|analytics|auto.?post|publish to x/i);
  });

  it("nav and error mapper include Editorial Room", () => {
    const gate = read("src/components/desk/desk-gate.tsx");
    const errors = read("src/lib/desk/route-errors.ts");
    assert.match(gate, /\/desk\/editorial/);
    assert.match(gate, /THE EDITORIAL ROOM/);
    assert.match(errors, /EditorialError/);
  });

  it("client lib barrel does not re-export prompts or openai", () => {
    const index = read("src/lib/editorial/index.ts");
    assert.doesNotMatch(index, /generate-prompt|openai|system prompt/i);
    assert.match(index, /SafeEditorialRun|prepareTodaysEditorialPackage/);
  });
});

describe("Example mock transmissions (fixture modes, not production events)", () => {
  it("labels eight representative fixture posts by mode", () => {
    const examples: Array<{ mode: string; body: string }> = [
      {
        mode: "current",
        body: "[fixture] Three names entered the Register before noon.",
      },
      {
        mode: "explanation",
        body: "[fixture] LEAF records contribution. Not attention.",
      },
      {
        mode: "outlaw",
        body: "[fixture] A name on the Register is not a follow count.",
      },
      {
        mode: "leaf_deeds",
        body: "[fixture] The board still holds work that can be done.",
      },
      {
        mode: "agent",
        body: "[fixture] Outside the wood, FENN still answers some doors.",
      },
      {
        mode: "world_lore",
        body: "[fixture] The trees do not announce themselves.",
      },
      {
        mode: "direct",
        body: "[fixture] FENN is a living place where contribution is recorded.",
      },
      {
        mode: "wild",
        body: "[fixture]\n> greenwood --status\nlive",
      },
    ];
    assert.equal(examples.length, 8);
    for (const ex of examples) {
      assert.ok(ex.body.startsWith("[fixture]"));
      assert.equal(detectBannedMarketing(ex.body), null);
    }
  });
});
