import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CAMP_REWARD_DEFAULTS,
  CAMP_REWARD_SETTING_KEYS,
  campRewardUtcDate,
  isCampRewardCooldownActive,
  resolveCampRewardEligibility,
} from "./reward-policy";
import { leafIdempotencyKeys } from "@/lib/leaf/validate";
import { toSafeCampMessage, toSafeCampReward, type CampMessageRow } from "./dto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

describe("Camp reward policy", () => {
  it("recommendation 0 → grant 0", () => {
    const out = resolveCampRewardEligibility({
      recommended: 0,
      characterGranted: 0,
      characterCap: 5,
      globalGranted: 0,
      globalCap: 10,
      cooldownActive: false,
    });
    assert.equal(out.actualGrant, 0);
    assert.equal(out.reason, "not_recommended");
  });

  it("rec 1/2/3 map to max grant equal to recommendation", () => {
    for (const rec of [1, 2, 3] as const) {
      const out = resolveCampRewardEligibility({
        recommended: rec,
        characterGranted: 0,
        characterCap: 5,
        globalGranted: 0,
        globalCap: 10,
        cooldownActive: false,
      });
      assert.equal(out.actualGrant, rec);
      assert.equal(out.reason, "eligible");
    }
  });

  it("never grants above recommendation", () => {
    const out = resolveCampRewardEligibility({
      recommended: 1,
      characterGranted: 0,
      characterCap: 5,
      globalGranted: 0,
      globalCap: 10,
      cooldownActive: false,
    });
    assert.ok(out.actualGrant <= out.recommended);
  });

  it("character cap: full / partial / at cap", () => {
    assert.equal(
      resolveCampRewardEligibility({
        recommended: 2,
        characterGranted: 0,
        characterCap: 5,
        globalGranted: 0,
        globalCap: 10,
        cooldownActive: false,
      }).actualGrant,
      2,
    );
    const partial = resolveCampRewardEligibility({
      recommended: 3,
      characterGranted: 4,
      characterCap: 5,
      globalGranted: 0,
      globalCap: 10,
      cooldownActive: false,
    });
    assert.equal(partial.actualGrant, 1);
    assert.equal(partial.reason, "cap_partial");
    const atCap = resolveCampRewardEligibility({
      recommended: 2,
      characterGranted: 5,
      characterCap: 5,
      globalGranted: 0,
      globalCap: 10,
      cooldownActive: false,
    });
    assert.equal(atCap.actualGrant, 0);
    assert.equal(atCap.reason, "character_cap");
  });

  it("global cap: full / partial / at cap / shared across characters", () => {
    assert.equal(
      resolveCampRewardEligibility({
        recommended: 2,
        characterGranted: 0,
        characterCap: 5,
        globalGranted: 0,
        globalCap: 10,
        cooldownActive: false,
      }).actualGrant,
      2,
    );
    const partial = resolveCampRewardEligibility({
      recommended: 3,
      characterGranted: 0,
      characterCap: 5,
      globalGranted: 9,
      globalCap: 10,
      cooldownActive: false,
    });
    assert.equal(partial.actualGrant, 1);
    assert.equal(partial.reason, "cap_partial");
    const atCap = resolveCampRewardEligibility({
      recommended: 2,
      characterGranted: 0,
      characterCap: 5,
      globalGranted: 10,
      globalCap: 10,
      cooldownActive: false,
    });
    assert.equal(atCap.actualGrant, 0);
    assert.equal(atCap.reason, "global_cap");

    // Shared pool: character A used 4 global, character B sees remaining 6.
    const otherCharacter = resolveCampRewardEligibility({
      recommended: 3,
      characterGranted: 0,
      characterCap: 5,
      globalGranted: 4,
      globalCap: 10,
      cooldownActive: false,
    });
    assert.equal(otherCharacter.actualGrant, 3);
  });

  it("character remaining and global remaining both bind", () => {
    const out = resolveCampRewardEligibility({
      recommended: 3,
      characterGranted: 3,
      characterCap: 5,
      globalGranted: 9,
      globalCap: 10,
      cooldownActive: false,
    });
    assert.equal(out.actualGrant, 1);
    assert.equal(out.reason, "cap_partial");
  });

  it("cooldown forces 0 without rejecting eligibility input", () => {
    const out = resolveCampRewardEligibility({
      recommended: 2,
      characterGranted: 0,
      characterCap: 5,
      globalGranted: 0,
      globalCap: 10,
      cooldownActive: true,
    });
    assert.equal(out.actualGrant, 0);
    assert.equal(out.reason, "cooldown");
  });

  it("cooldown helper respects 60s default", () => {
    const now = new Date("2026-07-23T12:00:00.000Z");
    assert.equal(
      isCampRewardCooldownActive({
        lastRewardedAt: "2026-07-23T11:59:30.000Z",
        now,
      }),
      true,
    );
    assert.equal(
      isCampRewardCooldownActive({
        lastRewardedAt: "2026-07-23T11:58:00.000Z",
        now,
      }),
      false,
    );
  });

  it("UTC reward date is calendar day", () => {
    assert.equal(
      campRewardUtcDate(new Date("2026-07-23T23:30:00.000Z")),
      "2026-07-23",
    );
    assert.equal(
      campRewardUtcDate(new Date("2026-07-24T00:00:00.000Z")),
      "2026-07-24",
    );
  });

  it("canonical config keys and defaults", () => {
    assert.equal(
      CAMP_REWARD_SETTING_KEYS.globalDailyLeafCap,
      "camp.global_daily_leaf_cap",
    );
    assert.equal(
      CAMP_REWARD_SETTING_KEYS.rewardCooldownSeconds,
      "camp.reward_cooldown_seconds",
    );
    assert.equal(CAMP_REWARD_DEFAULTS.characterDailyLeafCap, 5);
    assert.equal(CAMP_REWARD_DEFAULTS.globalDailyLeafCap, 10);
    assert.equal(CAMP_REWARD_DEFAULTS.rewardCooldownSeconds, 60);
  });

  it("idempotency key uses assistant message id", () => {
    assert.equal(
      leafIdempotencyKeys.campMessageReward("msg-1"),
      "camp_message:msg-1:reward",
    );
  });
});

describe("Camp reward DTO / UI safety", () => {
  const baseRow: CampMessageRow = {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    session_id: "s",
    profile_id: "p",
    character_id: "c",
    role: "assistant",
    content: "worth carrying.",
    reward_recommendation: 2,
    reward_granted: 2,
    quality: 3,
    originality: 2,
    relevance: 3,
    spam_probability: 0.01,
    memory_candidate_flag: true,
    leaf_ledger_id: "ledger",
    client_message_hash: "h",
    moderation_flags: {
      rewardPolicy: { recommended: 2, actual: 2, reason: "eligible" },
    },
    created_at: "2026-07-23T12:00:00.000Z",
  };

  it("exposes only actual positive grant on SafeCampMessage", () => {
    const safe = toSafeCampMessage(baseRow);
    assert.equal(safe?.rewardGranted, 2);
    assert.equal("reward_recommendation" in (safe as object), false);
    assert.equal("quality" in (safe as object), false);
    assert.equal("moderation_flags" in (safe as object), false);
  });

  it("omits rewardGranted when grant is 0", () => {
    const safe = toSafeCampMessage({ ...baseRow, reward_granted: 0 });
    assert.equal(safe?.rewardGranted, undefined);
    assert.deepEqual(toSafeCampReward(0), { granted: 0 });
  });
});

describe("Camp reward source safety", () => {
  it("send-message applies reward via injectable path and never mutates profile caches", () => {
    const source = readFileSync(join(here, "send-message.ts"), "utf8");
    assert.match(source, /applyReward/);
    assert.match(source, /applyCampMessageReward/);
    assert.doesNotMatch(source, /awardLeaf\s*\(/);
    assert.doesNotMatch(source, /profiles\.leaf_balance/);
    assert.doesNotMatch(source, /leaf_lifetime_earned/);
    assert.doesNotMatch(source, /\.from\(\s*["']memory_candidates["']\s*\)/);
  });

  it("reward service calls grant_camp_message_reward RPC only", () => {
    const source = readFileSync(join(here, "reward.ts"), "utf8");
    assert.match(source, /grant_camp_message_reward/);
    assert.doesNotMatch(source, /awardLeaf\s*\(/);
    assert.doesNotMatch(source, /profiles\.leaf_balance/);
    assert.match(source, /leafIdempotencyKeys\.campMessageReward/);
  });

  it("migration seeds caps and revokes public execute", () => {
    const sql = readFileSync(
      join(
        here,
        "../../../supabase/migrations/20260723140000_15_stage7_camp_reward_rpc.sql",
      ),
      "utf8",
    );
    assert.match(sql, /daily_leaf_cap = 5/);
    assert.match(sql, /camp\.global_daily_leaf_cap/);
    assert.match(sql, /camp\.reward_cooldown_seconds/);
    assert.match(sql, /grant_camp_message_reward/);
    assert.match(sql, /camp_message:' \|\| v_msg\.id::text \|\| ':reward'/);
    assert.match(sql, /source_type,\s*\n\s*source_id/i);
    assert.match(sql, /'camp'/);
    assert.match(sql, /REVOKE ALL ON FUNCTION public\.grant_camp_message_reward/);
    assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.grant_camp_message_reward/);
    assert.match(sql, /service_role/);
    assert.doesNotMatch(sql, /leaf_balance\s*=/);
    assert.doesNotMatch(sql, /memory_candidates/);
  });
});
