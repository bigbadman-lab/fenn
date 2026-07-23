import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  formatCommitmentDelta,
  formatCommonsHistoryDate,
  formatTreasuryObservedAt,
  treasuryAssetBalanceDisplay,
} from "./format";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "../..");

describe("commons format helpers", () => {
  it("formats observedAt as last seen UTC", () => {
    assert.equal(
      formatTreasuryObservedAt("2026-07-23T14:32:00.000Z"),
      "last seen 14:32 UTC",
    );
  });

  it("formats history dates deterministically", () => {
    assert.equal(
      formatCommonsHistoryDate("2026-07-23T10:00:00.000Z"),
      "23 JUL 2026",
    );
  });

  it("preserves signed deltas without Number()", () => {
    assert.equal(formatCommitmentDelta("25"), "+25");
    assert.equal(formatCommitmentDelta("-10"), "-10");
    assert.equal(formatCommitmentDelta("+0.125"), "+0.125");
    assert.equal(
      formatCommitmentDelta("9007199254740993"),
      "+9007199254740993",
    );
  });

  it("shows known zero balance and never zeros unavailable assets", () => {
    assert.deepEqual(
      treasuryAssetBalanceDisplay({
        symbol: "ETH",
        name: null,
        chainId: 4663,
        contractAddress: null,
        decimals: 18,
        state: "available",
        balance: "0",
      }),
      { kind: "balance", value: "0" },
    );
    assert.deepEqual(
      treasuryAssetBalanceDisplay({
        symbol: "USDC",
        name: null,
        chainId: 4663,
        contractAddress: "0x2222222222222222222222222222222222222222",
        decimals: 6,
        state: "unavailable",
        reason: "rpc_failed",
      }),
      { kind: "unavailable", value: "unseen." },
    );
  });
});

describe("stage 9.4 commons UI source safety", () => {
  it("removes AVAILABLE TO CIRCULATE and remaining/uncommitted calc copy", () => {
    const page = readFileSync(join(root, "app/commons/page.tsx"), "utf8");
    assert.doesNotMatch(page, /AVAILABLE TO CIRCULATE/);
    assert.doesNotMatch(page, /UNCOMMITTED|REMAINING/);
    assert.match(page, /THE TREASURY|TreasuryReadout/);
    assert.match(page, /CommonsCommitments/);
    assert.match(page, /not announced/);
    assert.match(page, /OPEN THE LEDGER/);
  });

  it("page loads server snapshots; no browser supabase / circulation", () => {
    const page = readFileSync(join(root, "app/commons/page.tsx"), "utf8");
    assert.match(page, /loadCommonsPageData/);
    assert.doesNotMatch(page, /"use client"/);
    assert.doesNotMatch(page, /createBrowserClient|from\(["']commons_/);
    assert.doesNotMatch(page, /circulation_recipients|from ["']@\/lib\/circulation/);

    const loader = readFileSync(join(here, "page-data.ts"), "utf8");
    assert.match(loader, /getPublicTreasurySnapshot/);
    assert.match(loader, /getPublicCommonsSnapshot/);
    assert.doesNotMatch(
      loader,
      /held\s*-|treasury.*commitment|available\s*=|Number\(/i,
    );
  });

  it("components do not invent totals, USD prices, or Stage 10 data", () => {
    const componentsDir = join(root, "components/commons");
    const files = readdirSync(componentsDir).filter((f) => f.endsWith(".tsx"));
    assert.ok(files.length >= 3);

    for (const file of files) {
      const source = readFileSync(join(componentsDir, file), "utf8");
      assert.doesNotMatch(source, /TOTAL TREASURY|TOTAL HELD/i);
      assert.doesNotMatch(source, /coingecko|priceApi|live value/i);
      assert.doesNotMatch(source, /circulation_recipients|from ["']@\/lib\/circulation/);
      assert.doesNotMatch(source, /Number\([^)]*(balance|amount|delta)/);
      assert.doesNotMatch(source, /held\s*-\s*committed|available to circulate|AVAILABLE TO CIRCULATE/i);
      assert.doesNotMatch(source, /Treasury balance\s*-|held\s*minus\s*committed/i);
    }
  });

  it("treasury unavailable copy never uses zero placeholder", () => {
    const source = readFileSync(
      join(root, "components/commons/treasury-readout.tsx"),
      "utf8",
    );
    assert.match(source, /nothing has been fixed here yet/);
    assert.match(source, /treasuryAssetBalanceDisplay/);
    assert.match(source, /the chain cannot be read just now/);
    assert.match(source, /verified arrivals are history, not the current balance/);
    assert.doesNotMatch(source, /0 ETH/);
    assert.match(source, /balance unavailable/);
  });

  it("commons empty vs error copy stay distinct", () => {
    const commitments = readFileSync(
      join(root, "components/commons/commons-commitments.tsx"),
      "utf8",
    );
    assert.match(commitments, /nothing is currently committed/);
    assert.match(commitments, /the account cannot be read/);
    assert.doesNotMatch(commitments, /AVAILABLE TO CIRCULATE|REMAINING/);
    assert.doesNotMatch(commitments, /\.filter\(|amount\s*&&|amount\s*\|\|/);

    const history = readFileSync(
      join(root, "components/commons/commons-history.tsx"),
      "utf8",
    );
    assert.match(history, /the older marks cannot be read just now/);
    assert.match(history, /formatCommitmentDelta/);
    assert.doesNotMatch(history, /payout|payment|distribution|circulation history/i);
  });

  it("globals no longer hide fabricated commitment remaining columns", () => {
    const css = readFileSync(join(root, "app/globals.css"), "utf8");
    assert.doesNotMatch(
      css,
      /\.commons-table th:nth-child\(3\),\s*\n\s*\.commons-table th:nth-child\(4\)/,
    );
  });
});
