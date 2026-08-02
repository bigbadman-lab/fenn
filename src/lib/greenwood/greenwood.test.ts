import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { normalizeAdmitRpcRow } from "./admission";
import { GreenwoodError } from "./errors";
import type { AdmitToGreenwoodRpcRow } from "./types";

const here = dirname(fileURLToPath(import.meta.url));
const PROFILE_ID = "11111111-1111-4111-8111-111111111111";
const SIGIL_ID = "a0000000-0000-4000-8000-000000000001";

const MOCK_SIGIL_CATALOGUE = {
  slug: "ember-notch",
  ascii_body: "  /\\\n /  \\\n/____\\\n  ||",
  a11y_label: "Ember notch — a small peaked mark",
  width: 6,
  height: 4,
  is_fallback: false,
};

const MOCK_ASSIGN_RPC_ROW = {
  profile_id: PROFILE_ID,
  sigil_id: SIGIL_ID,
  ...MOCK_SIGIL_CATALOGUE,
  newly_assigned: true,
  assigned_at: "2026-08-01T12:00:00.000Z",
};

function profileAdmin(
  data: Record<string, unknown> | null,
  listData: Array<Record<string, unknown>> = [],
  sigilAssignment: {
    greenwood_sigil_catalogue: typeof MOCK_SIGIL_CATALOGUE;
  } | null = {
    greenwood_sigil_catalogue: MOCK_SIGIL_CATALOGUE,
  },
  options: {
    sigilReadError?: {
      code: string;
      message: string;
      details?: string;
      hint?: string;
    };
    onSigilSelect?: (columns: string) => void;
    onAssignRpc?: () => void;
  } = {},
) {
  return {
    from(table: string) {
      if (table === "greenwood_sigil_assignments") {
        return {
          select(columns: string) {
            options.onSigilSelect?.(columns);
            return {
              eq() {
                return {
                  async maybeSingle() {
                    if (options.sigilReadError) {
                      return { data: null, error: options.sigilReadError };
                    }
                    return { data: sigilAssignment, error: null };
                  },
                };
              },
            };
          },
        };
      }
      assert.equal(table, "profiles");
      return {
        select() {
          return {
            then: (
              resolve: (value: { data: unknown; error: unknown }) => void,
              reject: (reason?: unknown) => void,
            ) => {
              try {
                resolve({ data: listData, error: null });
              } catch (err) {
                reject(err);
              }
            },
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
    async rpc(name: string) {
      if (name === "assign_greenwood_sigil") {
        options.onAssignRpc?.();
        return { data: [MOCK_ASSIGN_RPC_ROW], error: null };
      }
      throw new Error(`unexpected rpc ${name}`);
    },
  };
}

const DEFAULT_WALLET = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

function admitAdmin(
  rpcImpl: (
    name: string,
    args: {
      p_profile_id: string;
      p_access_override?: boolean;
      p_assigned_by?: string;
    },
  ) => Promise<{ data: unknown; error: unknown }>,
  walletAddress: string = DEFAULT_WALLET,
  ceremonyCompletedAt: string | null = "2026-07-01T00:00:00.000Z",
) {
  return {
    from(table: string) {
      assert.equal(table, "profiles");
      return {
        select(cols: string) {
          return {
            eq() {
              return {
                async maybeSingle() {
                  if (cols === "wallet_address") {
                    return {
                      data: { wallet_address: walletAddress },
                      error: null,
                    };
                  }
                  if (
                    cols.includes("greenwood_arrival_ceremony_completed_at")
                  ) {
                    return {
                      data: {
                        greenwood_arrival_ceremony_completed_at:
                          ceremonyCompletedAt,
                      },
                      error: null,
                    };
                  }
                  throw new Error(`unexpected select ${cols}`);
                },
              };
            },
          };
        },
      };
    },
    async rpc(
      name: string,
      args: {
        p_profile_id: string;
        p_access_override?: boolean;
        p_assigned_by?: string;
      },
    ) {
      if (name === "assign_greenwood_sigil") {
        return { data: [MOCK_ASSIGN_RPC_ROW], error: null };
      }
      return rpcImpl(name, args);
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
  const ORIGINAL_ACCESS = process.env.GREENWOOD_ACCESS_WALLETS;

  afterEach(() => {
    if (ORIGINAL_ACCESS === undefined) {
      delete process.env.GREENWOOD_ACCESS_WALLETS;
    } else {
      process.env.GREENWOOD_ACCESS_WALLETS = ORIGINAL_ACCESS;
    }
  });

  it("returns member from frozen snapshot without standing lookup", async () => {
    const { getGreenwoodStatus } = await import("./status");
    let standingCalls = 0;
    let sigilSelect = "";
    let assignCalls = 0;
    const status = await getGreenwoodStatus(
      PROFILE_ID,
      profileAdmin(
        {
          greenwood_entered_at: "2026-07-01T00:00:00.000Z",
          greenwood_threshold_at_entry: 30,
          greenwood_lifetime_leaf_at_entry: 34,
          greenwood_arrival_ceremony_completed_at: "2026-07-01T00:00:00.000Z",
          leaf_lifetime_earned: 34,
          outlaw_number: 42,
          wallet_address: DEFAULT_WALLET,
        },
        [
          {
            id: PROFILE_ID,
            outlaw_number: 42,
            leaf_lifetime_earned: 34,
            greenwood_entered_at: "2026-07-01T00:00:00.000Z",
          },
        ],
        { greenwood_sigil_catalogue: MOCK_SIGIL_CATALOGUE },
        {
          onSigilSelect: (columns) => {
            sigilSelect = columns;
          },
          onAssignRpc: () => {
            assignCalls += 1;
          },
        },
      ) as never,
      async () => {
        standingCalls += 1;
        throw new Error("standing must not run for members");
      },
    );
    assert.equal(standingCalls, 0);
    assert.equal(assignCalls, 0);
    assert.match(sigilSelect, /greenwood_sigil_catalogue!sigil_id/);
    assert.doesNotMatch(sigilSelect, /previous_sigil_id/);
    assert.deepEqual(status, {
      state: "member",
      greenwoodEnteredAt: "2026-07-01T00:00:00.000Z",
      thresholdAtEntry: 30,
      lifetimeLeafAtEntry: 34,
      currentLifetimeLeaf: 34,
      standingRank: 1,
      standingTotalMembers: 1,
      arrivalCeremonyPending: false,
      sigil: {
        slug: "ember-notch",
        asciiBody: MOCK_SIGIL_CATALOGUE.ascii_body,
        a11yLabel: MOCK_SIGIL_CATALOGUE.a11y_label,
        width: 6,
        height: 4,
        isFallback: false,
      },
    });
  });

  it("lazily assigns a sigil when membership has no assignment row", async () => {
    const { getGreenwoodStatus } = await import("./status");
    let assignCalls = 0;
    const status = await getGreenwoodStatus(
      PROFILE_ID,
      profileAdmin(
        {
          greenwood_entered_at: "2026-07-01T00:00:00.000Z",
          greenwood_threshold_at_entry: 30,
          greenwood_lifetime_leaf_at_entry: 34,
          greenwood_arrival_ceremony_completed_at: "2026-07-01T00:00:00.000Z",
          leaf_lifetime_earned: 34,
          outlaw_number: 42,
          wallet_address: DEFAULT_WALLET,
        },
        [
          {
            id: PROFILE_ID,
            outlaw_number: 42,
            leaf_lifetime_earned: 34,
            greenwood_entered_at: "2026-07-01T00:00:00.000Z",
          },
        ],
        null,
        {
          onAssignRpc: () => {
            assignCalls += 1;
          },
        },
      ) as never,
    );
    assert.equal(assignCalls, 1);
    assert.equal(status.state, "member");
    if (status.state !== "member") return;
    assert.equal(status.sigil?.slug, "ember-notch");
  });

  it("keeps membership when sigil read fails and retains diagnostics in cause", async () => {
    const { getGreenwoodStatus } = await import("./status");
    const { getProfileSigil } = await import("./sigil/assignment");
    const admin = profileAdmin(
      {
        greenwood_entered_at: "2026-07-01T00:00:00.000Z",
        greenwood_threshold_at_entry: 30,
        greenwood_lifetime_leaf_at_entry: 34,
        greenwood_arrival_ceremony_completed_at: "2026-07-01T00:00:00.000Z",
        leaf_lifetime_earned: 34,
        outlaw_number: 42,
        wallet_address: DEFAULT_WALLET,
      },
      [
        {
          id: PROFILE_ID,
          outlaw_number: 42,
          leaf_lifetime_earned: 34,
          greenwood_entered_at: "2026-07-01T00:00:00.000Z",
        },
      ],
      null,
      {
        sigilReadError: {
          code: "PGRST201",
          message: "Could not embed because more than one relationship was found",
          details: "sigil_id, previous_sigil_id",
          hint: "Try using greenwood_sigil_catalogue!sigil_id",
        },
      },
    );

    await assert.rejects(
      () => getProfileSigil(PROFILE_ID, admin as never),
      (err: unknown) => {
        assert.ok(err instanceof GreenwoodError);
        assert.equal(err.message, "Failed to load Greenwood sigil");
        assert.equal(err.code, "greenwood_sigil_failed");
        const cause = err.cause as {
          operation?: string;
          code?: string;
          hint?: string;
          profileId?: string;
        };
        assert.equal(cause.operation, "getProfileSigil");
        assert.equal(cause.code, "PGRST201");
        assert.equal(cause.profileId, PROFILE_ID);
        assert.match(cause.hint ?? "", /sigil_id/);
        return true;
      },
    );

    const status = await getGreenwoodStatus(PROFILE_ID, admin as never);
    assert.equal(status.state, "member");
    if (status.state !== "member") return;
    assert.equal(status.sigil, null);
  });

  it("returns ineligible with remainingLeaf", async () => {
    delete process.env.GREENWOOD_ACCESS_WALLETS;
    const { getGreenwoodStatus } = await import("./status");
    const status = await getGreenwoodStatus(
      PROFILE_ID,
      profileAdmin({
        greenwood_entered_at: null,
        greenwood_threshold_at_entry: null,
        greenwood_lifetime_leaf_at_entry: null,
        wallet_address: DEFAULT_WALLET,
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
    delete process.env.GREENWOOD_ACCESS_WALLETS;
    const { getGreenwoodStatus } = await import("./status");
    const status = await getGreenwoodStatus(
      PROFILE_ID,
      profileAdmin({
        greenwood_entered_at: null,
        greenwood_threshold_at_entry: null,
        greenwood_lifetime_leaf_at_entry: null,
        wallet_address: DEFAULT_WALLET,
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

  it("allowlisted wallet below threshold becomes eligible with real LEAF", async () => {
    process.env.GREENWOOD_ACCESS_WALLETS =
      "0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
    const { getGreenwoodStatus } = await import("./status");
    const status = await getGreenwoodStatus(
      PROFILE_ID,
      profileAdmin({
        greenwood_entered_at: null,
        greenwood_threshold_at_entry: null,
        greenwood_lifetime_leaf_at_entry: null,
        wallet_address: DEFAULT_WALLET,
      }) as never,
      async () => ({
        lifetimeLeaf: 7,
        greenwoodThreshold: 30,
        meetsGreenwoodThreshold: false,
      }),
    );
    assert.deepEqual(status, {
      state: "eligible",
      lifetimeLeaf: 7,
      threshold: 30,
      remainingLeaf: 0,
      greenwoodEnteredAt: null,
    });
  });

  it("non-allowlisted wallet below threshold remains ineligible", async () => {
    process.env.GREENWOOD_ACCESS_WALLETS =
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const { getGreenwoodStatus } = await import("./status");
    const status = await getGreenwoodStatus(
      PROFILE_ID,
      profileAdmin({
        greenwood_entered_at: null,
        greenwood_threshold_at_entry: null,
        greenwood_lifetime_leaf_at_entry: null,
        wallet_address: DEFAULT_WALLET,
      }) as never,
      async () => ({
        lifetimeLeaf: 7,
        greenwoodThreshold: 30,
        meetsGreenwoodThreshold: false,
      }),
    );
    assert.equal(status.state, "ineligible");
    if (status.state === "ineligible") {
      assert.equal(status.lifetimeLeaf, 7);
      assert.equal(status.remainingLeaf, 23);
    }
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
            wallet_address: DEFAULT_WALLET,
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
            wallet_address: DEFAULT_WALLET,
          }) as never,
        ),
      (err: unknown) =>
        err instanceof GreenwoodError &&
        err.code === "greenwood_profile_corrupt",
    );
  });
});

describe("admitProfileToGreenwood", () => {
  const ORIGINAL_ACCESS = process.env.GREENWOOD_ACCESS_WALLETS;

  afterEach(() => {
    if (ORIGINAL_ACCESS === undefined) {
      delete process.env.GREENWOOD_ACCESS_WALLETS;
    } else {
      process.env.GREENWOOD_ACCESS_WALLETS = ORIGINAL_ACCESS;
    }
  });

  it("normalizes admitted RPC row", async () => {
    delete process.env.GREENWOOD_ACCESS_WALLETS;
    const { admitProfileToGreenwood } = await import("./admission");
    const admin = admitAdmin(async (name, args) => {
      assert.equal(name, "admit_to_greenwood");
      assert.equal(args.p_profile_id, PROFILE_ID);
      assert.equal(args.p_access_override, false);
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
    });
    const result = await admitProfileToGreenwood(PROFILE_ID, admin as never);
    assert.equal(result.status, "admitted");
    if (result.status === "admitted") {
      assert.equal(result.sigil?.slug, "ember-notch");
      assert.equal(result.sigil?.isFallback, false);
      assert.equal(result.arrivalCeremonyPending, true);
    }
  });

  it("passes access override from trusted profile wallet", async () => {
    process.env.GREENWOOD_ACCESS_WALLETS = DEFAULT_WALLET;
    const { admitProfileToGreenwood } = await import("./admission");
    let sawOverride: boolean | undefined;
    const admin = admitAdmin(async (_name, args) => {
      sawOverride = args.p_access_override;
      return {
        data: {
          status: "admitted",
          newly_admitted: true,
          profile_id: PROFILE_ID,
          lifetime_leaf: 3,
          threshold: 30,
          greenwood_entered_at: "2026-07-28T12:00:00.000Z",
          greenwood_threshold_at_entry: 30,
          greenwood_lifetime_leaf_at_entry: 3,
        },
        error: null,
      };
    });
    const result = await admitProfileToGreenwood(PROFILE_ID, admin as never);
    assert.equal(sawOverride, true);
    assert.equal(result.status, "admitted");
    if (result.status === "admitted") {
      assert.equal(result.lifetimeLeafAtEntry, 3);
      assert.equal(result.sigil?.slug, "ember-notch");
      assert.equal(result.arrivalCeremonyPending, true);
    }
  });

  it("treats already_member as success with ceremony state", async () => {
    const { admitProfileToGreenwood } = await import("./admission");
    const admin = admitAdmin(async () => ({
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
    }));
    const result = await admitProfileToGreenwood(PROFILE_ID, admin as never);
    assert.equal(result.status, "already_member");
    if (result.status === "already_member") {
      assert.equal(result.arrivalCeremonyPending, false);
    }
  });

  it("returns not_eligible without throwing", async () => {
    delete process.env.GREENWOOD_ACCESS_WALLETS;
    const { admitProfileToGreenwood } = await import("./admission");
    const admin = admitAdmin(async () => ({
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
    }));
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
    const admin = admitAdmin(async () => ({
      data: null,
      error: { message: "connection reset" },
    }));
    await assert.rejects(
      () => admitProfileToGreenwood(PROFILE_ID, admin as never),
      (err: unknown) =>
        err instanceof GreenwoodError &&
        err.code === "greenwood_admission_failed",
    );
  });

  it("maps missing threshold RPC error to configuration error", async () => {
    const { admitProfileToGreenwood } = await import("./admission");
    const admin = admitAdmin(async () => ({
      data: null,
      error: {
        message:
          "FENN_GREENWOOD_THRESHOLD_MISSING: greenwood.lifetime_leaf_threshold is not configured",
      },
    }));
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

  it("admission service only passes profile id and derived override to RPC", () => {
    const source = readFileSync(join(here, "admission.ts"), "utf8");
    assert.match(source, /admit_to_greenwood/);
    assert.match(source, /p_profile_id:\s*id/);
    assert.match(source, /p_access_override:\s*accessOverride/);
    assert.doesNotMatch(source, /p_threshold/);
    assert.doesNotMatch(source, /p_lifetime/);
    assert.doesNotMatch(source, /awardLeaf|leaf_ledger|leaf_balance/);
  });
});
