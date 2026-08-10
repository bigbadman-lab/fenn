import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildEditorialPackageSystemPrompt,
  buildEditorialPackageUserPayload,
  buildEditorialRecoverySystemPrompt,
  buildEditorialRegenerateUserPayload,
  buildEditorialKeeperSpeakSystemPrompt,
  buildEditorialKeeperSpeakUserPayload,
} from "@/lib/editorial/generate-prompt";
import {
  generateEditorialPackage,
  generateEditorialKeeperSpeak,
} from "@/lib/editorial/generate";
import { buildEditorialRobinhoodContext } from "@/lib/editorial/robinhood-context";
import type {
  EditorialContextPack,
  EditorialDraftTransmission,
  EditorialWorldContext,
} from "@/lib/editorial/types";
import {
  EDITORIAL_CONTEXT_CAPS,
  EDITORIAL_GENERATOR_VERSION,
  EDITORIAL_KEEPER_CONTEXT_MAX_CHARS,
  EDITORIAL_PROMPT_VERSION,
  encodeEditorialMetaSignals,
  decodeEditorialMetaSignals,
} from "@/lib/editorial/types";
import {
  assertNoConflictingOfficialContract,
  assertNoInventedStats,
  assessEditorialPackage,
  detectBannedMarketing,
  EDITORIAL_BAD_FIXTURES,
  EDITORIAL_GOOD_FIXTURES,
  looksLikeAsciiStructure,
  softQualityReasonsForSingle,
  validateEditorialPackage,
  validateSingleTransmission,
} from "@/lib/editorial/quality";
import {
  BOOK_OF_SPEECH_VERSION,
  buildBookOfSpeechCanonBlock,
} from "@/lib/fenn-voice/book-of-speech";
import { EditorialError } from "@/lib/editorial/errors";
import { buildEditorialBrief, buildEditorialBriefFromPack } from "@/lib/editorial/brief";
import {
  EDITORIAL_CATEGORY_QUOTAS,
  EDITORIAL_MODE_QUOTAS,
  EDITORIAL_PACKAGE_SIZE,
  categoryForMode,
  orderedCategorySlots,
  orderedModeSlots,
} from "@/lib/editorial/categories";

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
    editorialFocus: { whatMattersToday: null, keeperSituationalContext: null },
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
    sourceSignals: mode === "current" ? ["quiet"] : [],
    confidence: "medium",
    grounded: mode === "current",
    ...extras,
  };
}

function packageFromBodies(bodies: string[]): EditorialDraftTransmission[] {
  const slots = orderedModeSlots();
  assert.equal(bodies.length, slots.length);
  return slots.map((mode, i) => draft(mode, bodies[i]!, `t${i}`));
}

function uniqueBodies(n = EDITORIAL_PACKAGE_SIZE): string[] {
  return Array.from({ length: n }, (_, i) => {
    const mode = orderedModeSlots()[i]!;
    if (mode === "ascii" || mode === "wild") {
      return `> slot ${i}\n| ${mode}\n| _`;
    }
    return `Post ${i}: distinct ${mode} transmission stands alone tonight.`;
  });
}

describe("Editorial modes + categories", () => {
  it("mode quotas sum to exactly thirty", () => {
    const total = Object.values(EDITORIAL_MODE_QUOTAS).reduce((a, b) => a + b, 0);
    assert.equal(total, EDITORIAL_PACKAGE_SIZE);
    assert.equal(EDITORIAL_PACKAGE_SIZE, 30);
    assert.equal(orderedModeSlots().length, 30);
  });

  it("matches exact Editorial 2.1 composition counts", () => {
    assert.equal(EDITORIAL_MODE_QUOTAS.current, 4);
    assert.equal(EDITORIAL_MODE_QUOTAS.explanation, 4);
    assert.equal(EDITORIAL_MODE_QUOTAS.outlaw, 3);
    assert.equal(EDITORIAL_MODE_QUOTAS.leaf_deeds, 3);
    assert.equal(EDITORIAL_MODE_QUOTAS.agent, 3);
    assert.equal(EDITORIAL_MODE_QUOTAS.world_lore, 5);
    assert.equal(EDITORIAL_MODE_QUOTAS.direct, 2);
    assert.equal(EDITORIAL_MODE_QUOTAS.ascii, 3);
    assert.equal(EDITORIAL_MODE_QUOTAS.wild, 3);
  });

  it("category quotas match mode→category mapping", () => {
    const derived = Object.fromEntries(
      Object.keys(EDITORIAL_CATEGORY_QUOTAS).map((k) => [k, 0]),
    ) as Record<string, number>;
    for (const mode of orderedModeSlots()) {
      derived[categoryForMode(mode)] += 1;
    }
    assert.deepEqual(derived, { ...EDITORIAL_CATEGORY_QUOTAS });
    assert.equal(orderedCategorySlots().length, 30);
  });
});

describe("Editorial versions + Book of Speech", () => {
  it("uses prompt v2.1 and generator v2.1", () => {
    assert.equal(EDITORIAL_PROMPT_VERSION, "editorial-prompt-v2.1");
    assert.equal(EDITORIAL_GENERATOR_VERSION, "editorial-generator-v2.1");
  });

  it("injects canonical Book of Speech v2 into system prompt", () => {
    const system = buildEditorialPackageSystemPrompt();
    assert.match(system, /book-of-speech-v2/);
    assert.equal(BOOK_OF_SPEECH_VERSION, "book-of-speech-v2");
    const block = buildBookOfSpeechCanonBlock();
    assert.ok(system.includes(block.slice(0, 40)));
    assert.match(system, /Truth outranks voice/i);
    assert.match(system, /REALITY BEFORE MYTHOLOGY DOES NOT MEAN/);
    assert.match(system, /PACKAGE-LEVEL CLARITY/);
    assert.match(system, /mode=ascii|ASCII slots/i);
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
      editorialFocus: {
        whatMattersToday: "explain LEAF",
        keeperSituationalContext: null,
      },
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
      editorialFocus: {
        whatMattersToday: "push people into Camp",
        keeperSituationalContext: null,
      },
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
    assert.match(user, /"ascii"/);
  });

  it("blank keeper intent is valid", () => {
    const pack = mockPack({
      editorialFocus: {
        whatMattersToday: null,
        keeperSituationalContext: null,
      },
    });
    const user = buildEditorialPackageUserPayload({
      pack,
      brief: buildEditorialBriefFromPack(pack),
    });
    assert.match(user, /"WHAT_MATTERS_TODAY": null/);
  });

  it("regenerate preserves ASCII and LORE mode notes", () => {
    const pack = mockPack();
    const asciiPayload = buildEditorialRegenerateUserPayload({
      mode: "ascii",
      pack,
      brief: buildEditorialBriefFromPack(pack),
      avoidBodies: [],
    });
    assert.match(asciiPayload, /"mode": "ascii"/);
    assert.match(asciiPayload, /visual\/terminal structure/i);

    const lorePayload = buildEditorialRegenerateUserPayload({
      mode: "world_lore",
      pack,
      brief: buildEditorialBriefFromPack(pack),
      avoidBodies: [],
    });
    assert.match(lorePayload, /"mode": "world_lore"/);
    assert.match(lorePayload, /Do NOT force newsroom grounding/i);
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
  it("round-trips mode and grounded in source_signals including ascii", () => {
    const encoded = encodeEditorialMetaSignals("ascii", false, ["newOutlaws"]);
    const decoded = decodeEditorialMetaSignals(encoded);
    assert.equal(decoded.mode, "ascii");
    assert.equal(decoded.grounded, false);
    assert.deepEqual(decoded.sourceSignals, ["newOutlaws"]);
  });
});

describe("ASCII structure quality", () => {
  it("rejects plain prose as ASCII", () => {
    assert.equal(
      looksLikeAsciiStructure("The Greenwood is quiet this morning."),
      false,
    );
    assert.throws(
      () =>
        validateSingleTransmission(
          draft("ascii", "The Greenwood is quiet this morning."),
          "ascii",
          quietWorld(),
          [],
        ),
      /visual\/terminal structure/i,
    );
  });

  it("accepts multi-line terminal/visual output", () => {
    const tree = `       /\\\n      /  \\\n     /FENN\\\n    /______\\\n       ||`;
    assert.equal(looksLikeAsciiStructure(tree), true);

    const terminal = `> listening...\n\n> road found\n\n> name required`;
    assert.equal(looksLikeAsciiStructure(terminal), true);

    const map = `[ REGISTER ]\n\nSTRANGER\n   |\n   v\n OUTLAW`;
    assert.equal(looksLikeAsciiStructure(map), true);

    assert.doesNotThrow(() =>
      validateSingleTransmission(draft("ascii", tree), "ascii", quietWorld(), []),
    );
  });
});

describe("Editorial validation + quality fixtures", () => {
  it("accepts a valid 30-slot package with unique bodies", () => {
    const world = quietWorld();
    validateEditorialPackage(packageFromBodies(uniqueBodies()), world);
  });

  it("rejects short package and exact duplicates", () => {
    const world = quietWorld();
    assert.throws(
      () => validateEditorialPackage([draft("world_lore", "only one")], world),
      /30|mode|Expected/,
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

  it("lore does not require source signals; mysterious lore is not empty failure", () => {
    const world = quietWorld();
    assert.doesNotThrow(() =>
      validateSingleTransmission(
        draft(
          "world_lore",
          "if the path returns you to the same tree twice,\ndo not continue.",
          "warning",
          { sourceSignals: [], grounded: false },
        ),
        "world_lore",
        world,
        [],
      ),
    );
  });

  it("CURRENT grounded claims still require valid signals", () => {
    const bodies = uniqueBodies();
    const pkg = packageFromBodies(bodies);
    // first slot is current
    pkg[0] = {
      ...pkg[0]!,
      grounded: true,
      sourceSignals: [],
    };
    const assessment = assessEditorialPackage(pkg, quietWorld());
    assert.ok(
      assessment.qualityFailures.some((f) =>
        f.reasons.some((r) => /CURRENT marked grounded without source/i.test(r)),
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

  it("ASCII prose in package fails quality; ASCII terminal forms pass", () => {
    const bodies = uniqueBodies();
    const slots = orderedModeSlots();
    const asciiIndex = slots.findIndex((m) => m === "ascii");
    assert.ok(asciiIndex >= 0);
    bodies[asciiIndex] = "Ordinary prose that pretends to be ascii art for FENN.";
    let assessment = assessEditorialPackage(
      packageFromBodies(bodies),
      quietWorld(),
    );
    assert.ok(
      assessment.qualityFailures.some((f) =>
        f.reasons.some((r) => /ASCII mode lacks visual/i.test(r)),
      ),
    );

    bodies[asciiIndex] = `> ok\n| path\n| ___`;
    assessment = assessEditorialPackage(packageFromBodies(bodies), quietWorld());
    assert.ok(
      !assessment.qualityFailures.some(
        (f) =>
          f.index === asciiIndex &&
          f.reasons.some((r) => /ASCII mode lacks visual/i.test(r)),
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

  it("regeneration keeps required mode including ASCII and LORE", () => {
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
    assert.throws(
      () =>
        validateSingleTransmission(
          draft("world_lore", "quiet lore remains"),
          "ascii",
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
            sourceSignals: mode === "current" ? ["quiet"] : [],
            confidence: "medium" as const,
            grounded: mode === "current",
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
              grounded: true,
            },
            {
              index: 1,
              mode: slots[1],
              title: "fixed1",
              body: goodBodies[1]!,
              operatorRationale: "repaired",
              sourceSignals: ["quiet"],
              confidence: "medium" as const,
              grounded: true,
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
    assert.equal(result.transmissions.length, 30);
    assert.equal(result.transmissions[0]!.body, goodBodies[0]);
  });

  it("recovery system prompt forbids rejudging strategy and preserves mystery", () => {
    const prompt = buildEditorialRecoverySystemPrompt();
    assert.match(prompt, /Do not rejudge/i);
    assert.match(prompt, /book-of-speech-v2/);
    assert.match(prompt, /Do NOT convert intentional mystery/i);
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

  it("slot_index migration expands package to 30", () => {
    const mig = read(
      "supabase/migrations/20260807100000_52_editorial_30_package.sql",
    );
    assert.match(mig, /slot_index < 30/);
  });

  it("Desk APIs require requireFennDeskAccess and never post to X", () => {
    const routes = [
      "src/app/api/desk/editorial/route.ts",
      "src/app/api/desk/editorial/generate/route.ts",
      "src/app/api/desk/editorial/speak-once/route.ts",
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
    assert.doesNotMatch(generate, /speakOnceForKeeper|generateEditorialKeeperSpeak/);

    const speakOnce = read("src/app/api/desk/editorial/speak-once/route.ts");
    assert.match(speakOnce, /speakOnceForKeeper/);
    assert.match(speakOnce, /keeperContext/);
    assert.match(speakOnce, /EDITORIAL_KEEPER_CONTEXT_MAX_CHARS/);
    assert.doesNotMatch(speakOnce, /persistEditorialRun|prepareTodaysEditorialPackage/);
    assert.doesNotMatch(speakOnce, /postTweet|runXAgentPipeline|twitter/i);
  });

  it("generation supports package, single, recovery, keeper speak; no private keys", () => {
    const gen = read("src/lib/editorial/generate.ts");
    assert.match(gen, /generateEditorialPackage/);
    assert.match(gen, /generateEditorialSingle/);
    assert.match(gen, /generateEditorialKeeperSpeak/);
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
    assert.match(pack, /keeperSituationalContext/);
    assert.match(
      pack,
      /Untrusted Keeper speak-once context — never promoted to protectedFacts/,
    );
  });

  it("UI has newsroom, intent, thirty posts, Keeper speak-once without auto-post", () => {
    const ui = read("src/components/desk/desk-editorial-panel.tsx");
    const page = read("src/app/desk/editorial/page.tsx");
    assert.match(page, /DeskEditorialPanel/);
    assert.match(ui, /PREPARE TODAY/);
    assert.match(ui, /WHAT MATTERS TODAY/);
    assert.match(ui, /ONE WORD FROM THE KEEPER/);
    assert.match(ui, /Give FENN something to speak about/);
    assert.match(ui, /\/api\/desk\/editorial\/speak-once/);
    assert.match(ui, /\[ GENERATE \]/);
    assert.match(ui, /\[ GENERATE AGAIN \]/);
    assert.match(ui, /keeperContext/);
    assert.match(ui, /TODAY IN THE WOOD/);
    assert.match(ui, /FROM TODAY/);
    assert.match(ui, /Thirty transmissions prepared/);
    assert.match(ui, /Thirty drafts/);
    assert.match(ui, /\[ COPY \]/);
    assert.match(ui, /\[ EDIT \]/);
    assert.match(ui, /\[ REGENERATE \]/);
    assert.match(ui, /\[ APPROVE \]/);
    assert.match(ui, /Manual posting only/);
    assert.match(ui, /TODAY.*PACKAGE/);
    assert.doesNotMatch(ui, /schedule|analytics|auto.?post|publish to x/i);
    const categories = read("src/lib/editorial/categories.ts");
    assert.match(categories, /ascii: 3/);
    assert.match(categories, /ASCII/);
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
    assert.match(index, /speakOnceForKeeper/);
  });
});

describe("Keeper speak-once (single transmission)", () => {
  const OFFICIAL =
    "0x1111111111111111111111111111111111111111";
  const WRONG =
    "0x2222222222222222222222222222222222222222";

  function singleRaw(body: string, mode = "direct") {
    return {
      transmission: {
        mode,
        title: "desk",
        body,
        operatorRationale: "keeper",
        sourceSignals: [] as string[],
        confidence: "medium" as const,
        grounded: false,
      },
    };
  }

  it("prompt places Keeper context in situational field and not protected facts", () => {
    const pack = mockPack({
      editorialFocus: {
        whatMattersToday: null,
        keeperSituationalContext: "it's raining this Tuesday",
      },
      protectedFacts: {
        ...mockPack().protectedFacts,
        officialToken: {
          symbol: "FENN",
          chainId: 4663,
          contractAddress: OFFICIAL,
          explorerUrl: "https://example.invalid",
        },
      },
    });
    const brief = buildEditorialBriefFromPack(pack);
    const system = buildEditorialKeeperSpeakSystemPrompt();
    const user = buildEditorialKeeperSpeakUserPayload({
      pack,
      brief,
      avoidBodies: ["prior post"],
    });
    assert.match(system, /book-of-speech-v2/);
    assert.match(system, /PROTECTED_FACTS/);
    assert.match(system, /KEEPER_SITUATIONAL_CONTEXT/);
    assert.match(system, /PROTECTED_FACTS win/i);
    assert.ok(system.includes(buildBookOfSpeechCanonBlock().slice(0, 40)));
    const parsed = JSON.parse(user) as {
      KEEPER_SITUATIONAL_CONTEXT: string;
      PROTECTED_FACTS: { officialToken: { contractAddress: string } | null };
      avoidBodies: string[];
      mode: string;
    };
    assert.equal(parsed.KEEPER_SITUATIONAL_CONTEXT, "it's raining this Tuesday");
    assert.equal(parsed.mode, "direct");
    assert.deepEqual(parsed.avoidBodies, ["prior post"]);
    assert.equal(
      parsed.PROTECTED_FACTS.officialToken?.contractAddress,
      OFFICIAL,
    );
    assert.doesNotMatch(user, /"keeperSituationalContext"\s*:/);
    const protectedBlob = JSON.stringify(parsed.PROTECTED_FACTS);
    assert.doesNotMatch(protectedBlob, /raining/);
  });

  it("service refuse empty/oversized; max chars match UI convention", () => {
    assert.equal(EDITORIAL_KEEPER_CONTEXT_MAX_CHARS, 2000);
    const svc = read("src/lib/editorial/service.ts");
    assert.match(svc, /speakOnceForKeeper/);
    assert.match(svc, /keeperSituationalContext/);
    assert.match(svc, /persistEditorialRun/);
    assert.doesNotMatch(
      svc,
      /speakOnceForKeeper[\s\S]{0,800}persistEditorialRun/,
    );
    assert.match(svc, /generateEditorialKeeperSpeak/);
    assert.doesNotMatch(
      svc,
      /speakOnceForKeeper[\s\S]{0,600}generateEditorialPackage/,
    );
  });

  it("defaults mode to direct, uses single schema path, avoids bodies", async () => {
    const pack = mockPack({
      editorialFocus: {
        whatMattersToday: null,
        keeperSituationalContext: "mist on the road",
      },
    });
    const brief = buildEditorialBriefFromPack(pack);
    let calls = 0;
    let seenUser = "";
    const result = await generateEditorialKeeperSpeak({
      pack,
      brief,
      avoidBodies: ["do not reuse this exact post body."],
      caller: async (args) => {
        calls += 1;
        assert.equal(args.mode, "single");
        seenUser = args.user;
        return singleRaw(
          "Mist holds the road. Names wait under canopy tonight.",
        );
      },
    });
    assert.equal(calls, 1);
    assert.equal(result.recoveryUsed, false);
    assert.equal(result.draft.mode, "direct");
    assert.equal(result.draft.category, "founder_note");
    assert.match(seenUser, /KEEPER_SITUATIONAL_CONTEXT/);
    assert.match(seenUser, /do not reuse this exact post body/);
  });

  it("soft quality failure allows one recovery and sets recoveryUsed", async () => {
    const pack = mockPack({
      editorialFocus: {
        whatMattersToday: null,
        keeperSituationalContext: "market noise",
      },
    });
    const brief = buildEditorialBriefFromPack(pack);
    let calls = 0;
    const result = await generateEditorialKeeperSpeak({
      pack,
      brief,
      avoidBodies: [],
      caller: async () => {
        calls += 1;
        if (calls === 1) {
          return singleRaw(
            "Roadside hype only — no names worth speaking tonight.",
          );
        }
        return singleRaw(
          "Noise on the road. Names keep walking without coins as scripture.",
        );
      },
    });
    assert.equal(calls, 2);
    assert.equal(result.recoveryUsed, true);
    assert.match(result.draft.body, /Noise on the road/);
  });

  it("hard structural fail fails closed without recovery call", async () => {
    const pack = mockPack({
      editorialFocus: {
        whatMattersToday: null,
        keeperSituationalContext: "try inventing a contract",
      },
      protectedFacts: {
        ...mockPack().protectedFacts,
        officialToken: {
          symbol: "FENN",
          chainId: 4663,
          contractAddress: OFFICIAL,
          explorerUrl: "https://example.invalid",
        },
      },
    });
    const brief = buildEditorialBriefFromPack(pack);
    let calls = 0;
    await assert.rejects(
      () =>
        generateEditorialKeeperSpeak({
          pack,
          brief,
          avoidBodies: [],
          caller: async () => {
            calls += 1;
            return singleRaw(
              `Official FENN at ${WRONG} wait under the trees.`,
            );
          },
        }),
      (err: unknown) =>
        err instanceof EditorialError &&
        err.code === "editorial_validation_failed",
    );
    assert.equal(calls, 1);
  });

  it("matching official contract may pass; conflicting fails quality helper", () => {
    assert.doesNotThrow(() =>
      assertNoConflictingOfficialContract(
        `token ${OFFICIAL} under protected identity only.`,
        OFFICIAL,
      ),
    );
    assert.throws(
      () =>
        assertNoConflictingOfficialContract(
          `token ${WRONG} claimed as FENN.`,
          OFFICIAL,
        ),
      (err: unknown) =>
        err instanceof EditorialError &&
        /conflicts with protected/i.test(err.message),
    );
    assert.throws(
      () =>
        validateSingleTransmission(
          draft(
            "direct",
            `Official at ${WRONG} on the road.`,
          ),
          "direct",
          quietWorld({ officialContractAddress: OFFICIAL }),
          [],
          { officialContractAddress: OFFICIAL },
        ),
      (err: unknown) => err instanceof EditorialError,
    );
    assert.doesNotThrow(() =>
      validateSingleTransmission(
        draft(
          "direct",
          `Official at ${OFFICIAL} when stated.`,
        ),
        "direct",
        quietWorld({ officialContractAddress: OFFICIAL }),
        [],
        { officialContractAddress: OFFICIAL },
      ),
    );
  });

  it("softQualityReasonsForSingle flags generic crypto only", () => {
    const bad = softQualityReasonsForSingle(
      draft(
        "direct",
        "dyor nfa hype only.",
      ),
    );
    assert.ok(bad.length > 0);
    const good = softQualityReasonsForSingle(
      draft("direct", "Rain on oak. Road still open."),
    );
    assert.equal(good.length, 0);
  });

  it("failed recovery after soft first returns failure when second is hard invalid", async () => {
    const pack = mockPack({
      editorialFocus: {
        whatMattersToday: null,
        keeperSituationalContext: "noise",
      },
      protectedFacts: {
        ...mockPack().protectedFacts,
        officialToken: {
          symbol: "FENN",
          chainId: 4663,
          contractAddress: OFFICIAL,
          explorerUrl: "https://example.invalid",
        },
      },
    });
    const brief = buildEditorialBriefFromPack(pack);
    let calls = 0;
    await assert.rejects(
      () =>
        generateEditorialKeeperSpeak({
          pack,
          brief,
          avoidBodies: [],
          caller: async () => {
            calls += 1;
            if (calls === 1) {
              return singleRaw(
                "Empty hype for markets that are not scripture.",
              );
            }
            return singleRaw(`Bad address ${WRONG} is FENN.`);
          },
        }),
      (err: unknown) => err instanceof EditorialError,
    );
    assert.equal(calls, 2);
  });
});

describe("Example mock transmissions (fixture modes, not production events)", () => {
  it("labels representative fixture posts by mode", () => {
    const examples: Array<{ mode: string; body: string }> = [
      {
        mode: "current",
        body: "[fixture] Three names entered the Register before noon.",
      },
      {
        mode: "current",
        body: "[fixture] A Deed still waits on the board.",
      },
      {
        mode: "world_lore",
        body: "[fixture] the third rule was removed from the Book.\nnobody agrees on what it said.",
      },
      {
        mode: "world_lore",
        body: "[fixture] REGISTER NOTE 0041\n\nname accepted.\nreason withheld.",
      },
      {
        mode: "world_lore",
        body: "[fixture] if the path returns you to the same tree twice,\ndo not continue.",
      },
      {
        mode: "ascii",
        body: "[fixture]\n       /\\\n      /  \\\n     /FENN\\\n    /______\\\n       ||",
      },
      {
        mode: "ascii",
        body: "[fixture]\n[ REGISTER ]\n\nSTRANGER\n   |\n   v\n OUTLAW",
      },
      {
        mode: "ascii",
        body: "[fixture]\n> listening...\n\n> road found\n\n> name required",
      },
      {
        mode: "wild",
        body: "[fixture]\nerr // path looped\n// do not trust map:04",
      },
      {
        mode: "wild",
        body: "[fixture] redacted: ██ names spoken under Oak",
      },
      {
        mode: "direct",
        body: "[fixture] FENN is a living place where contribution is recorded.",
      },
    ];
    assert.equal(examples.length, 11);
    for (const ex of examples) {
      assert.ok(ex.body.includes("[fixture]"));
      assert.equal(detectBannedMarketing(ex.body), null);
    }
    assert.equal(looksLikeAsciiStructure(examples[5]!.body), true);
    assert.equal(looksLikeAsciiStructure(examples[6]!.body), true);
    assert.equal(looksLikeAsciiStructure(examples[7]!.body), true);
  });
});
