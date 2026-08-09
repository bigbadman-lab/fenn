/**
 * P2C.1 — launch ops: dormant row, launch:check status laws, resolver dormancy.
 * No chain, no writes to real DB in unit tests.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { ROBINHOOD_CHAIN_ID } from "@/lib/treasury/chain-definition";
import { resolveOfficialFennToken } from "@/lib/treasury/official-token";
import type { OfficialTokenCandidateRow } from "@/lib/treasury/types";
import {
  classifyFennLaunchStatus,
  EXPECTED_INITIAL_PURSE_ALLOCATION_FORMATTED,
  formatFennLaunchCheckReport,
  isDormantOfficialRowUnresolved,
  runFennLaunchCheck,
  type OfficialFlaggedRow,
} from "@/lib/ops/fenn-launch-check";
import { EconomicAuthorityLimitsError } from "@/lib/agent/economic-authority-limits";

const repo = process.cwd();

const META = {
  asset_type: "erc20",
  network: "robinhood_chain",
  official: true,
  public_contract: true,
};

function dormant(over: Partial<OfficialFlaggedRow> = {}): OfficialFlaggedRow {
  return {
    id: "dormant-1",
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

function live(addr = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"): OfficialFlaggedRow {
  return {
    ...dormant({ id: "live-1" }),
    contract_address: addr,
  };
}

const goodPurse = {
  configured: true as const,
  walletAddress: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  isEnabled: true,
  officialSettlementActivatedAt: null as string | null,
  economicSettlementEnabled: true as boolean | null,
};

function asCandidate(row: OfficialFlaggedRow): OfficialTokenCandidateRow {
  return {
    id: row.id,
    symbol: row.symbol,
    name: row.name,
    chain_id: row.chain_id,
    contract_address: row.contract_address,
    decimals: row.decimals,
    is_tracked: row.is_tracked,
    metadata: row.metadata,
  };
}

describe("P2C.1 dormant official row + resolver", () => {
  it("1. dormant NULL-address row does not resolve official FENN", () => {
    const row = asCandidate(dormant());
    assert.equal(isDormantOfficialRowUnresolved([row]), true);
    assert.equal(resolveOfficialFennToken([row]).status, "none");
  });

  it("same row material with valid address resolves", () => {
    const row = asCandidate(live());
    const r = resolveOfficialFennToken([row]);
    assert.equal(r.status, "ok");
    if (r.status === "ok") {
      assert.equal(r.token.contractAddress, live().contract_address);
      assert.equal(r.token.decimals, 18);
      assert.equal(r.token.chainId, 4663);
    }
  });

  it("5. non-integer/out-of-range decimals fail closed at resolver", () => {
    const row = asCandidate(live());
    row.decimals = -1;
    const r = resolveOfficialFennToken([row]);
    assert.equal(r.status, "invalid");
    if (r.status === "invalid") assert.equal(r.reason, "invalid_decimals");
  });

  it("5b. resolver accepts integer 6 but launch law requires 18 (CONFIG_ERROR)", () => {
    const liv = live();
    liv.decimals = 6;
    const lookup = resolveOfficialFennToken([asCandidate(liv)]);
    assert.equal(lookup.status, "ok");
    const c = classifyFennLaunchStatus({
      flaggedRows: [liv],
      lookup,
      purse: {
        ...goodPurse,
        officialSettlementActivatedAt: "2026-08-10T12:00:00.000Z",
      },
      limitsOk: true,
      officialBalance: "10000000",
      confirmedOfficialMovements: 0,
    });
    assert.equal(c.status, "CONFIG_ERROR");
    assert.ok(c.errors.includes("resolved_decimals_not_18"));
  });

  it("4. duplicate official candidates → ambiguous", () => {
    const a = asCandidate(live("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"));
    const b = asCandidate({
      ...live("0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"),
      id: "live-2",
    });
    const r = resolveOfficialFennToken([a, b]);
    assert.equal(r.status, "ambiguous");
  });

  it("6. malformed contract → invalid", () => {
    const row = asCandidate(live("not-an-address"));
    const r = resolveOfficialFennToken([row]);
    assert.equal(r.status, "invalid");
  });
});

describe("P2C.1 classifyFennLaunchStatus", () => {
  it("2. PRE_LAUNCH_READY", () => {
    const c = classifyFennLaunchStatus({
      flaggedRows: [dormant()],
      lookup: { status: "none" },
      purse: goodPurse,
      limitsOk: true,
      officialBalance: null,
      confirmedOfficialMovements: null,
    });
    assert.equal(c.status, "PRE_LAUNCH_READY");
    assert.equal(c.officialRowPrepared, true);
    assert.equal(c.officialRowId, "dormant-1");
  });

  it("3. missing dormant row → CONFIG_ERROR", () => {
    const c = classifyFennLaunchStatus({
      flaggedRows: [],
      lookup: { status: "none" },
      purse: goodPurse,
      limitsOk: true,
      officialBalance: null,
      confirmedOfficialMovements: null,
    });
    assert.equal(c.status, "CONFIG_ERROR");
    assert.ok(c.errors.includes("official_row_missing"));
  });

  it("4. duplicate official rows → CONFIG_ERROR", () => {
    const c = classifyFennLaunchStatus({
      flaggedRows: [dormant(), dormant({ id: "d2" })],
      lookup: { status: "none" },
      purse: goodPurse,
      limitsOk: true,
      officialBalance: null,
      confirmedOfficialMovements: null,
    });
    assert.equal(c.status, "CONFIG_ERROR");
    assert.ok(c.errors.some((e) => e.startsWith("multiple_")));
  });

  it("5. wrong decimals on dormant → CONFIG_ERROR", () => {
    const c = classifyFennLaunchStatus({
      flaggedRows: [dormant({ decimals: 9 })],
      lookup: { status: "none" },
      purse: goodPurse,
      limitsOk: true,
      officialBalance: null,
      confirmedOfficialMovements: null,
    });
    assert.equal(c.status, "CONFIG_ERROR");
    assert.ok(c.errors.includes("official_row_decimals_not_18"));
  });

  it("7. address configured but activation null → AWAITING_ACTIVATION", () => {
    const liv = live();
    const lookup = resolveOfficialFennToken([asCandidate(liv)]);
    const c = classifyFennLaunchStatus({
      flaggedRows: [liv],
      lookup,
      purse: { ...goodPurse, officialSettlementActivatedAt: null },
      limitsOk: true,
      officialBalance: "0",
      confirmedOfficialMovements: 0,
    });
    assert.equal(c.status, "TOKEN_CONFIGURED_AWAITING_ACTIVATION");
  });

  it("8. activated but balance low → AWAITING_PURSE_FUNDING", () => {
    const liv = live();
    const lookup = resolveOfficialFennToken([asCandidate(liv)]);
    const c = classifyFennLaunchStatus({
      flaggedRows: [liv],
      lookup,
      purse: {
        ...goodPurse,
        officialSettlementActivatedAt: "2026-08-10T12:00:00.000Z",
      },
      limitsOk: true,
      officialBalance: "9999999",
      confirmedOfficialMovements: 0,
    });
    assert.equal(c.status, "TOKEN_CONFIGURED_AWAITING_PURSE_FUNDING");
    assert.equal(c.allocationSatisfied, false);
  });

  it("9. activated + funded → LIVE_READY", () => {
    const liv = live();
    const lookup = resolveOfficialFennToken([asCandidate(liv)]);
    const c = classifyFennLaunchStatus({
      flaggedRows: [liv],
      lookup,
      purse: {
        ...goodPurse,
        officialSettlementActivatedAt: "2026-08-10T12:00:00.000Z",
      },
      limitsOk: true,
      officialBalance: EXPECTED_INITIAL_PURSE_ALLOCATION_FORMATTED,
      confirmedOfficialMovements: 0,
    });
    assert.equal(c.status, "LIVE_READY");
    assert.equal(c.allocationSatisfied, true);
  });

  it("9b. after spend below 10m still LIVE_READY when movements exist", () => {
    const liv = live();
    const lookup = resolveOfficialFennToken([asCandidate(liv)]);
    const c = classifyFennLaunchStatus({
      flaggedRows: [liv],
      lookup,
      purse: {
        ...goodPurse,
        officialSettlementActivatedAt: "2026-08-10T12:00:00.000Z",
      },
      limitsOk: true,
      officialBalance: "5000000",
      confirmedOfficialMovements: 3,
    });
    assert.equal(c.status, "LIVE_READY");
    assert.equal(c.allocationSatisfied, false);
  });

  it("10. brake false → BRAKED", () => {
    const c = classifyFennLaunchStatus({
      flaggedRows: [dormant()],
      lookup: { status: "none" },
      purse: { ...goodPurse, economicSettlementEnabled: false },
      limitsOk: true,
      officialBalance: null,
      confirmedOfficialMovements: null,
    });
    assert.equal(c.status, "BRAKED");
  });

  it("11. limits invalid → CONFIG_ERROR", () => {
    const c = classifyFennLaunchStatus({
      flaggedRows: [dormant()],
      lookup: { status: "none" },
      purse: goodPurse,
      limitsOk: false,
      limitsError: "authority_limit_invalid",
      officialBalance: null,
      confirmedOfficialMovements: null,
    });
    assert.equal(c.status, "CONFIG_ERROR");
  });
});

describe("P2C.1 runFennLaunchCheck side-effect free", () => {
  it("2/12/13/14/15. injected deps never write/claim/broadcast; no test token", async () => {
    let balanceReads = 0;
    let movements = 0;
    const report = await runFennLaunchCheck({
      listOfficialFlaggedRows: async () => [dormant()],
      getPurseConfig: async () => goodPurse,
      readOfficialPurseBalance: async () => {
        balanceReads += 1;
        throw new Error("must not read balance when unresolved");
      },
      countConfirmedOfficialMovements: async () => {
        movements += 1;
        return 0;
      },
      loadLimits: () => ({
        maxSingleTransferFormatted: "100000",
        maxSingleBurnFormatted: "50000",
        maxRolling24hOutflowFormatted: "500000",
        source: "production_defaults",
        profile: "production",
      }),
      env: {},
    });

    assert.equal(report.status, "PRE_LAUNCH_READY");
    assert.equal(report.chainBroadcastAttempted, false);
    assert.equal(report.sideEffectsAttempted, false);
    assert.equal(report.database.officialContractResolved, false);
    assert.equal(report.purse.officialFennBalance, null);
    assert.equal(balanceReads, 0);
    assert.equal(movements, 0);
    assert.equal(report.runtimeReadiness.xAgentDoesNotRequirePurseKey, true);
    assert.equal(
      report.purse.expectedLaunchAllocation,
      "10000000",
    );

    const text = formatFennLaunchCheckReport(report);
    assert.match(text, /status=PRE_LAUNCH_READY/);
    assert.doesNotMatch(text, /p1a_test|FENN_PURSE_TEST/);
  });

  it("LIVE_READY path uses official balance only", async () => {
    const liv = live();
    const report = await runFennLaunchCheck({
      listOfficialFlaggedRows: async () => [liv],
      getPurseConfig: async () => ({
        ...goodPurse,
        officialSettlementActivatedAt: "2026-08-10T12:00:00.000Z",
      }),
      readOfficialPurseBalance: async (input) => {
        assert.equal(input.tokenAddress, liv.contract_address);
        assert.equal(input.decimals, 18);
        return "10000000";
      },
      countConfirmedOfficialMovements: async () => 0,
      loadLimits: () => ({
        maxSingleTransferFormatted: "100000",
        maxSingleBurnFormatted: "50000",
        maxRolling24hOutflowFormatted: "500000",
        source: "production_defaults",
        profile: "production",
      }),
      env: {},
    });
    assert.equal(report.status, "LIVE_READY");
    assert.equal(report.purse.officialFennBalance, "10000000");
  });

  it("limits throw → CONFIG_ERROR", async () => {
    const report = await runFennLaunchCheck({
      listOfficialFlaggedRows: async () => [dormant()],
      getPurseConfig: async () => goodPurse,
      loadLimits: () => {
        throw new EconomicAuthorityLimitsError("boom");
      },
      env: {},
    });
    assert.equal(report.status, "CONFIG_ERROR");
    assert.equal(report.limits.productionProfileValid, false);
  });
});

describe("P2C.1 ops artifacts", () => {
  it("prep + activate SQL exist and encode safety laws", () => {
    const prep = join(repo, "docs/ops/fenn-launch-prep.sql");
    const act = join(repo, "docs/ops/fenn-launch-activate.sql");
    const runbook = join(repo, "docs/fenn-token-launch-runbook.md");
    assert.ok(existsSync(prep));
    assert.ok(existsSync(act));
    assert.ok(existsSync(runbook));

    const prepSql = readFileSync(prep, "utf8");
    assert.match(prepSql, /contract_address/i);
    assert.match(prepSql, /NULL,\s*\n\s*18/);
    assert.match(prepSql, /'official',\s*true/);
    assert.match(prepSql, /'public_contract',\s*true/);
    assert.match(prepSql, /FENN_LAUNCH_PREP/);
    assert.doesNotMatch(prepSql, /try_activate_official_settlement/);

    const actSql = readFileSync(act, "utf8");
    assert.match(actSql, /0xOFFICIAL_FENN_CONTRACT/);
    assert.match(actSql, /contract_address IS NULL/);
    assert.match(actSql, /is_normalized_evm_address/);
    assert.match(actSql, /refusing overwrite|already has contract|already set/i);
    assert.doesNotMatch(actSql, /SET\s+official_settlement_activated_at|SET\s+economic_settlement_enabled/i);
    assert.doesNotMatch(actSql, /UPDATE\s+purse_config/i);

    const pkg = JSON.parse(readFileSync(join(repo, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    assert.match(pkg.scripts["launch:check"] ?? "", /fenn-launch-check/);
  });

  it("launch check source never mutates via supabase writes", () => {
    const src = readFileSync(
      join(repo, "src/lib/ops/fenn-launch-check.ts"),
      "utf8",
    );
    assert.doesNotMatch(src, /\.insert\(/);
    assert.doesNotMatch(src, /\.update\(/);
    assert.doesNotMatch(src, /\.upsert\(/);
    assert.doesNotMatch(src, /\.delete\(/);
    assert.doesNotMatch(src, /claim_x_perception|executePending|executeTransfer/);
    assert.doesNotMatch(src, /resolveArmedPurseTestToken|executeManualTest/);
    assert.doesNotMatch(src, /try_activate_official_settlement/);
  });
});
