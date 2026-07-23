import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { normalizeAdmitRpcRow } from "./admission";
import { GreenwoodError } from "./errors";
import type { AdmitToGreenwoodRpcRow } from "./types";

const here = dirname(fileURLToPath(import.meta.url));
const PROFILE_ID = "11111111-1111-4111-8111-111111111111";

function profileAdmin(data: Record<string, unknown> | null) {
  return {
    from(table: string) {
      assert.equal(table, "profiles");
      return {
        select() {
          return {
            eq() {
              return {
                async maybeSingle() {
                  return { data, error: null };
                },
              };
            },
          };
        },
      };
    },
  };
}

describe("normalizeAdmitRpcRow", () => {
  it("normalizes admitted", () => {
    const out = normalizeAdmitRpcRow({
      status: "admitted",
      newly_admitted: true,
      profile_id: "p1",
      lifetime_leaf: 34,
      threshold: 30,
      greenwood_entered_at: "2026-07-23T12:00:00.000Z",
      greenwood_threshold_at_entry: 30,
      greenwood_lifetime_leaf_at_entry: 34,
    });
    assert.deepEqual(out, {
      status: "admitted",
      greenwoodEnteredAt: "2026-07-23T12:00:00.000Z",
      thresholdAtEntry: 30,
      lifetimeLeafAtEntry: 34,
    });
  });

  it("treats already_member as success with frozen snapshot", () => {
    const out = normalizeAdmitRpcRow({
      status: "already_member",
      newly_admitted: false,
      profile_id: "p1",
      lifetime_leaf: 30,
      threshold: 30,
      greenwood_entered_at: "2026-07-01T00:00:00.000Z",
      greenwood_threshold_at_entry: 30,
      greenwood_lifetime_leaf_at_entry: 30,
    });
    assert.equal(out.status, "already_member");
    if (out.status === "already_member") {
      assert.equal(out.thresholdAtEntry, 30);
      assert.equal(out.lifetimeLeafAtEntry, 30);
    }
  });

  it("normalizes not_eligible with remainingLeaf", () => {
    const out = normalizeAdmitRpcRow({
      status: "not_eligible",
      newly_admitted: false,
      profile_id: "p1",
      lifetime_leaf: 18,
      threshold: 30,
      greenwood_entered_at: null,
      greenwood_threshold_at_entry: null,
      greenwood_lifetime_leaf_at_entry: null,
    });
    assert.deepEqual(out, {
      status: "not_eligible",
      lifetimeLeaf: 18,
      threshold: 30,
      remainingLeaf: 12,
    });
  });

  it("rejects unknown status", () => {
    assert.throws(
      () =>
        normalizeAdmitRpcRow({
          status: "weird",
          newly_admitted: false,
          profile_id: "p1",
          lifetime_leaf: 0,
          threshold: 30,
          greenwood_entered_at: null,
          greenwood_threshold_at_entry: null,
          greenwood_lifetime_leaf_at_entry: null,
        } as AdmitToGreenwoodRpcRow),
      (err: unknown) =>
        err instanceof GreenwoodError &&
        err.code === "greenwood_admission_failed",
    );
  });
});

describe("getGreenwoodStatus", () => {
  it("returns member from frozen snapshot without standing lookup", async () => {
    const { getGreenwoodStatus } = await import("./status");
    let standingCalls = 0;
    const status = await getGreenwoodStatus(
      PROFILE_ID,
      profileAdmin({
        greenwood_entered_at: "2026-07-01T00:00:00.000Z",
        greenwood_threshold_at_entry: 30,
        greenwood_lifetime_leaf_at_entry: 34,
      }) as never,
      async () => {
        standingCalls += 1;
        throw new Error("standing must not run for members");
      },
    );
    assert.equal(standingCalls, 0);
    assert.deepEqual(status, {
      state: "member",
      greenwoodEnteredAt: "2026-07-01T00:00:00.000Z",
      thresholdAtEntry: 30,
      lifetimeLeafAtEntry: 34,
    });
  });

  it("returns ineligible with remainingLeaf", async () => {
    const { getGreenwoodStatus } = await import("./status");
    const status = await getGreenwoodStatus(
      PROFILE_ID,
      profileAdmin({
        greenwood_entered_at: null,
        greenwood_threshold_at_entry: null,
        greenwood_lifetime_leaf_at_entry: null,
      }) as never,
      async () => ({
        lifetimeLeaf: 18,
        greenwoodThreshold: 30,
        meetsGreenwoodThreshold: false,
      }),
    );
    assert.deepEqual(status, {
      state: "ineligible",
      lifetimeLeaf: 18,
      threshold: 30,
      remainingLeaf: 12,
      greenwoodEnteredAt: null,
    });
  });

  it("returns eligible when lifetime meets threshold", async () => {
    const { getGreenwoodStatus } = await import("./status");
    const status = await getGreenwoodStatus(
      PROFILE_ID,
      profileAdmin({
        greenwood_entered_at: null,
        greenwood_threshold_at_entry: null,
        greenwood_lifetime_leaf_at_entry: null,
      }) as never,
      async () => ({
        lifetimeLeaf: 30,
        greenwoodThreshold: 30,
        meetsGreenwoodThreshold: true,
      }),
    );
    assert.deepEqual(status, {
      state: "eligible",
      lifetimeLeaf: 30,
      threshold: 30,
      remainingLeaf: 0,
      greenwoodEnteredAt: null,
    });
  });

  it("fails closed when threshold is missing", async () => {
    const { getGreenwoodStatus } = await import("./status");
    await assert.rejects(
      () =>
        getGreenwoodStatus(
          PROFILE_ID,
          profileAdmin({
            greenwood_entered_at: null,
            greenwood_threshold_at_entry: null,
            greenwood_lifetime_leaf_at_entry: null,
          }) as never,
          async () => ({
            lifetimeLeaf: 40,
            greenwoodThreshold: null,
            meetsGreenwoodThreshold: null,
          }),
        ),
      (err: unknown) =>
        err instanceof GreenwoodError &&
        err.code === "greenwood_configuration_error",
    );
  });

  it("fails closed on incomplete admission snapshot", async () => {
    const { getGreenwoodStatus } = await import("./status");
    await assert.rejects(
      () =>
        getGreenwoodStatus(
          PROFILE_ID,
          profileAdmin({
            greenwood_entered_at: "2026-07-01T00:00:00.000Z",
            greenwood_threshold_at_entry: null,
            greenwood_lifetime_leaf_at_entry: 34,
          }) as never,
        ),
      (err: unknown) =>
        err instanceof GreenwoodError &&
        err.code === "greenwood_profile_corrupt",
    );
  });
});

describe("admitProfileToGreenwood", () => {
  it("normalizes admitted RPC row", async () => {
    const { admitProfileToGreenwood } = await import("./admission");
    const admin = {
      async rpc(name: string, args: { p_profile_id: string }) {
        assert.equal(name, "admit_to_greenwood");
        assert.equal(args.p_profile_id, PROFILE_ID);
        return {
          data: [
            {
              status: "admitted",
              newly_admitted: true,
              profile_id: PROFILE_ID,
              lifetime_leaf: 31,
              threshold: 30,
              greenwood_entered_at: "2026-07-23T12:00:00.000Z",
              greenwood_threshold_at_entry: 30,
              greenwood_lifetime_leaf_at_entry: 31,
            },
          ],
          error: null,
        };
      },
    };
    const result = await admitProfileToGreenwood(PROFILE_ID, admin as never);
    assert.equal(result.status, "admitted");
  });

  it("treats already_member as success", async () => {
    const { admitProfileToGreenwood } = await import("./admission");
    const admin = {
      async rpc() {
        return {
          data: {
            status: "already_member",
            newly_admitted: false,
            profile_id: PROFILE_ID,
            lifetime_leaf: 30,
            threshold: 30,
            greenwood_entered_at: "2026-07-01T00:00:00.000Z",
            greenwood_threshold_at_entry: 30,
            greenwood_lifetime_leaf_at_entry: 30,
          },
          error: null,
        };
      },
    };
    const result = await admitProfileToGreenwood(PROFILE_ID, admin as never);
    assert.equal(result.status, "already_member");
  });

  it("returns not_eligible without throwing", async () => {
    const { admitProfileToGreenwood } = await import("./admission");
    const admin = {
      async rpc() {
        return {
          data: {
            status: "not_eligible",
            newly_admitted: false,
            profile_id: PROFILE_ID,
            lifetime_leaf: 10,
            threshold: 30,
            greenwood_entered_at: null,
            greenwood_threshold_at_entry: null,
            greenwood_lifetime_leaf_at_entry: null,
          },
          error: null,
        };
      },
    };
    const result = await admitProfileToGreenwood(PROFILE_ID, admin as never);
    assert.deepEqual(result, {
      status: "not_eligible",
      lifetimeLeaf: 10,
      threshold: 30,
      remainingLeaf: 20,
    });
  });

  it("maps unexpected RPC failure to controlled error", async () => {
    const { admitProfileToGreenwood } = await import("./admission");
    const admin = {
      async rpc() {
        return {
          data: null,
          error: { message: "connection reset" },
        };
      },
    };
    await assert.rejects(
      () => admitProfileToGreenwood(PROFILE_ID, admin as never),
      (err: unknown) =>
        err instanceof GreenwoodError &&
        err.code === "greenwood_admission_failed",
    );
  });

  it("maps missing threshold RPC error to configuration error", async () => {
    const { admitProfileToGreenwood } = await import("./admission");
    const admin = {
      async rpc() {
        return {
          data: null,
          error: {
            message:
              "FENN_GREENWOOD_THRESHOLD_MISSING: greenwood.lifetime_leaf_threshold is not configured",
          },
        };
      },
    };
    await assert.rejects(
      () => admitProfileToGreenwood(PROFILE_ID, admin as never),
      (err: unknown) =>
        err instanceof GreenwoodError &&
        err.code === "greenwood_configuration_error",
    );
  });
});

describe("greenwood API source safety", () => {
  it("enter route resolves profile from Privy and rejects body profileId", () => {
    const enter = readFileSync(
      join(here, "../../app/api/greenwood/enter/route.ts"),
      "utf8",
    );
    const status = readFileSync(
      join(here, "../../app/api/greenwood/status/route.ts"),
      "utf8",
    );
    assert.match(enter, /getVerifiedPrivyUser/);
    assert.match(enter, /findProfileByPrivyUserId/);
    assert.match(enter, /admitProfileToGreenwood\(profile\.id/);
    assert.match(enter, /Request body must be empty/);
    assert.doesNotMatch(enter, /body\.profileId/);
    assert.match(status, /getVerifiedPrivyUser/);
    assert.match(status, /getGreenwoodStatus\(profile\.id/);
  });

  it("admission service only passes profile id to RPC", () => {
    const source = readFileSync(join(here, "admission.ts"), "utf8");
    assert.match(source, /admit_to_greenwood/);
    assert.match(source, /p_profile_id:\s*id/);
    assert.doesNotMatch(source, /p_threshold/);
    assert.doesNotMatch(source, /p_lifetime/);
  });
});
