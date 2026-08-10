/**
 * P2E — public $FENN surface: homepage + /commons contracts, identity, ETH+FENN.
 * Structural tests (source content / wiring). No chain writes, no DB mutations.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  FENN_TOKEN_PUBLIC_CHAIN_ID,
  FENN_TOKEN_PUBLIC_DECIMALS,
  FENN_TOKEN_PUBLIC_INITIAL_PURSE_FORMATTED,
  FENN_TOKEN_PUBLIC_IDENTITY_ROWS,
  FENN_TOKEN_PUBLIC_LAUNCH_ROUTE,
  FENN_TOKEN_PUBLIC_STANDARD,
  FENN_TOKEN_PUBLIC_TOTAL_SUPPLY_FORMATTED,
} from "@/lib/treasury/fenn-token-public-identity";

const repo = process.cwd();

function read(rel: string): string {
  return readFileSync(join(repo, rel), "utf8");
}

describe("P2E stable public identity constants", () => {
  it("matches launch design without any contract address", () => {
    assert.equal(FENN_TOKEN_PUBLIC_CHAIN_ID, 4663);
    assert.equal(FENN_TOKEN_PUBLIC_DECIMALS, 18);
    assert.equal(FENN_TOKEN_PUBLIC_STANDARD, "ERC-20");
    assert.equal(FENN_TOKEN_PUBLIC_TOTAL_SUPPLY_FORMATTED, "1,000,000,000");
    assert.equal(FENN_TOKEN_PUBLIC_INITIAL_PURSE_FORMATTED, "10,000,000");
    assert.equal(FENN_TOKEN_PUBLIC_LAUNCH_ROUTE, "PONS");
    assert.ok(FENN_TOKEN_PUBLIC_IDENTITY_ROWS.length >= 6);
    const blob = JSON.stringify(FENN_TOKEN_PUBLIC_IDENTITY_ROWS);
    assert.doesNotMatch(blob, /0x[a-fA-F0-9]{40}/);
    assert.doesNotMatch(read("src/lib/treasury/fenn-token-public-identity.ts"), /0x[a-f]/i);
  });
});

describe("P2E OfficialFennContract pending + live wiring", () => {
  it("accepts token null pending and live contract without fallbacks", () => {
    const ui = read("src/components/commons/official-fenn-contract.tsx");
    assert.match(ui, /token:\s*PublicOfficialFennToken\s*\|\s*null/);
    assert.match(ui, /NOT YET INSCRIBED/);
    assert.match(ui, /VIEW CONTRACT/);
    assert.match(ui, /COPY/);
    assert.match(ui, /token\.contractAddress/);
    assert.match(ui, /token\.explorerUrl/);
    assert.doesNotMatch(ui, /0x0{40}|0x0000/);
    assert.doesNotMatch(ui, /purseAddress|treasuryAddress|FENN_PURSE/);
    assert.doesNotMatch(ui, /NEXT_PUBLIC_|process\.env/);
    // COPY only when live
    assert.match(ui, /if \(!token\) return;/);
  });

  it("homepage always mounts strip; no null early exit; request-time resolver only", () => {
    const home = read("src/components/home/home-official-contract.tsx");
    assert.match(home, /getPublicOfficialFennToken/);
    assert.match(home, /OfficialFennContract token=\{token\}/);
    assert.doesNotMatch(home, /return null/);
    assert.doesNotMatch(home, /0x[a-f0-9]{40}/i);
    assert.doesNotMatch(home, /module-level|globalThis|process\.env.*TOKEN/i);
  });

  it("homepage ISR and commons force-dynamic preserve live update path", () => {
    const page = read("src/app/page.tsx");
    const commons = read("src/app/commons/page.tsx");
    const identity = read("src/components/home/home-identity.tsx");
    assert.match(page, /revalidate\s*=\s*60/);
    assert.match(page, /HomeIdentity/);
    assert.doesNotMatch(page, /HomeOfficialContract/);
    assert.match(
      identity,
      /HomeOfficialContract[\s\S]*FennWorldMap/,
    );
    assert.match(commons, /dynamic\s*=\s*"force-dynamic"/);
    assert.match(commons, /FennTokenIdentity/);
    assert.match(commons, /OfficialFennContract token=\{officialToken\}/);
    assert.doesNotMatch(commons, /officialToken \?/);
  });
});

describe("P2E Commons $FENN identity surface", () => {
  it("renders stable identity facts and LEAF distinction without CA", () => {
    const id = read("src/components/commons/fenn-token-identity.tsx");
    assert.match(id, /\$FENN|FENN_TOKEN_PUBLIC_TICKER/);
    assert.match(id, /LEAF IS NOT \$FENN/);
    assert.match(id, /off-chain/);
    assert.match(id, /on-chain/);
    assert.match(id, /PONS/);
    assert.match(id, /FENN_TOKEN_PUBLIC_IDENTITY_ROWS/);
    assert.doesNotMatch(id, /0x[a-fA-F0-9]{40}/);
    assert.doesNotMatch(id, /market cap|price|FDV|buy now/i);
  });

  it("purse labels initial allocation and live ETH/FENN held", () => {
    const purse = read("src/components/commons/purse-readout.tsx");
    assert.match(purse, /INITIAL ALLOCATION/);
    assert.match(purse, /launch intent/);
    assert.match(purse, /awaiting official token/);
    assert.match(purse, /LIVE BALANCES/);
    assert.match(purse, /ETH HELD/);
    assert.match(purse, /FENN HELD/);
    assert.doesNotMatch(purse, /CURRENT \$FENN BALANCE|CURRENT \$FENN/);
    assert.match(purse, /not the \$FENN token contract/);
    assert.match(purse, /FENN_TOKEN_PUBLIC_INITIAL_PURSE_FORMATTED/);
    assert.match(purse, /officialTokenResolved/);
    assert.doesNotMatch(purse, /permanently contains 10/);
  });

  it("treasury remains distinct from purse and lists native/null-contract assets generically", () => {
    const treasury = read("src/components/commons/treasury-readout.tsx");
    assert.match(treasury, /not the Purse/);
    assert.match(treasury, /contractAddress \?\? "native"/);
    assert.doesNotMatch(treasury, /getPublicOfficialFennToken/);
  });
});

describe("P2E source-of-truth consistency", () => {
  it("page-data still uses getPublicOfficialFennToken only", () => {
    const data = read("src/lib/commons/page-data.ts");
    assert.match(data, /getPublicOfficialFennToken/);
    assert.doesNotMatch(data, /NEXT_PUBLIC|0x[a-f0-9]{40}/i);
  });

  it("no hardcoded official CA across P2E public surfaces", () => {
    const files = [
      "src/components/commons/official-fenn-contract.tsx",
      "src/components/home/home-official-contract.tsx",
      "src/components/commons/fenn-token-identity.tsx",
      "src/components/commons/purse-readout.tsx",
      "src/app/commons/page.tsx",
      "src/lib/treasury/fenn-token-public-identity.ts",
    ];
    for (const f of files) {
      const body = read(f);
      assert.doesNotMatch(body, /0x[a-fA-F0-9]{40}/, f);
      assert.doesNotMatch(body, /FENN_PURSE_PRIVATE_KEY|FENN_TOKEN_ADDRESS/, f);
    }
  });
});
