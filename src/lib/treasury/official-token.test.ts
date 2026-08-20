import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { SOLANA_MAINNET_CHAIN_ID } from "./chain-definition";
import {
  resolveOfficialFennToken,
  toPublicOfficialFennToken,
  getPublicOfficialFennToken,
} from "./official-token";
import type { OfficialTokenCandidateRow } from "./types";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "../../..");
/** Valid base58 pubkeys for unit tests (not production mints). */
const VELL_MINT = "So11111111111111111111111111111111111111112";
const OTHER_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

function candidate(
  overrides: Partial<OfficialTokenCandidateRow> = {},
): OfficialTokenCandidateRow {
  return {
    id: "1",
    symbol: "VELL",
    name: "VELL",
    chain_id: SOLANA_MAINNET_CHAIN_ID,
    contract_address: VELL_MINT,
    decimals: 6,
    is_tracked: true,
    metadata: { official: true, public_contract: true, asset_type: "spl" },
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

  it("selects one valid official public VELL mint", () => {
    const result = resolveOfficialFennToken([candidate()]);
    assert.equal(result.status, "ok");
    if (result.status !== "ok") return;
    assert.equal(result.token.symbol, "VELL");
    assert.equal(result.token.chainId, SOLANA_MAINNET_CHAIN_ID);
    assert.equal(result.token.contractAddress, VELL_MINT);
    assert.equal(result.token.decimals, 6);
  });

  it("accepts case-insensitive VELL/FENN symbol", () => {
    const result = resolveOfficialFennToken([
      candidate({ symbol: "fenn" }),
    ]);
    assert.equal(result.status, "ok");
    if (result.status !== "ok") return;
    assert.equal(result.token.symbol, "VELL");
  });

  it("ignores untracked rows", () => {
    const result = resolveOfficialFennToken([
      candidate({ is_tracked: false }),
    ]);
    assert.deepEqual(result, { status: "none" });
  });

  it("ignores null mint (dormant)", () => {
    const result = resolveOfficialFennToken([
      candidate({
        contract_address: null,
      }),
    ]);
    assert.deepEqual(result, { status: "none" });
  });

  it("ignores wrong chain rows", () => {
    const result = resolveOfficialFennToken([
      candidate({ chain_id: 4663 }),
    ]);
    assert.deepEqual(result, { status: "none" });
  });

  it("ignores unofficial SPL rows", () => {
    const result = resolveOfficialFennToken([
      candidate({
        symbol: "USDC",
        metadata: { asset_type: "spl" },
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
      candidate({ id: "b", contract_address: OTHER_MINT }),
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

  it("fails closed when symbol is not VELL/FENN", () => {
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

  it("preserves Solana mint casing (no lowercasing)", () => {
    const mixed = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
    const result = resolveOfficialFennToken([
      candidate({ contract_address: mixed }),
    ]);
    assert.equal(result.status, "ok");
    if (result.status !== "ok") return;
    assert.equal(result.token.contractAddress, mixed);
  });
});

describe("toPublicOfficialFennToken", () => {
  it("returns safe public fields with Solana explorer URL", () => {
    const token = toPublicOfficialFennToken({
      symbol: "VELL",
      name: "VELL",
      chainId: SOLANA_MAINNET_CHAIN_ID,
      contractAddress: VELL_MINT,
      decimals: 6,
    });
    assert.ok(token);
    assert.equal(token!.symbol, "VELL");
    assert.equal(token!.chainId, SOLANA_MAINNET_CHAIN_ID);
    assert.equal(token!.contractAddress, VELL_MINT);
    assert.match(token!.explorerUrl, /solscan\.io\/account\//);
    assert.match(token!.explorerUrl, new RegExp(VELL_MINT));
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
        symbol: "VELL",
        name: "VELL",
        chainId: SOLANA_MAINNET_CHAIN_ID,
        contractAddress: VELL_MINT,
        decimals: 6,
      },
    }));
    assert.ok(publicToken);
    assert.equal(publicToken!.contractAddress, VELL_MINT);
  });
});

describe("official VELL source safety + surfaces", () => {
  it("does not introduce env, mock, or trading paths", () => {
    const files = [
      "src/lib/treasury/official-token.ts",
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

  it("commons places identity after Treasury; no public contract strip", () => {
    const page = readFileSync(join(repo, "src/app/commons/page.tsx"), "utf8");
    assert.doesNotMatch(page, /OfficialFennContract/);
    assert.match(page, /FennTokenIdentity/);
    assert.match(page, /TreasuryReadout[\s\S]*FennTokenIdentity[\s\S]*PurseReadout/);
    assert.doesNotMatch(page, /coming soon|launch soon/i);
    assert.match(page, /WORLD_PULSE_COMMONS_MS/);
  });

  it("homepage header shows official contract from live DB poll", () => {
    const page = readFileSync(join(repo, "src/app/page.tsx"), "utf8");
    const identity = readFileSync(
      join(repo, "src/components/home/home-identity.tsx"),
      "utf8",
    );
    assert.match(page, /HomeHeaderContract/);
    assert.match(page, /HomeIdentity/);
    assert.match(page, /revalidate\s*=\s*60/);
    assert.match(page, /HomeFirstThirty[\s\S]*HomeIdentity[\s\S]*HomeOutlawRegister/);
    assert.doesNotMatch(identity, /HomeOfficialContract|OfficialFennContract/);
    assert.match(
      identity,
      /home-map-preface[\s\S]*FennWorldMap/,
    );
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

  it("migration 65 allows Solana mints; uniqueness for official/public on 101", () => {
    const migPath = join(
      repo,
      "supabase/migrations/20260820120000_65_treasury_assets_solana_official.sql",
    );
    assert.ok(existsSync(migPath));
    const mig = readFileSync(migPath, "utf8");
    assert.match(mig, /is_normalized_solana_address/);
    assert.match(mig, /treasury_assets_one_official_public_101_uidx/);
    assert.match(mig, /chain_id = 101/);
    assert.doesNotMatch(mig, /DELETE FROM public\.treasury_assets/i);
    assert.doesNotMatch(mig, /UPDATE public\.treasury_assets/i);

    const prep = readFileSync(
      join(repo, "docs/ops/fenn-launch-prep.sql"),
      "utf8",
    );
    assert.match(prep, /migration 65|65_treasury_assets_solana/i);
    assert.match(prep, /Does NOT modify ETH|Does NOT modify.*Robinhood/i);
    assert.match(prep, /chain_id = 101/);
    assert.match(prep, /'asset_type',\s*'spl'/);
  });

  it("dormant NULL VELL does not resolve", () => {
    const dormantVell = candidate({
      id: "vell-dormant",
      contract_address: null,
    });
    assert.equal(resolveOfficialFennToken([dormantVell]).status, "none");

    const live = candidate({ id: "vell-live" });
    const r = resolveOfficialFennToken([live]);
    assert.equal(r.status, "ok");
    if (r.status === "ok") {
      assert.equal(r.token.contractAddress, VELL_MINT);
    }
  });

  it("multiple official/public candidates still fail closed at resolver", () => {
    const a = candidate({ id: "a", contract_address: VELL_MINT });
    const b = candidate({ id: "b", contract_address: OTHER_MINT });
    assert.equal(resolveOfficialFennToken([a, b]).status, "ambiguous");
  });

  it("mobile/a11y CSS keeps token identity readable", () => {
    const css = readFileSync(join(repo, "src/app/globals.css"), "utf8");
    assert.match(css, /fenn-token-identity__facts/);
    assert.match(css, /overflow-wrap:\s*anywhere/);
    assert.match(css, /word-break:\s*break-all/);
  });

  it("snapshot still wires ETH tracking and officialToken independently", () => {
    const snapshot = readFileSync(join(repo, "src/lib/treasury/snapshot.ts"), "utf8");
    assert.match(snapshot, /getOfficialToken/);
    assert.match(snapshot, /officialToken/);
    assert.match(snapshot, /readNativeBalance|readNative/);
    assert.match(snapshot, /readErc20Balance|readErc20/);
  });
});
