import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { formatGatheringCountdown } from "./gatherings/countdown";
import {
  gatheringWindowsOverlap,
  resolveGatheringState,
} from "./gatherings/state";
import type { SafeGathering } from "./gatherings/types";
import { WORLD_PULSE_GREENWOOD_GATHERING_MS } from "@/lib/world-pulse/intervals";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "../../..");

function read(rel: string): string {
  return readFileSync(join(repoRoot, rel), "utf8");
}

describe("resolveGatheringState", () => {
  const window = {
    startsAt: "2026-08-01T12:00:00.000Z",
    endsAt: "2026-08-01T13:00:00.000Z",
  };

  it("keeps drafts draft regardless of time", () => {
    assert.equal(
      resolveGatheringState(
        { status: "draft", ...window },
        Date.parse("2026-08-01T12:30:00.000Z"),
      ),
      "draft",
    );
  });

  it("derives scheduled before start and active inside the window", () => {
    assert.equal(
      resolveGatheringState(
        { status: "scheduled", ...window },
        Date.parse("2026-08-01T11:59:59.000Z"),
      ),
      "scheduled",
    );
    assert.equal(
      resolveGatheringState(
        { status: "scheduled", ...window },
        Date.parse("2026-08-01T12:00:00.000Z"),
      ),
      "active",
    );
    assert.equal(
      resolveGatheringState(
        { status: "active", ...window },
        Date.parse("2026-08-01T12:45:00.000Z"),
      ),
      "active",
    );
  });

  it("closes at ends_at even when status remains scheduled/active", () => {
    assert.equal(
      resolveGatheringState(
        { status: "scheduled", ...window },
        Date.parse("2026-08-01T13:00:00.000Z"),
      ),
      "closed",
    );
    assert.equal(
      resolveGatheringState(
        { status: "active", ...window },
        Date.parse("2026-08-01T13:00:00.000Z"),
      ),
      "closed",
    );
  });

  it("cancelled wins over the time window", () => {
    assert.equal(
      resolveGatheringState(
        {
          status: "cancelled",
          ...window,
          cancelledAt: "2026-08-01T11:00:00.000Z",
        },
        Date.parse("2026-08-01T12:30:00.000Z"),
      ),
      "cancelled",
    );
  });

  it("closed status or closedAt wins", () => {
    assert.equal(
      resolveGatheringState(
        {
          status: "closed",
          ...window,
          closedAt: "2026-08-01T12:10:00.000Z",
        },
        Date.parse("2026-08-01T12:30:00.000Z"),
      ),
      "closed",
    );
  });
});

describe("gatheringWindowsOverlap", () => {
  it("detects overlapping half-open windows", () => {
    assert.equal(
      gatheringWindowsOverlap(
        {
          startsAt: "2026-08-01T12:00:00.000Z",
          endsAt: "2026-08-01T13:00:00.000Z",
        },
        {
          startsAt: "2026-08-01T12:30:00.000Z",
          endsAt: "2026-08-01T14:00:00.000Z",
        },
      ),
      true,
    );
  });

  it("allows adjacent windows that touch at ends_at", () => {
    assert.equal(
      gatheringWindowsOverlap(
        {
          startsAt: "2026-08-01T12:00:00.000Z",
          endsAt: "2026-08-01T13:00:00.000Z",
        },
        {
          startsAt: "2026-08-01T13:00:00.000Z",
          endsAt: "2026-08-01T14:00:00.000Z",
        },
      ),
      false,
    );
  });
});

describe("formatGatheringCountdown", () => {
  it("formats short windows as HH:MM:SS", () => {
    const result = formatGatheringCountdown(
      "2026-08-01T12:00:00.000Z",
      Date.parse("2026-08-01T11:47:13.000Z"),
    );
    assert.equal(result.label, "00:12:47");
    assert.equal(result.reached, false);
  });

  it("formats multi-day windows as days/hours", () => {
    const result = formatGatheringCountdown(
      "2026-08-03T12:00:00.000Z",
      Date.parse("2026-08-01T10:00:00.000Z"),
    );
    assert.match(result.label, /^\d+d \d{2}h$/);
    assert.equal(result.reached, false);
  });

  it("marks reached at or after target", () => {
    const result = formatGatheringCountdown(
      "2026-08-01T12:00:00.000Z",
      Date.parse("2026-08-01T12:00:00.000Z"),
    );
    assert.equal(result.reached, true);
    assert.equal(result.label, "00:00:00");
  });
});

describe("SafeGathering privacy shape", () => {
  it("member DTO excludes wallets, profile ids, and admin fields", () => {
    const sample: SafeGathering = {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      title: "THE GREENWOOD GATHERS",
      slug: "the-greenwood-gathers-abc123",
      summary: "raise a hand",
      location: "fire",
      startsAt: "2026-08-01T12:00:00.000Z",
      endsAt: "2026-08-01T13:00:00.000Z",
      resolvedState: "active",
      interactionType: "raise_hand",
      capacity: 18,
      rewardLeafPreview: 25,
      announcementStyle: "quiet",
      handCount: 3,
      memberHasRaisedHand: true,
      canRaiseHand: false,
      canLowerHand: true,
      linkedDeed: {
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        slug: "a-deed",
        title: "A DEED",
      },
      serverNow: "2026-08-01T12:15:00.000Z",
    };
    const keys = Object.keys(sample).sort();
    assert.deepEqual(keys, [
      "announcementStyle",
      "canLowerHand",
      "canRaiseHand",
      "capacity",
      "endsAt",
      "handCount",
      "id",
      "interactionType",
      "linkedDeed",
      "location",
      "memberHasRaisedHand",
      "resolvedState",
      "rewardLeafPreview",
      "serverNow",
      "slug",
      "startsAt",
      "summary",
      "title",
    ]);
    assert.doesNotMatch(JSON.stringify(sample), /0x[a-fA-F0-9]{40}/);
    assert.doesNotMatch(JSON.stringify(sample), /profileId|wallet|actorId|metadata/i);
  });
});

describe("Living Greenwood 3 migration safety", () => {
  it("creates tables, overlap trigger, hand RPCs, and service_role locks", () => {
    const migration = read(
      "supabase/migrations/20260801130000_36_living_greenwood_3_gatherings.sql",
    );
    assert.match(migration, /CREATE TABLE public\.greenwood_gatherings/);
    assert.match(migration, /CREATE TABLE public\.greenwood_gathering_attendance/);
    assert.match(migration, /CREATE TABLE public\.greenwood_gathering_hands/);
    assert.match(migration, /prevent_overlapping_fire_gatherings/);
    assert.match(migration, /status IN \('draft', 'closed', 'cancelled'\)/);
    assert.match(migration, /raise_greenwood_gathering_hand/);
    assert.match(migration, /lower_greenwood_gathering_hand/);
    assert.match(migration, /FENN_GATHERING_FULL/);
    assert.match(migration, /pg_advisory_xact_lock/);
    assert.match(migration, /ON CONFLICT ON CONSTRAINT greenwood_gathering_attendance_pkey/);
    assert.match(migration, /greenwood_gathering_hands_open_uidx/);
    assert.match(migration, /REVOKE ALL ON public\.greenwood_gatherings/);
    assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.raise_greenwood_gathering_hand/);
    assert.match(migration, /TO service_role/);
    assert.doesNotMatch(migration, /INSERT INTO public\.(hollow|wall_entries|chronicle)/i);
    assert.doesNotMatch(migration, /award_leaf|mint_leaf|distribute_leaf/i);
    assert.doesNotMatch(migration, /supabase\.channel|WebSocket/);
  });

  it("verify script covers overlap, raise/lower, and non-member denial", () => {
    const verify = read("supabase/verify_living_greenwood_3_gatherings.sql");
    assert.match(verify, /FENN_GATHERING_OVERLAP|prevent_overlapping/);
    assert.match(verify, /raise_greenwood_gathering_hand/);
    assert.match(verify, /lower_greenwood_gathering_hand/);
    assert.match(verify, /FENN_GREENWOOD_MEMBERSHIP_REQUIRED/);
    assert.match(verify, /draft/);
  });
});

describe("Living Greenwood 3 API and admin boundaries", () => {
  it("member routes require Greenwood membership and reject identity bodies", () => {
    for (const rel of [
      "src/app/api/greenwood/gatherings/[id]/raise-hand/route.ts",
      "src/app/api/greenwood/gatherings/[id]/lower-hand/route.ts",
    ]) {
      const source = read(rel);
      assert.match(source, /getVerifiedPrivyUser/);
      assert.match(source, /greenwood_entered_at/);
      assert.match(source, /rejectIdentityBody/);
      assert.doesNotMatch(source, /body\.profileId|body\.wallet/);
    }
    const list = read("src/app/api/greenwood/gatherings/route.ts");
    assert.match(list, /getFireGatheringsSnapshot/);
    assert.match(list, /greenwood_membership_required/);
  });

  it("admin routes use requireFennAdmin", () => {
    for (const rel of [
      "src/app/api/admin/greenwood/gatherings/route.ts",
      "src/app/api/admin/greenwood/gatherings/[id]/route.ts",
      "src/app/api/admin/greenwood/gatherings/[id]/publish/route.ts",
      "src/app/api/admin/greenwood/gatherings/[id]/cancel/route.ts",
      "src/app/api/admin/greenwood/gatherings/[id]/close/route.ts",
    ]) {
      const source = read(rel);
      assert.match(source, /requireFennAdmin/);
    }
    const adminOps = read("src/lib/greenwood/gatherings/admin-ops.ts");
    assert.match(adminOps, /writeAdminAuditLog/);
    assert.match(adminOps, /adminCreateGatheringDraft/);
    assert.match(adminOps, /adminPublishGathering/);
    assert.match(adminOps, /adminCancelGathering/);
    assert.match(adminOps, /adminCloseGathering/);
  });

  it("client helpers never send profile ids on hand actions", () => {
    const client = read("src/lib/greenwood/client.ts");
    const raise = client.slice(
      client.indexOf("export async function postRaiseGatheringHand"),
    );
    assert.doesNotMatch(raise.slice(0, 400), /JSON\.stringify/);
    assert.doesNotMatch(raise.slice(0, 400), /profileId|walletAddress/);
  });
});

describe("Living Greenwood 3 Fire UI + pulse", () => {
  it("wires Gathering panel independently from presence", () => {
    const member = read("src/components/greenwood/greenwood-member.tsx");
    const ui = read("src/components/greenwood/greenwood-fire-gathering.tsx");
    const card = read("src/components/greenwood/gathering-fire-card.tsx");
    const banner = read(
      "src/components/greenwood/greenwood-gathering-call-banner.tsx",
    );
    const hook = read("src/hooks/use-greenwood-fire-gatherings.ts");
    assert.match(member, /GreenwoodFireGathering/);
    assert.match(member, /GreenwoodFirePresence/);
    assert.match(member, /GreenwoodGatheringCallBanner/);
    assert.match(member, /useGreenwoodFireGatherings/);
    assert.match(ui, /No Gathering has been called/);
    assert.match(card, /RAISE HAND/);
    assert.match(card, /LOWER HAND/);
    assert.match(card, /remain|Begins in|Begins when you press/);
    assert.match(banner, /fire_calling/);
    assert.match(hook, /WORLD_PULSE_GREENWOOD_GATHERING_MS/);
    assert.match(hook, /usePagePulse/);
    assert.doesNotMatch(hook, /supabase\.channel|WebSocket/);
    assert.doesNotMatch(ui, /awardLeaf|hollow|claim/i);
    assert.doesNotMatch(banner, /handCount|attendance/i);
  });

  it("keeps Gathering pulse in the 20–30s band", () => {
    assert.ok(WORLD_PULSE_GREENWOOD_GATHERING_MS >= 20_000);
    assert.ok(WORLD_PULSE_GREENWOOD_GATHERING_MS <= 30_000);
  });

  it("admin desk exists under /admin/greenwood/gatherings", () => {
    assert.match(
      read("src/app/admin/greenwood/gatherings/page.tsx"),
      /AdminGatheringsBoard/,
    );
    assert.match(
      read("src/components/admin/admin-gatherings-board.tsx"),
      /create draft|publish|cancel|close/i,
    );
  });
});

describe("raise/lower member ops helpers", () => {
  it("raise and lower call service RPCs with server profile id only", async () => {
    const { raiseGatheringHand, lowerGatheringHand } = await import(
      "./gatherings/member-ops"
    );
    const gatheringId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const profileId = "11111111-1111-4111-8111-111111111111";
    let raiseArgs: Record<string, string> | null = null;
    let lowerArgs: Record<string, string> | null = null;

    const row = {
      id: gatheringId,
      title: "THE GREENWOOD GATHERS",
      slug: "gathers",
      summary: "raise",
      location: "fire",
      starts_at: "2026-08-01T11:00:00.000Z",
      ends_at: "2026-08-01T14:00:00.000Z",
      status: "scheduled",
      interaction_type: "raise_hand",
      capacity: null,
      reward_leaf_preview: null,
      linked_deed_id: null,
      created_by_actor_id: "admin",
      cancelled_at: null,
      cancellation_reason: null,
      closed_at: null,
      metadata: {},
      created_at: "2026-08-01T10:00:00.000Z",
      updated_at: "2026-08-01T10:00:00.000Z",
    };

    function adminMock() {
      return {
        rpc: async (name: string, args: Record<string, string>) => {
          if (name === "raise_greenwood_gathering_hand") {
            raiseArgs = args;
            return { data: null, error: null };
          }
          if (name === "lower_greenwood_gathering_hand") {
            lowerArgs = args;
            return { data: null, error: null };
          }
          return { data: null, error: { message: `unexpected ${name}` } };
        },
        from: (table: string) => {
          if (table === "greenwood_gatherings") {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: async () => ({ data: row, error: null }),
                }),
              }),
            };
          }
          if (table === "greenwood_gathering_hands") {
            return {
              select: () => ({
                eq: () => ({
                  is: () => ({
                    maybeSingle: async () => ({ data: { id: "hand" }, error: null }),
                  }),
                  // count path
                }),
              }),
            };
          }
          if (table === "deeds") {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: async () => ({ data: null, error: null }),
                }),
              }),
            };
          }
          throw new Error(`unexpected table ${table}`);
        },
      };
    }

    // countOpenHands uses head count; simplify by stubbing chain more carefully
    const db = {
      rpc: async (name: string, args: Record<string, string>) => {
        if (name === "raise_greenwood_gathering_hand") {
          raiseArgs = args;
          return { data: null, error: null };
        }
        if (name === "lower_greenwood_gathering_hand") {
          lowerArgs = args;
          return { data: null, error: null };
        }
        return { data: null, error: { message: `unexpected ${name}` } };
      },
      from: (table: string) => {
        const chain: Record<string, unknown> = {};
        const self = new Proxy(chain, {
          get(_t, prop: string) {
            if (prop === "maybeSingle") {
              return async () => {
                if (table === "greenwood_gatherings") {
                  return { data: row, error: null };
                }
                if (table === "greenwood_gathering_hands") {
                  return { data: { id: "hand" }, error: null };
                }
                return { data: null, error: null };
              };
            }
            if (prop === "then") return undefined;
            return () => self;
          },
        });
        // count path: select().eq().is() returns { count, error }
        return {
          select: (_cols: string, opts?: { count?: string; head?: boolean }) => {
            if (opts?.head) {
              return {
                eq: () => ({
                  is: async () => ({ count: 1, error: null }),
                }),
              };
            }
            return self;
          },
        };
      },
    };

    void adminMock;
    const raised = await raiseGatheringHand(
      gatheringId,
      profileId,
      db as never,
    );
    assert.deepEqual(raiseArgs, {
      p_gathering_id: gatheringId,
      p_profile_id: profileId,
    });
    assert.equal(raised.memberHasRaisedHand, true);
    assert.equal(raised.handCount, 1);

    // After lower, open hand is gone
    const dbLower = {
      ...db,
      from: (table: string) => {
        const chain: Record<string, unknown> = {};
        const self = new Proxy(chain, {
          get(_t, prop: string) {
            if (prop === "maybeSingle") {
              return async () => {
                if (table === "greenwood_gatherings") {
                  return { data: row, error: null };
                }
                if (table === "greenwood_gathering_hands") {
                  return { data: null, error: null };
                }
                return { data: null, error: null };
              };
            }
            if (prop === "then") return undefined;
            return () => self;
          },
        });
        return {
          select: (_cols: string, opts?: { count?: string; head?: boolean }) => {
            if (opts?.head) {
              return {
                eq: () => ({
                  is: async () => ({ count: 0, error: null }),
                }),
              };
            }
            return self;
          },
        };
      },
    };

    const lowered = await lowerGatheringHand(
      gatheringId,
      profileId,
      dbLower as never,
    );
    assert.deepEqual(lowerArgs, {
      p_gathering_id: gatheringId,
      p_profile_id: profileId,
    });
    assert.equal(lowered.memberHasRaisedHand, false);
  });
});

describe("Living Greenwood 3 regression: LG1/LG2 intact", () => {
  it("does not remove sigil or presence foundations", () => {
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
    const presenceUi = read(
      "src/components/greenwood/greenwood-fire-presence.tsx",
    );
    assert.match(presenceUi, /SIT BY THE FIRE/);
    assert.match(presenceUi, /LEAVE THE FIRE/);
    assert.doesNotMatch(presenceUi, /raise.?hand/i);
  });

  it("Gatherings stay off the public gate surface", () => {
    const gate = read("src/components/greenwood/greenwood-gate.tsx");
    assert.doesNotMatch(gate, /gathering|raise.?hand|handCount/i);
  });
});
