/**
 * P2E — public $VELL surface: homepage + /commons contracts, identity, SOL+VELL.
 * Structural tests (source content / wiring). No chain writes, no DB mutations.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  COMMONS_PUBLIC_PURSE_WALLET,
  COMMONS_PUBLIC_TREASURY_WALLET,
} from "@/lib/commons/public-wallets";
import {
  FENN_TOKEN_PUBLIC_DECIMALS,
  FENN_TOKEN_PUBLIC_INITIAL_PURSE_FORMATTED,
  FENN_TOKEN_PUBLIC_IDENTITY_ROWS,
  FENN_TOKEN_PUBLIC_NETWORK,
  FENN_TOKEN_PUBLIC_STANDARD,
  FENN_TOKEN_PUBLIC_TOTAL_SUPPLY_FORMATTED,
} from "@/lib/treasury/fenn-token-public-identity";

const repo = process.cwd();

function read(rel: string): string {
  return readFileSync(join(repo, rel), "utf8");
}

describe("P2E stable public identity constants", () => {
  it("matches launch design without any mint address", () => {
    assert.equal(FENN_TOKEN_PUBLIC_NETWORK, "mainnet-beta");
    assert.equal(FENN_TOKEN_PUBLIC_DECIMALS, 6);
    assert.equal(FENN_TOKEN_PUBLIC_STANDARD, "SPL");
    assert.equal(FENN_TOKEN_PUBLIC_TOTAL_SUPPLY_FORMATTED, "1,000,000,000");
    assert.equal(FENN_TOKEN_PUBLIC_INITIAL_PURSE_FORMATTED, "10,000,000");
    assert.ok(FENN_TOKEN_PUBLIC_IDENTITY_ROWS.length >= 6);
    const blob = JSON.stringify(FENN_TOKEN_PUBLIC_IDENTITY_ROWS);
    assert.doesNotMatch(blob, /0x[a-fA-F0-9]{40}/);
    assert.doesNotMatch(read("src/lib/treasury/fenn-token-public-identity.ts"), /0x[a-f]/i);
  });
});

describe("P2E public token surface wiring", () => {
  it("homepage header polls live official token without redeploy", () => {
    const page = read("src/app/page.tsx");
    const header = read("src/components/home/home-header-contract.tsx");
    const route = read("src/app/api/home/official-token/route.ts");
    assert.match(page, /HomeHeaderContract/);
    assert.match(page, /HomeHeaderContract[\s\S]*HomeLiveTicker/);
    assert.match(header, /\/api\/home\/official-token/);
    assert.match(header, /OFFICIAL CONTRACT/);
    assert.match(header, /NOT YET INSCRIBED/);
    assert.match(header, /FENN_TOKEN_PUBLIC_TICKER/);
    assert.match(header, /Solana explorer/);
    assert.match(route, /getPublicOfficialFennToken/);
    assert.match(route, /no-store/);
    assert.doesNotMatch(header, /0x[a-fA-F0-9]{40}/);
  });
});

describe("P2E Commons $VELL identity surface", () => {
  it("renders stable identity facts and LEAF distinction without CA", () => {
    const id = read("src/components/commons/fenn-token-identity.tsx");
    assert.match(id, /\$VELL|FENN_TOKEN_PUBLIC_TICKER/);
    assert.match(id, /LEAF IS NOT \$VELL/);
    assert.match(id, /off-chain/);
    assert.match(id, /on-chain/);
    assert.match(id, /Solana/);
    assert.match(id, /SPL/);
    assert.doesNotMatch(id, /PONS/i);
    assert.match(id, /FENN_TOKEN_PUBLIC_IDENTITY_ROWS/);
    assert.doesNotMatch(id, /0x[a-fA-F0-9]{40}/);
    assert.doesNotMatch(id, /market cap|price|FDV|buy now/i);
  });

  it("purse labels initial allocation and live SOL/VELL held", () => {
    const purse = read("src/components/commons/purse-readout.tsx");
    assert.match(purse, /INITIAL ALLOCATION/);
    assert.match(purse, /launch intent/);
    assert.match(purse, /awaiting official token/);
    assert.match(purse, /LIVE BALANCES/);
    assert.match(purse, /SOL HELD/);
    assert.match(purse, /VELL HELD/);
    assert.match(purse, /COMMONS_PUBLIC_PURSE_WALLET/);
    assert.match(purse, /view on Solana/);
    assert.doesNotMatch(purse, /CURRENT \$VELL BALANCE|CURRENT \$VELL/);
    assert.match(purse, /not the \$VELL token contract/);
    assert.match(purse, /FENN_TOKEN_PUBLIC_INITIAL_PURSE_FORMATTED/);
    assert.match(purse, /officialTokenResolved/);
    assert.doesNotMatch(purse, /permanently contains 10/);
  });

  it("treasury shows public Solana wallet and remains distinct from purse", () => {
    const treasury = read("src/components/commons/treasury-readout.tsx");
    assert.match(treasury, /COMMONS_PUBLIC_TREASURY_WALLET/);
    assert.match(treasury, /not the Purse/);
    assert.match(treasury, /contractAddress \?\? "native"/);
    assert.doesNotMatch(treasury, /getPublicOfficialFennToken/);
    assert.ok(COMMONS_PUBLIC_TREASURY_WALLET.length >= 32);
    assert.ok(COMMONS_PUBLIC_PURSE_WALLET.length >= 32);
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
