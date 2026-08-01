import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  explorerTxUrl,
  isValidTxHash,
  shortenWallet,
} from "./hollow/explorer";
import {
  availableStatusForType,
  canTransitionCampaign,
  canTransitionHollow,
} from "./hollow/state";
import type { SafeHollowReward } from "./hollow/types";
import { leafIdempotencyKeys } from "@/lib/leaf/validate";
import { WORLD_PULSE_GREENWOOD_HOLLOW_MS } from "@/lib/world-pulse/intervals";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "../../..");

function read(rel: string): string {
  return readFileSync(join(repoRoot, rel), "utf8");
}

describe("Hollow campaign transitions", () => {
  it("allows draft → resolved → available and blocks reverse", () => {
    assert.equal(canTransitionCampaign("draft", "resolved"), true);
    assert.equal(canTransitionCampaign("resolved", "available"), true);
    assert.equal(canTransitionCampaign("available", "draft"), false);
    assert.equal(canTransitionCampaign("draft", "cancelled"), true);
    assert.equal(canTransitionCampaign("completed", "cancelled"), false);
  });

  it("maps make-available statuses by reward type", () => {
    assert.equal(availableStatusForType("leaf"), "available");
    assert.equal(availableStatusForType("informational"), "available");
    assert.equal(availableStatusForType("eth"), "awaiting_send");
    assert.equal(availableStatusForType("erc20"), "awaiting_send");
  });

  it("prevents claimed LEAF from cancelling and requires hash path for sent", () => {
    assert.equal(canTransitionHollow("leaf", "available", "claimed"), true);
    assert.equal(canTransitionHollow("leaf", "claimed", "cancelled"), false);
    assert.equal(canTransitionHollow("eth", "awaiting_send", "sent"), true);
    assert.equal(canTransitionHollow("eth", "draft", "sent"), false);
  });
});

describe("Hollow explorer helpers", () => {
  it("validates tx hashes and builds approved explorer URLs only", () => {
    const hash =
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    assert.equal(isValidTxHash(hash), true);
    assert.equal(isValidTxHash("0xabc"), false);
    assert.equal(
      explorerTxUrl(1, hash),
      `https://etherscan.io/tx/${hash}`,
    );
    assert.equal(explorerTxUrl(999999, hash), null);
    assert.equal(shortenWallet("0x1111111111111111111111111111111111111111"), "0x1111…1111");
  });
});

describe("SafeHollowReward privacy shape", () => {
  it("excludes profile ids, admin metadata, and other wallets", () => {
    const sample: SafeHollowReward = {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      title: "Remembrance",
      reason: "final hands",
      rewardType: "leaf",
      amount: 25,
      assetSymbol: null,
      assetChainId: null,
      status: "available",
      availableAt: "2026-08-01T12:00:00.000Z",
      expiresAt: null,
      claimedAt: null,
      sentAt: null,
      confirmedAt: null,
      canClaim: true,
      canAcknowledge: false,
      walletShort: null,
      transactionHash: null,
      explorerUrl: null,
      campaignTitle: "Campaign",
      gatheringTitle: "Gathering",
      serverNow: "2026-08-01T12:01:00.000Z",
    };
    const json = JSON.stringify(sample);
    assert.doesNotMatch(json, /profileId|actorId|metadata|failureReason/i);
    assert.equal(sample.canClaim, true);
  });
});

describe("LEAF hollow ledger integration", () => {
  it("uses hollow claim idempotency key shape", () => {
    assert.equal(
      leafIdempotencyKeys.hollowRewardClaim("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"),
      "hollow_reward:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb:claim",
    );
  });

  it("migration adds hollow source type and claim RPC", () => {
    const migration = read(
      "supabase/migrations/20260801140000_37_living_greenwood_4_hollow.sql",
    );
    assert.match(migration, /'hollow'/);
    assert.match(migration, /CREATE TABLE public\.greenwood_reward_campaigns/);
    assert.match(
      migration,
      /CREATE TABLE public\.greenwood_reward_campaign_recipients/,
    );
    assert.match(migration, /CREATE TABLE public\.greenwood_hollow_rewards/);
    assert.match(migration, /claim_greenwood_hollow_leaf/);
    assert.match(migration, /hollow_reward:/);
    assert.match(migration, /'hollow'/);
    assert.match(migration, /REVOKE ALL ON public\.greenwood_hollow_rewards/);
    assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.claim_greenwood_hollow_leaf/);
    assert.doesNotMatch(migration, /private[_ ]?key|signTransaction|web3\.eth\.send/i);
    assert.match(migration, /status NOT IN \('sent', 'confirmed'\)/);
  });

  it("verify script covers claim, snapshot, and non-owner denial", () => {
    const verify = read("supabase/verify_living_greenwood_4_hollow.sql");
    assert.match(verify, /claim_greenwood_hollow_leaf/);
    assert.match(verify, /gathering_open_hand|open hand/i);
    assert.match(verify, /FENN_HOLLOW_FORBIDDEN|FENN_GREENWOOD_MEMBERSHIP_REQUIRED/);
    assert.match(verify, /source_type.*hollow|hollow/);
  });
});

describe("Hollow API and admin boundaries", () => {
  it("member claim route rejects identity bodies and requires membership", () => {
    const claim = read("src/app/api/greenwood/hollow/[id]/claim/route.ts");
    assert.match(claim, /rejectIdentityBody/);
    assert.match(claim, /getVerifiedPrivyUser/);
    assert.match(claim, /greenwood_entered_at/);
    assert.match(claim, /claimHollowLeaf/);
    assert.doesNotMatch(claim, /body\.profileId|body\.amount|body\.wallet/);
  });

  it("admin reward routes use requireFennAdmin and audit actions", () => {
    for (const rel of [
      "src/app/api/admin/greenwood/rewards/route.ts",
      "src/app/api/admin/greenwood/rewards/[id]/resolve/route.ts",
      "src/app/api/admin/greenwood/rewards/[id]/make-available/route.ts",
      "src/app/api/admin/greenwood/rewards/[id]/cancel/route.ts",
      "src/app/api/admin/greenwood/hollow/[rewardId]/record-transaction/route.ts",
    ]) {
      assert.match(read(rel), /requireFennAdmin/);
    }
    const ops = read("src/lib/greenwood/hollow/campaign-ops.ts");
    assert.match(ops, /greenwood\.campaign\.create/);
    assert.match(ops, /greenwood\.campaign\.resolve/);
    assert.match(ops, /greenwood\.campaign\.make_available/);
    assert.match(ops, /greenwood\.campaign\.cancel/);
    assert.match(ops, /greenwood\.reward\.record_transaction/);
    assert.match(ops, /lowered_at/);
    assert.match(ops, /greenwood_hollow_snapshot_invalid/);
  });

  it("client claim never sends profile id or amount", () => {
    const client = read("src/lib/greenwood/client.ts");
    const claim = client.slice(
      client.indexOf("export async function postClaimHollowReward"),
    );
    assert.doesNotMatch(claim.slice(0, 500), /JSON\.stringify/);
    assert.doesNotMatch(claim.slice(0, 500), /profileId|amount|wallet/);
  });
});

describe("Hollow UI + Fire integration", () => {
  it("wires Hollow door and dedicated route without Realtime or signing", () => {
    const member = read("src/components/greenwood/greenwood-member.tsx");
    const fire = read("src/components/greenwood/greenwood-fire-hollow.tsx");
    const page = read("src/components/greenwood/greenwood-hollow.tsx");
    assert.match(member, /GreenwoodFireHollow/);
    assert.match(fire, /CHECK THE HOLLOW/);
    assert.match(fire, /WORLD_PULSE_GREENWOOD_HOLLOW_MS/);
    assert.match(page, /Nothing has been left here/);
    assert.match(page, /RECEIVE LEAF/);
    assert.match(page, /has not yet crossed the\s+chain/);
    assert.doesNotMatch(page, /privateKey|signTransaction|WalletClient/i);
    assert.doesNotMatch(fire, /supabase\.channel|WebSocket/);
  });

  it("keeps Hollow pulse restrained", () => {
    assert.ok(WORLD_PULSE_GREENWOOD_HOLLOW_MS >= 45_000);
    assert.ok(WORLD_PULSE_GREENWOOD_HOLLOW_MS <= 90_000);
  });

  it("public gate has no Hollow details", () => {
    assert.doesNotMatch(
      read("src/components/greenwood/greenwood-gate.tsx"),
      /hollow|RECEIVE LEAF|reward campaign/i,
    );
  });
});

describe("Living Greenwood 4 regression", () => {
  it("does not auto-create campaigns at Gathering close", () => {
    const close = read(
      "src/app/api/admin/greenwood/gatherings/[id]/close/route.ts",
    );
    assert.doesNotMatch(close, /adminCreateCampaign|hollow|reward_campaign/);
    const adminClose = read("src/lib/greenwood/gatherings/admin-ops.ts");
    const closeFn = adminClose.slice(
      adminClose.indexOf("export async function adminCloseGathering"),
    );
    assert.doesNotMatch(
      closeFn.slice(0, 1200),
      /reward_campaign|hollow_reward/,
    );
  });

  it("keeps LG1–LG3 foundations", () => {
    assert.match(
      read(
        "supabase/migrations/20260801100000_33_living_greenwood_1_sigils.sql",
      ),
      /assign_greenwood_sigil/,
    );
    assert.match(
      read(
        "supabase/migrations/20260801110000_34_living_greenwood_2_presence.sql",
      ),
      /heartbeat_greenwood_presence/,
    );
    assert.match(
      read(
        "supabase/migrations/20260801130000_36_living_greenwood_3_gatherings.sql",
      ),
      /raise_greenwood_gathering_hand/,
    );
  });
});
