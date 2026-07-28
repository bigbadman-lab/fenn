import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  formatLedgerLeafAmount,
  formatLedgerRecognitionTime,
} from "@/lib/ledger/format";
import {
  isKnownLeafSourceType,
  normalizeLedgerRecognition,
  toLedgerPublicCategory,
  toLedgerPublicSummary,
} from "@/lib/ledger/normalize";
import { WORLD_PULSE_LEDGER_MS } from "@/lib/world-pulse/intervals";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "../../..");

function read(rel: string): string {
  return readFileSync(join(repo, rel), "utf8");
}

describe("Ledger public normalization", () => {
  it("maps legitimate source types without inventing FENN awards", () => {
    assert.equal(toLedgerPublicCategory("deed"), "DEED");
    assert.equal(toLedgerPublicCategory("camp"), "CAMP");
    assert.equal(toLedgerPublicCategory("admin_adjustment"), "ADJUSTMENT");
    assert.equal(toLedgerPublicCategory("system"), "SYSTEM");
    assert.equal(toLedgerPublicCategory("unknown"), "OTHER");
    assert.ok(isKnownLeafSourceType("camp"));
    assert.equal(isKnownLeafSourceType("fenn"), false);
  });

  it("keeps Camp summaries free of transcript content", () => {
    const summary = toLedgerPublicSummary({
      category: "CAMP",
      amount: 8,
      reason: "Camp contribution: Moss — secret transcript must not leak",
    });
    assert.equal(summary, "A conversation mattered.");
    assert.doesNotMatch(summary, /secret|transcript|Moss/i);
  });

  it("exposes Deed title safely without evidence", () => {
    const normalized = normalizeLedgerRecognition({
      sourceType: "deed",
      amount: 25,
      reason: "Deed approved: Leave a Mark",
      deedTitle: "Leave a Mark",
      outlawNumber: 7,
      alias: "wrenwood",
    });
    assert.equal(normalized.category, "DEED");
    assert.equal(normalized.outlawLabel, "WRENWOOD");
    assert.match(normalized.summary, /Leave a Mark/);
    assert.doesNotMatch(normalized.summary, /evidence|submission|image/i);
  });

  it("labels admin adjustments transparently", () => {
    const up = normalizeLedgerRecognition({
      sourceType: "admin_adjustment",
      amount: 50,
      reason: "manual grant",
      outlawNumber: 1,
      alias: null,
    });
    assert.equal(up.category, "ADJUSTMENT");
    assert.equal(up.summary, "Recognition was adjusted.");
    assert.match(up.outlawLabel, /OUTLAW 00001/);

    const down = toLedgerPublicSummary({
      category: "ADJUSTMENT",
      amount: -25,
      reason: "correction",
    });
    assert.equal(down, "A prior recognition was corrected.");
  });

  it("reserves FENN category for future without claiming current awards", () => {
    const future = toLedgerPublicSummary({
      category: "FENN",
      amount: 15,
      reason: "future",
    });
    assert.match(future, /FENN recognised/);
  });
});

describe("Ledger formatting", () => {
  it("formats signed amounts and UTC times", () => {
    assert.equal(formatLedgerLeafAmount(25), "+25");
    assert.equal(formatLedgerLeafAmount(-10), "-10");
    assert.equal(
      formatLedgerRecognitionTime("2026-07-28T11:42:00.000Z"),
      "28 JUL 2026 · 11:42",
    );
  });
});

describe("Ledger page architecture", () => {
  it("rebuilds /ledger as recognition register with World Pulse", () => {
    const page = read("src/app/ledger/page.tsx");
    assert.match(page, /loadLedgerPageData/);
    assert.match(page, /PagePulse/);
    assert.match(page, /WORLD_PULSE_LEDGER_MS/);
    assert.match(page, /force-dynamic/);
    assert.match(page, /something mattered/);
    assert.doesNotMatch(page, /CIRCULATION REGISTER/);
    assert.doesNotMatch(page, /getPublicTreasurySnapshot|commons_commitments/);
    assert.doesNotMatch(page, /postgres_changes|\.channel\(/);
    assert.equal(WORLD_PULSE_LEDGER_MS, 25_000);
  });

  it("projection never selects private Camp/Deed evidence fields", () => {
    const pageData = read("src/lib/ledger/page-data.ts");
    assert.doesNotMatch(pageData, /evidence_text|evidence_url|camp_messages/);
    assert.doesNotMatch(pageData, /moderation_flags|admin_audit_log/);
    assert.match(pageData, /get_public_leaf_recognition_totals/);
  });

  it("migration locks totals RPC to service_role", () => {
    const migration = join(
      repo,
      "supabase/migrations/20260728130000_30_ledger_recognition_totals.sql",
    );
    assert.ok(existsSync(migration));
    const sql = readFileSync(migration, "utf8");
    assert.match(sql, /get_public_leaf_recognition_totals/);
    assert.match(sql, /lifetime_delta > 0/);
    assert.match(sql, /GRANT EXECUTE[\s\S]*service_role/);
    assert.match(sql, /REVOKE ALL[\s\S]*anon, authenticated/);
  });

  it("does not mutate LEAF or invent awardLeaf calls", () => {
    for (const rel of [
      "src/lib/ledger/page-data.ts",
      "src/lib/ledger/normalize.ts",
      "src/components/ledger/ledger-register.tsx",
      "src/app/ledger/page.tsx",
    ]) {
      const source = read(rel);
      assert.doesNotMatch(source, /\bawardLeaf\b|\badminAdjustLeaf\b/);
      assert.doesNotMatch(source, /\.insert\(|\.update\(|\.delete\(/);
    }
  });
});
