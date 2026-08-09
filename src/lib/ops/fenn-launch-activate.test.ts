/**
 * P2C.2 — one-command official token activation CLI.
 * Injected deps only: no real DB / chain / X in unit tests.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { ROBINHOOD_CHAIN_ID } from "@/lib/treasury/chain-definition";
import {
  formatFennLaunchActivateReport,
  parseContractCliArg,
  runFennLaunchActivate,
  validateActivateCandidateIdentity,
  type ActivateCandidateRow,
  type GuardedSetContractResult,
} from "@/lib/ops/fenn-launch-activate";

const repo = process.cwd();

const OFFICIAL_ADDR = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const OTHER_ADDR = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const INVALID_ADDR = "0xnot-an-address";

const META = {
  asset_type: "erc20",
  network: "robinhood_chain",
  official: true,
  public_contract: true,
};

function dormant(over: Partial<ActivateCandidateRow> = {}): ActivateCandidateRow {
  return {
    id: "dormant-fenn-1",
    symbol: "FENN",
    name: "FENN",
    chain_id: ROBINHOOD_CHAIN_ID,
    contract_address: null,
    decimals: 18,
    is_tracked: true,
    metadata: { ...META },
    ...over,
  };
}

function ethNative(): ActivateCandidateRow {
  return {
    id: "eth-1",
    symbol: "ETH",
    name: "Ether",
    chain_id: ROBINHOOD_CHAIN_ID,
    contract_address: null,
    decimals: 18,
    is_tracked: true,
    metadata: {
      asset_type: "native",
      network: "robinhood_chain",
    },
  };
}

function live(
  addr = OFFICIAL_ADDR,
  over: Partial<ActivateCandidateRow> = {},
): ActivateCandidateRow {
  return dormant({
    id: "live-fenn-1",
    contract_address: addr,
    ...over,
  });
}

describe("P2C.2 parseContractCliArg", () => {
  it("reads --contract value", () => {
    const r = parseContractCliArg(["--contract", OFFICIAL_ADDR]);
    assert.equal(r.present, true);
    assert.equal(r.value, OFFICIAL_ADDR);
  });

  it("reads --contract=value", () => {
    const r = parseContractCliArg([`--contract=${OFFICIAL_ADDR}`]);
    assert.equal(r.present, true);
    assert.equal(r.value, OFFICIAL_ADDR);
  });

  it("5. missing argument", () => {
    const r = parseContractCliArg([]);
    assert.equal(r.present, false);
    assert.equal(r.value, null);
  });
});

describe("P2C.2 validateActivateCandidateIdentity", () => {
  it("accepts dormant official ERC20 FENN", () => {
    assert.equal(validateActivateCandidateIdentity(dormant()), null);
  });

  it("9. wrong chain", () => {
    assert.equal(
      validateActivateCandidateIdentity(dormant({ chain_id: 1 })),
      "chain_mismatch",
    );
  });

  it("8. wrong decimals", () => {
    assert.equal(
      validateActivateCandidateIdentity(dormant({ decimals: 6 })),
      "decimals_not_18",
    );
  });

  it("10. non-ERC20", () => {
    assert.equal(
      validateActivateCandidateIdentity(
        dormant({ metadata: { ...META, asset_type: "native" } }),
      ),
      "asset_type_not_erc20",
    );
  });

  it("11. missing official/public flags", () => {
    assert.equal(
      validateActivateCandidateIdentity(
        dormant({ metadata: { asset_type: "erc20" } }),
      ),
      "official_flag_missing",
    );
    assert.equal(
      validateActivateCandidateIdentity(
        dormant({
          metadata: {
            asset_type: "erc20",
            official: true,
          },
        }),
      ),
      "public_contract_flag_missing",
    );
  });
});

describe("P2C.2 runFennLaunchActivate", () => {
  it("1. valid dormant FENN → CONFIGURED", async () => {
    let writeCalls = 0;
    let writtenId: string | null = null;
    let writtenAddr: string | null = null;

    const report = await runFennLaunchActivate(
      { contract: OFFICIAL_ADDR },
      {
        listActivateCandidates: async () => [ethNative(), dormant()],
        guardedSetOfficialContract: async (input) => {
          writeCalls += 1;
          writtenId = input.id;
          writtenAddr = input.contractAddress;
          return {
            updated: true,
            row: live(input.contractAddress, { id: input.id }),
          };
        },
      },
    );

    assert.equal(report.status, "CONFIGURED");
    assert.equal(report.mode, "FENN_LAUNCH_ACTIVATE");
    assert.equal(report.symbol, "FENN");
    assert.equal(report.chainId, 4663);
    assert.equal(report.decimals, 18);
    assert.equal(report.contractAddress, OFFICIAL_ADDR);
    assert.equal(report.official, true);
    assert.equal(report.publicContract, true);
    assert.equal(report.settlementActivated, false);
    assert.equal(report.chainBroadcastAttempted, false);
    assert.equal(report.sideEffectsAttempted, true);
    assert.equal(writeCalls, 1);
    assert.equal(writtenId, "dormant-fenn-1");
    assert.equal(writtenAddr, OFFICIAL_ADDR);
    assert.ok(report.next?.some((s) => s.includes("launch:check")));
  });

  it("2. same-address rerun → ALREADY_CONFIGURED", async () => {
    let writeCalls = 0;
    const report = await runFennLaunchActivate(
      { contract: OFFICIAL_ADDR },
      {
        listActivateCandidates: async () => [live(OFFICIAL_ADDR)],
        guardedSetOfficialContract: async () => {
          writeCalls += 1;
          return { updated: false, row: null };
        },
      },
    );
    assert.equal(report.status, "ALREADY_CONFIGURED");
    assert.equal(report.sideEffectsAttempted, false);
    assert.equal(writeCalls, 0);
    assert.equal(report.contractAddress, OFFICIAL_ADDR);
  });

  it("3. different-address rerun → REFUSED", async () => {
    let writeCalls = 0;
    const report = await runFennLaunchActivate(
      { contract: OTHER_ADDR },
      {
        listActivateCandidates: async () => [live(OFFICIAL_ADDR)],
        guardedSetOfficialContract: async () => {
          writeCalls += 1;
          return { updated: false, row: null };
        },
      },
    );
    assert.equal(report.status, "REFUSED");
    assert.equal(report.errorCode, "official_contract_already_configured");
    assert.equal(report.sideEffectsAttempted, false);
    assert.equal(writeCalls, 0);
  });

  it("4. invalid EVM address → no write", async () => {
    let writeCalls = 0;
    const report = await runFennLaunchActivate(
      { contract: INVALID_ADDR },
      {
        listActivateCandidates: async () => [dormant()],
        guardedSetOfficialContract: async () => {
          writeCalls += 1;
          return { updated: true, row: live() };
        },
      },
    );
    assert.equal(report.status, "REFUSED");
    assert.equal(report.errorCode, "invalid_contract_address");
    assert.equal(writeCalls, 0);
    assert.equal(report.sideEffectsAttempted, false);
  });

  it("5. missing argument → no write", async () => {
    let writeCalls = 0;
    const report = await runFennLaunchActivate(
      { contract: null },
      {
        listActivateCandidates: async () => [dormant()],
        guardedSetOfficialContract: async () => {
          writeCalls += 1;
          return { updated: true, row: live() };
        },
      },
    );
    assert.equal(report.status, "REFUSED");
    assert.equal(report.errorCode, "missing_contract");
    assert.equal(writeCalls, 0);
  });

  it("6. missing FENN row → no write", async () => {
    let writeCalls = 0;
    const report = await runFennLaunchActivate(
      { contract: OFFICIAL_ADDR },
      {
        listActivateCandidates: async () => [ethNative()],
        guardedSetOfficialContract: async () => {
          writeCalls += 1;
          return { updated: true, row: live() };
        },
      },
    );
    assert.equal(report.status, "REFUSED");
    assert.equal(report.errorCode, "official_row_missing");
    assert.equal(writeCalls, 0);
  });

  it("7. duplicate candidates → no write", async () => {
    let writeCalls = 0;
    const report = await runFennLaunchActivate(
      { contract: OFFICIAL_ADDR },
      {
        listActivateCandidates: async () => [
          dormant({ id: "a" }),
          dormant({ id: "b" }),
        ],
        guardedSetOfficialContract: async () => {
          writeCalls += 1;
          return { updated: true, row: live() };
        },
      },
    );
    assert.equal(report.status, "REFUSED");
    assert.equal(report.errorCode, "multiple_official_candidates");
    assert.equal(writeCalls, 0);
  });

  it("8. wrong decimals → no write", async () => {
    let writeCalls = 0;
    const report = await runFennLaunchActivate(
      { contract: OFFICIAL_ADDR },
      {
        listActivateCandidates: async () => [dormant({ decimals: 6 })],
        guardedSetOfficialContract: async () => {
          writeCalls += 1;
          return { updated: true, row: live() };
        },
      },
    );
    assert.equal(report.status, "REFUSED");
    assert.equal(report.errorCode, "decimals_not_18");
    assert.equal(writeCalls, 0);
  });

  it("9. wrong chain → no write", async () => {
    let writeCalls = 0;
    // Wrong-chain FENN never enters official candidates; treated as missing
    const report = await runFennLaunchActivate(
      { contract: OFFICIAL_ADDR },
      {
        listActivateCandidates: async () => [
          dormant({ chain_id: 1, id: "wrong-chain" }),
        ],
        guardedSetOfficialContract: async () => {
          writeCalls += 1;
          return { updated: true, row: live() };
        },
      },
    );
    assert.equal(report.status, "REFUSED");
    assert.equal(report.errorCode, "official_row_missing");
    assert.equal(writeCalls, 0);
  });

  it("10. non-ERC20 candidate → no write", async () => {
    let writeCalls = 0;
    const report = await runFennLaunchActivate(
      { contract: OFFICIAL_ADDR },
      {
        listActivateCandidates: async () => [
          dormant({
            metadata: {
              ...META,
              asset_type: "native",
            },
          }),
        ],
        guardedSetOfficialContract: async () => {
          writeCalls += 1;
          return { updated: true, row: live() };
        },
      },
    );
    assert.equal(report.status, "REFUSED");
    assert.equal(report.errorCode, "asset_type_not_erc20");
    assert.equal(writeCalls, 0);
  });

  it("11. official/public flags missing → no write", async () => {
    let writeCalls = 0;
    const report = await runFennLaunchActivate(
      { contract: OFFICIAL_ADDR },
      {
        listActivateCandidates: async () => [
          dormant({
            metadata: { asset_type: "erc20", network: "robinhood_chain" },
          }),
        ],
        guardedSetOfficialContract: async () => {
          writeCalls += 1;
          return { updated: true, row: live() };
        },
      },
    );
    assert.equal(report.status, "REFUSED");
    // filtered out of official/public pool
    assert.equal(report.errorCode, "official_row_missing");
    assert.equal(writeCalls, 0);
  });

  it("12. ETH untouched — write only uses dormant FENN id", async () => {
    let writtenId: string | null = null;
    await runFennLaunchActivate(
      { contract: OFFICIAL_ADDR },
      {
        listActivateCandidates: async () => [ethNative(), dormant()],
        guardedSetOfficialContract: async (input) => {
          writtenId = input.id;
          assert.notEqual(input.id, "eth-1");
          return {
            updated: true,
            row: live(input.contractAddress, { id: input.id }),
          };
        },
      },
    );
    assert.equal(writtenId, "dormant-fenn-1");
  });

  it("13–18. no purse_config / settlement / broadcast / amounts in report or write payload", async () => {
    const writePayloads: unknown[] = [];
    const report = await runFennLaunchActivate(
      { contract: OFFICIAL_ADDR },
      {
        listActivateCandidates: async () => [dormant()],
        guardedSetOfficialContract: async (input) => {
          writePayloads.push(input);
          return {
            updated: true,
            row: live(input.contractAddress, { id: input.id }),
          };
        },
      },
    );

    assert.equal(report.settlementActivated, false);
    assert.equal(report.chainBroadcastAttempted, false);
    assert.deepEqual(writePayloads, [
      { id: "dormant-fenn-1", contractAddress: OFFICIAL_ADDR },
    ]);
    const text = formatFennLaunchActivateReport(report);
    assert.doesNotMatch(text, /purse_config|try_activate_official_settlement|x\.com|postTweet/i);
    assert.match(text, /settlementActivated=false/);
    assert.match(text, /chainBroadcastAttempted=false/);
    assert.match(text, /sideEffectsAttempted=true/);
    assert.match(text, /NEXT:/);
  });

  it("19. guarded update cannot overwrite concurrent activation", async () => {
    const report = await runFennLaunchActivate(
      { contract: OFFICIAL_ADDR },
      {
        listActivateCandidates: async () => [dormant()],
        guardedSetOfficialContract: async (): Promise<GuardedSetContractResult> => ({
          updated: false,
          row: null,
        }),
      },
    );
    assert.equal(report.status, "REFUSED");
    assert.equal(report.errorCode, "dormant_row_race");
    assert.equal(report.sideEffectsAttempted, true);
  });

  it("uppercase input normalizes before write", async () => {
    let written: string | null = null;
    const upper = "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    const report = await runFennLaunchActivate(
      { contract: upper },
      {
        listActivateCandidates: async () => [dormant()],
        guardedSetOfficialContract: async (input) => {
          written = input.contractAddress;
          return {
            updated: true,
            row: live(input.contractAddress, { id: input.id }),
          };
        },
      },
    );
    assert.equal(report.status, "CONFIGURED");
    assert.equal(written, OFFICIAL_ADDR);
    assert.equal(report.contractAddress, OFFICIAL_ADDR);
  });
});

describe("P2C.2 artifacts + safety surface", () => {
  it("CLI, package script, runbook primary path", () => {
    const lib = join(repo, "src/lib/ops/fenn-launch-activate.ts");
    const script = join(repo, "scripts/fenn-launch-activate.ts");
    const sql = join(repo, "docs/ops/fenn-launch-activate.sql");
    const runbook = join(repo, "docs/fenn-token-launch-runbook.md");
    assert.ok(existsSync(lib));
    assert.ok(existsSync(script));
    assert.ok(existsSync(sql));
    assert.ok(existsSync(runbook));

    const src = readFileSync(lib, "utf8");
    assert.match(src, /contract_address/);
    assert.match(src, /\.is\("contract_address",\s*null\)/);
    assert.doesNotMatch(src, /try_activate_official_settlement/);
    assert.doesNotMatch(src, /official_settlement_activated_at/);
    assert.doesNotMatch(src, /purse_config/);
    assert.doesNotMatch(src, /executePending|executeTransfer|claim_x/);
    assert.doesNotMatch(src, /postTweet|publishToX|x_post/i);
    // Single-column intent
    assert.match(src, /update\(\{\s*contract_address:/);

    const pkg = JSON.parse(readFileSync(join(repo, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    assert.match(pkg.scripts["launch:activate"] ?? "", /fenn-launch-activate/);

    const rb = readFileSync(runbook, "utf8");
    assert.match(rb, /launch:activate/);
    assert.match(rb, /PRIMARY|--contract/i);
  });

  it("does not hardcode a real production address", () => {
    const src = readFileSync(
      join(repo, "src/lib/ops/fenn-launch-activate.ts"),
      "utf8",
    );
    assert.doesNotMatch(src, /0x[a-f0-9]{40}/i);
  });
});
