import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { ROBINHOOD_CHAIN_ID } from "./chain-definition";
import {
  resolveOfficialFennToken,
  toPublicOfficialFennToken,
  getPublicOfficialFennToken,
} from "./official-token";
import type { OfficialTokenCandidateRow } from "./types";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "../../..");
const FENN = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const OTHER = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

function candidate(
  overrides: Partial<OfficialTokenCandidateRow> = {},
): OfficialTokenCandidateRow {
  return {
    id: "1",
    symbol: "FENN",
    name: "FENN",
    chain_id: ROBINHOOD_CHAIN_ID,
    contract_address: FENN,
    decimals: 18,
    is_tracked: true,
    metadata: { official: true, public_contract: true },
    ...overrides,
  };
}

describe("resolveOfficialFennToken", () => {
  it("returns none when no official row exists", () => {
    assert.deepEqual(resolveOfficialFennToken([]), { status: "none" });
    assert.deepEqual(
      resolveOfficialFennToken([
        candidate({
          metadata: {},
        }),
      ]),
      { status: "none" },
    );
  });

  it("selects one valid official public FENN row", () => {
    const result = resolveOfficialFennToken([candidate()]);
    assert.equal(result.status, "ok");
    if (result.status !== "ok") return;
    assert.equal(result.token.symbol, "FENN");
    assert.equal(result.token.chainId, ROBINHOOD_CHAIN_ID);
    assert.equal(result.token.contractAddress, FENN);
    assert.equal(result.token.decimals, 18);
  });

  it("accepts case-insensitive FENN symbol", () => {
    const result = resolveOfficialFennToken([
      candidate({ symbol: "fenn" }),
    ]);
    assert.equal(result.status, "ok");
    if (result.status !== "ok") return;
    assert.equal(result.token.symbol, "FENN");
  });

  it("ignores untracked rows", () => {
    const result = resolveOfficialFennToken([
      candidate({ is_tracked: false }),
    ]);
    assert.deepEqual(result, { status: "none" });
  });

  it("ignores native ETH (null contract)", () => {
    const result = resolveOfficialFennToken([
      candidate({
        symbol: "ETH",
        contract_address: null,
        metadata: { official: true, public_contract: true },
      }),
    ]);
    assert.deepEqual(result, { status: "none" });
  });

  it("ignores wrong chain rows", () => {
    const result = resolveOfficialFennToken([
      candidate({ chain_id: 1 }),
    ]);
    assert.deepEqual(result, { status: "none" });
  });

  it("ignores unofficial ERC-20 rows", () => {
    const result = resolveOfficialFennToken([
      candidate({
        symbol: "USDC",
        metadata: { asset_type: "erc20" },
      }),
      candidate({
        metadata: { official: true }, // missing public_contract
      }),
    ]);
    assert.deepEqual(result, { status: "none" });
  });

  it("fails closed on multiple official public rows", () => {
    const result = resolveOfficialFennToken([
      candidate({ id: "a" }),
      candidate({ id: "b", contract_address: OTHER }),
    ]);
    assert.deepEqual(result, { status: "ambiguous", count: 2 });
  });

  it("fails closed on invalid addresses", () => {
    const result = resolveOfficialFennToken([
      candidate({ contract_address: "not-an-address" }),
    ]);
    assert.deepEqual(result, {
      status: "invalid",
      reason: "invalid_address",
    });
  });

  it("fails closed when symbol is not FENN", () => {
    const result = resolveOfficialFennToken([
      candidate({ symbol: "FAKE" }),
    ]);
    assert.deepEqual(result, {
      status: "invalid",
      reason: "symbol_mismatch",
    });
  });

  it("accepts string metadata flags", () => {
    const result = resolveOfficialFennToken([
      candidate({
        metadata: { official: "true", public_contract: "true" },
      }),
    ]);
    assert.equal(result.status, "ok");
  });
});

describe("toPublicOfficialFennToken", () => {
  it("returns safe public fields with Robinhood explorer URL", () => {
    const token = toPublicOfficialFennToken({
      symbol: "FENN",
      name: "FENN",
      chainId: ROBINHOOD_CHAIN_ID,
      contractAddress: FENN,
      decimals: 18,
    });
    assert.ok(token);
    assert.equal(token!.symbol, "FENN");
    assert.equal(token!.chainId, ROBINHOOD_CHAIN_ID);
    assert.equal(token!.contractAddress, FENN);
    assert.equal(
      token!.explorerUrl,
      `https://robinhoodchain.blockscout.com/address/${FENN}`,
    );
    const json = JSON.stringify(token);
    assert.doesNotMatch(json, /metadata|official|public_contract|decimals|"id"/);
    assert.doesNotMatch(json, /ROBINHOOD_CHAIN_RPC|rpcUrl|private/i);
  });
});

describe("getPublicOfficialFennToken fail-closed", () => {
  it("returns null for empty / ambiguous / invalid without throwing", async () => {
    assert.equal(
      await getPublicOfficialFennToken(async () => ({ status: "none" })),
      null,
    );
    assert.equal(
      await getPublicOfficialFennToken(async () => ({
        status: "ambiguous",
        count: 2,
      })),
      null,
    );
    assert.equal(
      await getPublicOfficialFennToken(async () => ({
        status: "invalid",
        reason: "invalid_address",
      })),
      null,
    );
  });

  it("returns public token on ok lookup", async () => {
    const publicToken = await getPublicOfficialFennToken(async () => ({
      status: "ok",
      token: {
        symbol: "FENN",
        name: "FENN",
        chainId: ROBINHOOD_CHAIN_ID,
        contractAddress: FENN,
        decimals: 18,
      },
    }));
    assert.ok(publicToken);
    assert.equal(publicToken!.contractAddress, FENN);
  });
});

describe("official FENN source safety + surfaces", () => {
  it("does not introduce env, mock, or trading paths", () => {
    const files = [
      "src/lib/treasury/official-token.ts",
      "src/components/commons/official-fenn-contract.tsx",
      "src/components/home/home-official-contract.tsx",
      "src/lib/commons/page-data.ts",
      "src/app/commons/page.tsx",
      "src/app/page.tsx",
      "src/lib/desk/treasury.ts",
      "src/components/desk/desk-treasury-panel.tsx",
    ];
    for (const rel of files) {
      const source = readFileSync(join(repo, rel), "utf8");
      assert.doesNotMatch(source, /NEXT_PUBLIC_FENN_TOKEN|FENN_TOKEN_ADDRESS/);
      assert.doesNotMatch(
        source,
        /0xREPLACE|PLACEHOLDER_.*CONTRACT|0xdeadbeef/i,
      );
      assert.doesNotMatch(
        source,
        /dexscreener|uniswap|swap|approve\(|writeContract|sendTransaction|priceFeed|coingecko/i,
      );
    }
  });

  it("commons places contract after Treasury and hides when null", () => {
    const page = readFileSync(join(repo, "src/app/commons/page.tsx"), "utf8");
    assert.match(page, /OfficialFennContract/);
    assert.match(page, /officialToken \?/);
    assert.match(page, /TreasuryReadout[\s\S]*OfficialFennContract/);
    assert.doesNotMatch(page, /coming soon|launch soon/i);
    assert.match(page, /WORLD_PULSE_COMMONS_MS/);
  });

  it("commons UI copies full address and Robinhood explorer", () => {
    const ui = readFileSync(
      join(repo, "src/components/commons/official-fenn-contract.tsx"),
      "utf8",
    );
    assert.match(ui, /contract copied\./);
    assert.match(ui, /the contract could not be copied\./);
    assert.match(ui, /aria-live="polite"/);
    assert.match(ui, /token\.contractAddress/);
    assert.match(ui, /token\.explorerUrl/);
    assert.match(ui, /noopener noreferrer/);
    assert.match(ui, /COPY CONTRACT|COPY/);
    assert.match(ui, /VIEW ON ROBINHOOD CHAIN|VERIFY/);
    assert.doesNotMatch(ui, /dexscreener|uniswap|coingecko|market cap|writeContract/i);
  });

  it("homepage mounts compact strip with ISR freshness, no placeholder", () => {
    const page = readFileSync(join(repo, "src/app/page.tsx"), "utf8");
    const home = readFileSync(
      join(repo, "src/components/home/home-official-contract.tsx"),
      "utf8",
    );
    assert.match(page, /HomeOfficialContract/);
    assert.match(page, /revalidate\s*=\s*60/);
    assert.match(page, /HomeGreenwoodTeaser[\s\S]*HomeOfficialContract[\s\S]*HomePaths/);
    assert.match(home, /getPublicOfficialFennToken/);
    assert.match(home, /if \(!token\) return null/);
    assert.doesNotMatch(home, /0x[a-f0-9]{40}/i);
    assert.doesNotMatch(page, /NEXT_PUBLIC_FENN_TOKEN/);
  });

  it("does not put token contract into Outlaw wallet UI", () => {
    const wallet = readFileSync(
      join(repo, "src/components/outlaw/outlaw-wallet.tsx"),
      "utf8",
    );
    const outlawPage = readFileSync(join(repo, "src/app/outlaw/page.tsx"), "utf8");
    assert.doesNotMatch(wallet, /official.?token|OfficialFenn|public_contract/i);
    assert.doesNotMatch(
      outlawPage,
      /OfficialFennContract|OFFICIAL FENN CONTRACT|home-official-token/,
    );
    assert.match(wallet, /YOUR WALLET|profile\.walletAddress/);
  });

  it("Desk shows configured / not configured / needs attention", () => {
    const lib = readFileSync(join(repo, "src/lib/desk/treasury.ts"), "utf8");
    const ui = readFileSync(
      join(repo, "src/components/desk/desk-treasury-panel.tsx"),
      "utf8",
    );
    assert.match(lib, /not_configured|configured|needs_attention/);
    assert.match(lib, /CONTRACT CONFIGURATION NEEDS ATTENTION/);
    assert.match(lib, /tracked · public/);
    assert.match(ui, /OFFICIAL FENN CONTRACT/);
    assert.match(ui, /not configured/);
    assert.match(ui, /officialFenn\.detail|needs_attention/);
  });

  it("migration and ops docs exist without seeded address", () => {
    const mig = join(
      repo,
      "supabase/migrations/20260803150000_44_official_fenn_token.sql",
    );
    const verify = join(repo, "supabase/verify_official_fenn_token.sql");
    const ops = join(
      repo,
      "supabase/examples/official_fenn_token_ops_example.sql",
    );
    assert.ok(existsSync(mig));
    assert.ok(existsSync(verify));
    assert.ok(existsSync(ops));
    const migBody = readFileSync(mig, "utf8");
    const opsBody = readFileSync(ops, "utf8");
    assert.match(migBody, /treasury_assets_one_official_public_4663_uidx/);
    assert.doesNotMatch(migBody, /INSERT INTO public\.treasury_assets/i);
    assert.match(opsBody, /REPLACE_WITH_OFFICIAL_CONTRACT/);
    assert.match(opsBody, /public_contract/);
    assert.match(opsBody, /official.*true/i);
  });

  it("migration 62 allows multiple NULL contracts; uniqueness only for non-null", () => {
    const migPath = join(
      repo,
      "supabase/migrations/20260809210000_62_treasury_assets_null_contract_uidx.sql",
    );
    assert.ok(existsSync(migPath));
    const mig = readFileSync(migPath, "utf8");
    assert.match(mig, /DROP INDEX IF EXISTS public\.treasury_assets_chain_contract_uidx/);
    assert.match(mig, /CREATE UNIQUE INDEX treasury_assets_chain_contract_uidx/);
    assert.match(mig, /WHERE contract_address IS NOT NULL/);
    // Index body must not reintroduce NULLS NOT DISTINCT uniqueness
    const createBlock = mig.slice(mig.indexOf("CREATE UNIQUE INDEX"));
    assert.doesNotMatch(createBlock, /NULLS NOT DISTINCT/);
    assert.doesNotMatch(
      mig,
      /DROP INDEX.*treasury_assets_one_official_public_4663_uidx/i,
    );
    assert.doesNotMatch(mig, /DELETE FROM public\.treasury_assets/i);
    assert.doesNotMatch(mig, /UPDATE public\.treasury_assets/i);

    const prep = readFileSync(
      join(repo, "docs/ops/fenn-launch-prep.sql"),
      "utf8",
    );
    assert.match(prep, /migration 62|62_treasury_assets_null_contract/i);
    assert.match(prep, /Does NOT modify the existing ETH/i);
    assert.match(prep, /null_contract_coexistence/);

    const stage7Origin = readFileSync(
      join(repo, "supabase/migrations/20260722180007_07_treasury_commons.sql"),
      "utf8",
    );
    assert.match(stage7Origin, /NULLS NOT DISTINCT/);
  });

  it("dormant NULL FENN does not resolve alongside native ETH null candidate", () => {
    const ethNative: OfficialTokenCandidateRow = {
      id: "eth",
      symbol: "ETH",
      name: "Ether",
      chain_id: ROBINHOOD_CHAIN_ID,
      contract_address: null,
      decimals: 18,
      is_tracked: true,
      metadata: { asset_type: "native", network: "robinhood_chain" },
    };
    const dormantFenn = candidate({
      id: "fenn-dormant",
      contract_address: null,
    });
    assert.equal(
      resolveOfficialFennToken([ethNative, dormantFenn]).status,
      "none",
    );

    const live = candidate({ id: "fenn-live" });
    const r = resolveOfficialFennToken([ethNative, live]);
    assert.equal(r.status, "ok");
    if (r.status === "ok") {
      assert.equal(r.token.contractAddress, FENN);
    }
  });

  it("multiple official/public candidates still fail closed at resolver", () => {
    const a = candidate({ id: "a", contract_address: FENN });
    const b = candidate({ id: "b", contract_address: OTHER });
    assert.equal(resolveOfficialFennToken([a, b]).status, "ambiguous");
  });

  it("mobile/a11y CSS uses wrap + forced-colours CanvasText", () => {
    const css = readFileSync(join(repo, "src/app/globals.css"), "utf8");
    assert.match(css, /commons-official-token__address/);
    assert.match(css, /home-official-token__address/);
    assert.match(css, /overflow-wrap:\s*anywhere/);
    assert.match(css, /word-break:\s*break-all/);
    assert.match(
      css,
      /forced-colors:\s*active[\s\S]*commons-official-token__address[\s\S]*CanvasText/,
    );
  });

  it("snapshot still wires ETH tracking and officialToken independently", () => {
    const snapshot = readFileSync(join(repo, "src/lib/treasury/snapshot.ts"), "utf8");
    assert.match(snapshot, /getOfficialToken/);
    assert.match(snapshot, /officialToken/);
    assert.match(snapshot, /readNativeBalance|readNative/);
    assert.match(snapshot, /readErc20Balance|readErc20/);
  });
});
