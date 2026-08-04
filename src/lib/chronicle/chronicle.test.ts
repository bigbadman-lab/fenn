import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { OAK_SECTIONS } from "../../content/oak";
import {
  formatChronicleDateHeading,
  isUtcDateString,
  previousUtcCalendarDay,
  utcDayBounds,
} from "./dates";
import {
  buildDailyChronicleSystemPrompt,
  buildDailyChronicleUserPayload,
} from "./generate-prompt";
import { validateGeneratedAgainstSnapshot } from "./generate";
import { chronicleEntryHeading } from "./format";
import { isQuietDay, snapshotFactCatalog } from "./snapshot";
import type { DailyWorldSnapshot, PublicChronicleEntry } from "./types";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "../../..");

function quietSnapshot(overrides: Partial<DailyWorldSnapshot> = {}): DailyWorldSnapshot {
  const base: DailyWorldSnapshot = {
    coveredDate: "2026-07-28",
    dayStartIso: "2026-07-28T00:00:00.000Z",
    dayEndIso: "2026-07-29T00:00:00.000Z",
    newOutlaws: 0,
    campMessages: 0,
    campLeafRecognised: 0,
    leafRecognisedTotal: 0,
    leafRecognitionEvents: 0,
    deedsCreated: 0,
    deedSubmissionsCreated: 0,
    deedSubmissionsApproved: 0,
    deedSubmissionsRejected: 0,
    greenwoodAdmissions: 0,
    wallInscriptions: 0,
    fennXReplies: 0,
    fennWallWrites: 0,
    commonsAllocationEvents: 0,
    quiet: true,
  };
  const merged = { ...base, ...overrides };
  merged.quiet = isQuietDay(merged);
  return merged;
}

describe("Oak doctrine", () => {
  it("includes the ten approved rings with growth and crypto doctrine", () => {
    const titles = OAK_SECTIONS.map((s) => s.title);
    assert.deepEqual(titles, [
      "WHAT IS FENN?",
      "THE WORLD EXISTS",
      "FENN REMEMBERS",
      "FENN HAS SKILLS",
      "THE WORLD BUILDS ITSELF",
      "LEAF & STANDING",
      "THE GREENWOOD",
      "THE COMMONS",
      "BENEATH THE WORLD",
      "WHAT COMES NEXT",
    ]);

    const joined = OAK_SECTIONS.map((s) => s.body).join("\n");
    assert.match(joined, /GROWTH IS PART OF THE SYSTEM/);
    assert.match(joined, /Robinhood Chain/);
    assert.match(joined, /LEAF is not money/);
    assert.match(joined, /not transferable/);
    assert.match(joined, /Deeds/);
    assert.match(joined, /not yet award LEAF by himself|does not yet award LEAF/i);
    assert.match(joined, /does not move the Treasury/);
    assert.doesNotMatch(joined, /Next\.js|Supabase|RAG|embedding|cron/i);
    assert.doesNotMatch(joined, /autonomous LEAF|unrestricted on-chain/i);

    const oakPage = readFileSync(join(repo, "src/app/oak/page.tsx"), "utf8");
    assert.match(oakPage, /OAK_SECTIONS/);
    assert.match(oakPage, /the book — what happened/);
  });
});

describe("Living Book dates and quiet days", () => {
  it("uses explicit UTC day bounds and previous completed day", () => {
    assert.equal(isUtcDateString("2026-07-28"), true);
    assert.equal(isUtcDateString("2026-7-28"), false);
    const bounds = utcDayBounds("2026-07-28");
    assert.equal(bounds.startIso, "2026-07-28T00:00:00.000Z");
    assert.equal(bounds.endIso, "2026-07-29T00:00:00.000Z");
    assert.equal(
      previousUtcCalendarDay(new Date("2026-07-29T00:05:00.000Z")),
      "2026-07-28",
    );
    assert.equal(formatChronicleDateHeading("2026-07-28"), "28 JUL 2026");
  });

  it("marks fully empty snapshots as quiet", () => {
    assert.equal(isQuietDay(quietSnapshot()), true);
    assert.equal(isQuietDay(quietSnapshot({ campMessages: 3 })), false);
  });
});

describe("Living Book generation grounding", () => {
  it("prompt forbids invention and uses trusted snapshot only", () => {
    const system = buildDailyChronicleSystemPrompt();
    assert.match(system, /may NOT invent facts/i);
    assert.match(system, /DATABASE SUPPLIES THE HISTORY/);
    assert.doesNotMatch(system, /Stage 12 effect|executePending/i);

    const snap = quietSnapshot({ campMessages: 2, quiet: false });
    snap.quiet = isQuietDay(snap);
    const user = buildDailyChronicleUserPayload(snap);
    assert.match(user, /campMessages/);
    assert.doesNotMatch(user, /evidence_text|camp_messages\.content/i);
  });

  it("rejects invented LEAF counts on quiet/zero days", () => {
    const snap = quietSnapshot();
    assert.throws(
      () =>
        validateGeneratedAgainstSnapshot(
          {
            title: "BUSY",
            body: "122 LEAF entered the Ledger.\n\n— FENN",
            referencedFacts: ["quiet"],
            tone: "quiet",
          },
          snap,
        ),
      /invents leafRecognisedTotal/,
    );
  });

  it("accepts a restrained quiet entry", () => {
    const snap = quietSnapshot();
    validateGeneratedAgainstSnapshot(
      {
        title: "VERY LITTLE HAPPENED",
        body: "The road was quiet.\n\nI watched anyway.\n\n— FENN",
        referencedFacts: ["quiet", "coveredDate"],
        tone: "quiet",
      },
      snap,
    );
  });
});

describe("Living Book persistence and surfaces", () => {
  it("daily write path is idempotent on covered_date and stores DAILY/CHRONICLE kinds", () => {
    const write = readFileSync(join(repo, "src/lib/chronicle/write.ts"), "utf8");
    const migration = readFileSync(
      join(repo, "supabase/migrations/20260728140000_31_chronicle_living_book.sql"),
      "utf8",
    );
    assert.match(write, /kind: "daily"/);
    assert.match(write, /kind: "chronicle"/);
    assert.match(write, /isUniqueViolation/);
    assert.match(write, /covered_date/);
    assert.match(migration, /chronicle_entries_daily_covered_date_uidx/);
    assert.match(migration, /'daily'/);
    assert.match(migration, /'chronicle'/);
  });

  it("chronicle inserts use source_id and never source_external_id", () => {
    const write = readFileSync(join(repo, "src/lib/chronicle/write.ts"), "utf8");
    const types = readFileSync(join(repo, "src/lib/chronicle/types.ts"), "utf8");
    assert.match(write, /source_id:\s*sourceId/);
    assert.match(write, /source_id:\s*input\.sourceId/);
    assert.match(write, /daily:\$\{input\.coveredDate\}/);
    // Insert payloads must never send the wall field name as a column key.
    assert.doesNotMatch(write, /source_external_id\s*:/);
    assert.doesNotMatch(write, /sourceExternalId/);
    assert.match(types, /sourceId\?:/);
    assert.doesNotMatch(types, /sourceExternalId/);

    // Wall provenance is a different table and remains independent.
    const wallWrite = readFileSync(join(repo, "src/lib/wall/write.ts"), "utf8");
    assert.match(wallWrite, /source_external_id:\s*validated\.sourceExternalId/);
  });

  it("Desk Book maps chronicle failures to Keeper-facing copy", () => {
    const routeErrors = readFileSync(
      join(repo, "src/lib/desk/route-errors.ts"),
      "utf8",
    );
    const errors = readFileSync(join(repo, "src/lib/chronicle/errors.ts"), "utf8");
    assert.match(routeErrors, /deskFacingChronicleError/);
    assert.match(errors, /FENN could not write this entry to the Book/);
    assert.match(errors, /FENN could not compose this entry/);
  });

  it("Book page lists reverse-chronological public entries without Realtime or Stage 12 execute", () => {
    const page = readFileSync(join(repo, "src/app/book/page.tsx"), "utf8");
    assert.match(page, /listPublicChronicleEntries/);
    assert.match(page, /force-dynamic/);
    assert.doesNotMatch(page, /realtime|World Pulse|PagePulse/i);
    assert.doesNotMatch(page, /executePending|stage12/i);
    assert.match(page, /what happened/);
  });

  it("formats daily headings from covered dates", () => {
    const entry: PublicChronicleEntry = {
      id: "1",
      kind: "daily",
      title: "THE WOOD WAS NOT QUIET",
      body: "…",
      coveredDate: "2026-07-28",
      publishedAt: "2026-07-28T23:59:00.000Z",
    };
    assert.equal(chronicleEntryHeading(entry), "28 JUL 2026");
  });

  it("snapshot helpers never select private Camp/Deed content", () => {
    const snap = readFileSync(join(repo, "src/lib/chronicle/snapshot.ts"), "utf8");
    assert.doesNotMatch(snap, /content|evidence_text|evidence_url|why_statement/);
    assert.match(snap, /camp_messages/);
    assert.match(snap, /count: "exact"/);
    const catalog = snapshotFactCatalog(quietSnapshot({ wallInscriptions: 1 }));
    assert.equal(catalog.wallInscriptions, 1);
  });

  it("CLI and cron share runDailyChronicle; cron requires bearer secret", () => {
    const run = readFileSync(join(repo, "src/lib/chronicle/run-daily.ts"), "utf8");
    const script = readFileSync(join(repo, "scripts/chronicle-daily.ts"), "utf8");
    const cron = readFileSync(
      join(repo, "src/app/api/cron/chronicle-daily/route.ts"),
      "utf8",
    );
    const vercel = readFileSync(join(repo, "vercel.json"), "utf8");
    assert.match(run, /export async function runDailyChronicle/);
    assert.doesNotMatch(run, /from "@\/lib\/agent/);
    assert.doesNotMatch(run, /from "@\/lib\/wall\/write/);
    assert.doesNotMatch(run, /executePendingXPerceptionEffects/);
    assert.match(script, /runDailyChronicle/);
    assert.match(cron, /runDailyChronicle/);
    assert.match(cron, /previousUtcCalendarDay/);
    assert.match(cron, /CRON_SECRET/);
    assert.match(cron, /unauthorized/);
    assert.match(cron, /if \(!secret\) return false/);
    assert.match(vercel, /chronicle-daily/);
    assert.match(vercel, /5 0 \* \* \*/);
  });
});
