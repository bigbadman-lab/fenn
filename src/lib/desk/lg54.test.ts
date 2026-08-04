import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  campaignRequiresAttention,
  emptyStatusCounts,
  isOnChainRewardType,
} from "@/lib/desk/hollow-types";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "../../..");

function read(rel: string): string {
  return readFileSync(join(repo, rel), "utf8");
}

function walkTs(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkTs(full));
    else if (entry.name.endsWith(".ts")) out.push(full);
  }
  return out;
}

describe("LG5.4 Desk Hollow access isolation", () => {
  it("every Desk Hollow API route requires Desk access only", () => {
    const root = join(repo, "src/app/api/desk/hollow");
    const routes = walkTs(root);
    assert.ok(routes.length >= 10, "expected Desk Hollow routes");
    for (const abs of routes) {
      const source = readFileSync(abs, "utf8");
      assert.match(source, /requireFennDeskAccess/);
      assert.doesNotMatch(source, /requireFennAdmin/);
      assert.doesNotMatch(source, /\/api\/admin/);
      assert.doesNotMatch(source, /FENN_ADMIN_WALLETS|GREENWOOD_ACCESS_WALLETS/);
      assert.doesNotMatch(source, /either allowlist|dual allowlist/i);
    }
  });

  it("Desk Hollow lib reuses LG4 campaign-ops and does not invent dual auth", () => {
    const lib = read("src/lib/desk/hollow.ts");
    assert.match(lib, /adminCreateCampaignDraft/);
    assert.match(lib, /adminCreateCampaignFromGathering/);
    assert.match(lib, /adminPreviewCampaign/);
    assert.match(lib, /adminResolveCampaign/);
    assert.match(lib, /adminMakeCampaignAvailable/);
    assert.match(lib, /adminCancelCampaign/);
    assert.match(lib, /adminRecordTransaction/);
    assert.match(lib, /adminCorrectTransaction/);
    assert.match(lib, /adminMarkConfirmed/);
    assert.match(lib, /greenwood\/hollow\/campaign-ops/);
    assert.doesNotMatch(lib, /requireFennAdmin|FENN_ADMIN_WALLETS/);
    assert.doesNotMatch(lib, /privateKey|signTransaction|walletClient/i);
  });

  it("Admin reward routes remain independently gated", () => {
    const adminList = read("src/app/api/admin/greenwood/rewards/route.ts");
    const adminPage = read("src/app/admin/greenwood/rewards/page.tsx");
    assert.match(adminList, /requireFennAdmin/);
    assert.doesNotMatch(adminList, /requireFennDeskAccess|FENN_DESK/);
    assert.match(adminPage, /AdminRewardsBoard/);
  });

  it("mutation routes use server-resolved actorId", () => {
    const resolve = read(
      "src/app/api/desk/hollow/campaigns/[id]/resolve/route.ts",
    );
    const record = read(
      "src/app/api/desk/hollow/rewards/[rewardId]/record-transaction/route.ts",
    );
    assert.match(resolve, /identity\.actorId/);
    assert.match(record, /identity\.actorId/);
    assert.doesNotMatch(resolve, /body\.actorId|body\.keeper/);
    assert.doesNotMatch(record, /body\.actorId/);
  });
});

describe("LG5.4 Desk Hollow product surfaces", () => {
  it("nav includes The Hollow and excludes unfinished surfaces", () => {
    const gate = read("src/components/desk/desk-gate.tsx");
    assert.match(gate, /\/desk\/hollow/);
    assert.match(gate, /The Hollow/);
    assert.match(gate, /\/desk\/deeds/);
    assert.match(gate, /\/desk\/treasury/);
    assert.match(gate, /\/desk\/book/);
    assert.match(gate, /\/desk\/agent/);
  });

  it("UI uses Desk-native APIs and truthful confirmations", () => {
    const board = read("src/components/desk/desk-hollow-board.tsx");
    const detail = read("src/components/desk/desk-hollow-detail-panel.tsx");
    assert.match(board, /\/api\/desk\/hollow\/campaigns/);
    assert.match(board, /\/api\/desk\/register/);
    assert.doesNotMatch(board, /\/api\/admin/);
    assert.match(detail, /RESOLVE THIS CAMPAIGN/);
    assert.match(detail, /The recipient list cannot be changed after it is resolved/);
    assert.match(detail, /PLACE THESE REWARDS IN THE HOLLOW/);
    assert.match(detail, /Members must claim through their own Hollow/);
    assert.match(detail, /MARK AS CONFIRMED/);
    assert.match(detail, /operational confirmation/);
    assert.match(detail, /does not independently verify the chain/);
    assert.doesNotMatch(detail, /\/api\/admin|claim on behalf|privateKey/i);
    assert.doesNotMatch(board, /wallet CSV|paste.*wallet|select every/i);
  });

  it("Gathering detail links into Desk Hollow creation", () => {
    const detail = read("src/components/desk/desk-gathering-detail-panel.tsx");
    const operate = read("src/components/desk/desk-gathering-operate.tsx");
    assert.match(detail, /DeskGatheringOperate/);
    assert.match(operate, /CREATE HOLLOW CAMPAIGN/);
    assert.match(operate, /\/desk\/hollow\?gathering=/);
    assert.match(operate, /\/desk\/hollow\/\$\{view\.rewardCampaign\.id\}/);
  });

  it("Overview Hollow signals link to Desk Hollow", () => {
    const overview = read("src/lib/desk/overview.ts");
    assert.match(overview, /href: "\/desk\/hollow"/);
    assert.match(overview, /href: "\/desk\/hollow\?filter=requires_attention"/);
  });

  it("Register member can open Hollow create without awarding", () => {
    const member = read("src/components/desk/desk-register-member-panel.tsx");
    assert.match(member, /\/desk\/hollow\?profile=/);
    assert.match(member, /create Hollow campaign/);
    assert.doesNotMatch(member, /make-available|record-transaction|adjust.*LEAF/i);
  });
});

describe("LG5.4 Hollow attention helpers", () => {
  it("classifies on-chain types and attention truthfully", () => {
    assert.equal(isOnChainRewardType("eth"), true);
    assert.equal(isOnChainRewardType("erc20"), true);
    assert.equal(isOnChainRewardType("leaf"), false);
    const empty = emptyStatusCounts();
    assert.equal(campaignRequiresAttention("draft", empty), true);
    assert.equal(campaignRequiresAttention("resolved", empty), true);
    assert.equal(campaignRequiresAttention("completed", empty), false);
    assert.equal(
      campaignRequiresAttention("available", {
        ...empty,
        awaitingSend: 1,
      }),
      true,
    );
    assert.equal(
      campaignRequiresAttention("completed", { ...empty, failed: 2 }),
      true,
    );
  });
});

describe("LG5.4 LG4 audit action names preserved", () => {
  it("campaign-ops keep greenwood.* audit namespaces", () => {
    const ops = read("src/lib/greenwood/hollow/campaign-ops.ts");
    assert.match(ops, /greenwood\.campaign\.create/);
    assert.match(ops, /greenwood\.campaign\.resolve/);
    assert.match(ops, /greenwood\.campaign\.make_available/);
    assert.match(ops, /greenwood\.campaign\.cancel/);
    assert.match(ops, /greenwood\.reward\.record_transaction/);
    assert.match(ops, /greenwood\.reward\.correct_transaction/);
    assert.match(ops, /greenwood\.reward\.mark_confirmed/);
    assert.doesNotMatch(ops, /desk\.campaign|desk\.reward/);
  });
});
