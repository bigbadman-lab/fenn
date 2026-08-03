import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { buildEditorialBrief } from "@/lib/editorial/brief";
import {
  EDITORIAL_CATEGORY_QUOTAS,
  EDITORIAL_PACKAGE_SIZE,
  orderedCategorySlots,
} from "@/lib/editorial/categories";
import { buildEditorialRobinhoodContext } from "@/lib/editorial/robinhood-context";
import type {
  EditorialDraftTransmission,
  EditorialWorldContext,
} from "@/lib/editorial/types";
import {
  assertNoInventedStats,
  validateEditorialPackage,
  validateSingleTransmission,
} from "@/lib/editorial/validate";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "../../..");

function read(rel: string): string {
  return readFileSync(join(repo, rel), "utf8");
}

function quietWorld(partial: Partial<EditorialWorldContext> = {}): EditorialWorldContext {
  return {
    coveredDate: "2026-08-03",
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
    ],
    ...partial,
  };
}

function draft(
  category: EditorialDraftTransmission["category"],
  body: string,
  title = "note",
): EditorialDraftTransmission {
  return {
    category,
    title,
    body,
    operatorRationale: "grounded",
    sourceSignals: ["quiet"],
    confidence: "medium",
  };
}

function packageFromBodies(bodies: string[]): EditorialDraftTransmission[] {
  const slots = orderedCategorySlots();
  assert.equal(bodies.length, slots.length);
  return slots.map((category, i) => draft(category, bodies[i]!, `t${i}`));
}

describe("Editorial categories", () => {
  it("sums to exactly twenty-four transmissions", () => {
    const total = Object.values(EDITORIAL_CATEGORY_QUOTAS).reduce(
      (a, b) => a + b,
      0,
    );
    assert.equal(total, EDITORIAL_PACKAGE_SIZE);
    assert.equal(orderedCategorySlots().length, 24);
  });
});

describe("Editorial brief + robinhood awareness", () => {
  it("builds quiet themes without inventing growth", () => {
    const world = quietWorld();
    const rh = buildEditorialRobinhoodContext(world);
    const brief = buildEditorialBrief(world, rh);
    assert.ok(brief.themes.some((t) => /quiet/i.test(t)));
    assert.ok(brief.avoid.includes("hype"));
    assert.ok(rh.lines.some((l) => /Do not invent/i.test(l)));
    assert.equal(rh.hasTrustedSignals, true); // treasury ready
  });

  it("does not invent partnerships in robinhood context", () => {
    const rh = buildEditorialRobinhoodContext(quietWorld());
    const claiming = rh.lines.filter((l) => !/Do not invent/i.test(l));
    assert.doesNotMatch(claiming.join("\n"), /we partnered|partnership with/i);
  });
});

describe("Editorial validation", () => {
  it("accepts a valid 24-slot package with unique bodies", () => {
    const bodies = Array.from({ length: 24 }, (_, i) => {
      if (i >= 14 && i < 18) {
        // ascii slots
        return `ascii motif ${i}\n  /\\ \n /  \\`;
      }
      return `unique transmission body number ${i} stands alone.`;
    });
    const world = quietWorld();
    validateEditorialPackage(packageFromBodies(bodies), world);
  });

  it("rejects short package and duplicates", () => {
    const world = quietWorld();
    assert.throws(
      () => validateEditorialPackage([draft("lore", "only one")], world),
      /24/,
    );

    const bodies = Array.from({ length: 24 }, (_, i) =>
      i === 1
        ? "unique transmission body number 0 stands alone."
        : `unique transmission body number ${i} stands alone.`,
    );
    assert.throws(
      () => validateEditorialPackage(packageFromBodies(bodies), world),
      /Duplicate|Near-duplicate/,
    );
  });

  it("rejects invented statistics on quiet days", () => {
    const world = quietWorld();
    assert.throws(
      () => assertNoInventedStats("5 outlaws arrived today.", world),
      /Invented/,
    );
    assert.throws(() => assertNoInventedStats("GM #fenn to the moon", world));
  });

  it("regeneration rejects matching old body", () => {
    const world = quietWorld();
    assert.throws(
      () =>
        validateSingleTransmission(
          draft("lore", "same body again"),
          "lore",
          world,
          ["same body again"],
        ),
      /previous draft/,
    );
  });

  it("regeneration keeps required category", () => {
    const world = quietWorld({
      newOutlaws: 2,
      quiet: false,
      signalKeys: ["newOutlaws", "quiet"],
    });
    assert.throws(
      () =>
        validateSingleTransmission(
          draft("ascii", "----\nx\n----", "x",),
          "lore",
          world,
          [],
        ),
      /Expected category/,
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
  });

  it("generation is one package call; single regenerate is separate", () => {
    const gen = read("src/lib/editorial/generate.ts");
    assert.match(gen, /generateEditorialPackage/);
    assert.match(gen, /generateEditorialSingle/);
    assert.match(gen, /mode: "package"/);
    assert.match(gen, /mode: "single"/);
    assert.doesNotMatch(gen, /useGetWalletPrivateKey|privateKey/);
  });

  it("voice and prompt ban marketing clichés", () => {
    const voice = read("src/lib/editorial/voice.ts");
    const prompt = read("src/lib/editorial/generate-prompt.ts");
    assert.match(voice, /never "GM"/);
    assert.match(voice, /no price talk/i);
    assert.match(prompt, /Exactly 24|Exactly \$\{EDITORIAL_PACKAGE_SIZE\}/);
    assert.match(prompt, /robinhood_echo/);
  });

  it("UI has operator controls without auto-post or scheduling", () => {
    const ui = read("src/components/desk/desk-editorial-panel.tsx");
    const page = read("src/app/desk/editorial/page.tsx");
    assert.match(page, /DeskEditorialPanel/);
    assert.match(ui, /PREPARE TODAY/);
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
