import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  GREENWOOD_FIRE_ACTIVE_TIMEOUT_MS,
  GREENWOOD_FIRE_HEARTBEAT_MS,
  GREENWOOD_FIRE_PRESENCE_REFRESH_MS,
} from "./presence/constants";
import {
  compareFirePresenceMembers,
  isFirePresenceActive,
} from "./presence/filter";
import { GreenwoodError } from "./errors";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "../../..");
const PROFILE_A = "11111111-1111-4111-8111-111111111111";
const PROFILE_B = "22222222-2222-4222-8222-222222222222";

describe("Fire presence timing constants", () => {
  it("keeps heartbeat, timeout and refresh in the locked MVP bands", () => {
    assert.ok(GREENWOOD_FIRE_HEARTBEAT_MS >= 20_000);
    assert.ok(GREENWOOD_FIRE_HEARTBEAT_MS <= 25_000);
    assert.ok(GREENWOOD_FIRE_ACTIVE_TIMEOUT_MS >= 60_000);
    assert.ok(GREENWOOD_FIRE_ACTIVE_TIMEOUT_MS <= 90_000);
    assert.ok(GREENWOOD_FIRE_PRESENCE_REFRESH_MS >= 20_000);
    assert.ok(GREENWOOD_FIRE_PRESENCE_REFRESH_MS <= 30_000);
    assert.ok(GREENWOOD_FIRE_ACTIVE_TIMEOUT_MS > GREENWOOD_FIRE_HEARTBEAT_MS);
  });
});

describe("isFirePresenceActive", () => {
  it("treats recent heartbeats as active and expired as absent", () => {
    const now = Date.parse("2026-08-01T12:00:00.000Z");
    assert.equal(
      isFirePresenceActive("2026-08-01T11:59:10.000Z", now),
      true,
    );
    assert.equal(
      isFirePresenceActive("2026-08-01T11:58:00.000Z", now),
      false,
    );
  });

  it("expired sitting heartbeats are still absent", () => {
    const now = Date.parse("2026-08-01T12:00:00.000Z");
    assert.equal(
      isFirePresenceActive("2026-08-01T11:58:00.000Z", now),
      false,
    );
  });
});

describe("compareFirePresenceMembers", () => {
  it("orders sitting before standing, then outlaw number", () => {
    const rows = [
      { sitting: false, outlawNumber: 3 },
      { sitting: true, outlawNumber: 9 },
      { sitting: true, outlawNumber: 2 },
      { sitting: false, outlawNumber: 1 },
    ];
    rows.sort(compareFirePresenceMembers);
    assert.deepEqual(
      rows.map((r) => [r.sitting, r.outlawNumber]),
      [
        [true, 2],
        [true, 9],
        [false, 1],
        [false, 3],
      ],
    );
  });
});

describe("presence mutation helpers", () => {
  function rpcAdmin(
    impl: (
      name: string,
      args: { p_profile_id: string },
    ) => Promise<{ data: unknown; error: unknown }>,
  ) {
    return {
      rpc: impl,
    };
  }

  it("heartbeat uses server-resolved profile id only", async () => {
    const { heartbeatFirePresence } = await import("./presence/ops");
    let sawId: string | undefined;
    const admin = rpcAdmin(async (name, args) => {
      assert.equal(name, "heartbeat_greenwood_presence");
      sawId = args.p_profile_id;
      return {
        data: [
          {
            profile_id: PROFILE_A,
            last_seen_at: new Date().toISOString(),
            sitting: false,
            sitting_since: null,
          },
        ],
        error: null,
      };
    });
    const self = await heartbeatFirePresence(PROFILE_A, admin as never);
    assert.equal(sawId, PROFILE_A);
    assert.equal(self.present, true);
    assert.equal(self.sitting, false);
  });

  it("sit and leave are idempotent at the helper layer", async () => {
    const { sitByTheFire, leaveTheFire } = await import("./presence/ops");
    let sitCalls = 0;
    let leaveCalls = 0;
    const admin = rpcAdmin(async (name) => {
      if (name === "sit_greenwood_presence") {
        sitCalls += 1;
        return {
          data: [
            {
              profile_id: PROFILE_A,
              last_seen_at: new Date().toISOString(),
              sitting: true,
              sitting_since: "2026-08-01T12:00:00.000Z",
            },
          ],
          error: null,
        };
      }
      leaveCalls += 1;
      return {
        data: [
          {
            profile_id: PROFILE_A,
            last_seen_at: new Date().toISOString(),
            sitting: false,
            sitting_since: null,
          },
        ],
        error: null,
      };
    });
    const a = await sitByTheFire(PROFILE_A, admin as never);
    const b = await sitByTheFire(PROFILE_A, admin as never);
    assert.equal(sitCalls, 2);
    assert.equal(a.sitting, true);
    assert.equal(b.sitting, true);
    const c = await leaveTheFire(PROFILE_A, admin as never);
    const d = await leaveTheFire(PROFILE_A, admin as never);
    assert.equal(leaveCalls, 2);
    assert.equal(c.sitting, false);
    assert.equal(d.sitting, false);
  });

  it("maps non-member RPC errors to membership required", async () => {
    const { heartbeatFirePresence } = await import("./presence/ops");
    const admin = rpcAdmin(async () => ({
      data: null,
      error: {
        message:
          "FENN_GREENWOOD_MEMBERSHIP_REQUIRED: profile is not a Greenwood member",
      },
    }));
    await assert.rejects(
      () => heartbeatFirePresence(PROFILE_A, admin as never),
      (err: unknown) =>
        err instanceof GreenwoodError &&
        err.code === "greenwood_membership_required",
    );
  });
});

describe("getFirePresenceSnapshot", () => {
  it("filters expired rows, omits non-members, and hides profile ids", async () => {
    const { getFirePresenceSnapshot } = await import("./presence/ops");
    const now = Date.parse("2026-08-01T12:00:00.000Z");
    const admin = {
      from(table: string) {
        if (table === "greenwood_presence") {
          return {
            select() {
              return Promise.resolve({
                data: [
                  {
                    profile_id: PROFILE_A,
                    last_seen_at: "2026-08-01T11:59:30.000Z",
                    sitting: true,
                    profiles: {
                      outlaw_number: 7,
                      alias: "rook",
                      greenwood_entered_at: "2026-07-01T00:00:00.000Z",
                    },
                  },
                  {
                    profile_id: PROFILE_B,
                    last_seen_at: "2026-08-01T11:58:00.000Z",
                    sitting: true,
                    profiles: {
                      outlaw_number: 8,
                      alias: "ash",
                      greenwood_entered_at: "2026-07-01T00:00:00.000Z",
                    },
                  },
                  {
                    profile_id: "33333333-3333-4333-8333-333333333333",
                    last_seen_at: "2026-08-01T11:59:40.000Z",
                    sitting: false,
                    profiles: {
                      outlaw_number: 9,
                      alias: null,
                      greenwood_entered_at: null,
                    },
                  },
                ],
                error: null,
              });
            },
          };
        }
        assert.equal(table, "greenwood_sigil_assignments");
        return {
          select() {
            return {
              in() {
                return Promise.resolve({
                  data: [
                    {
                      profile_id: PROFILE_A,
                      greenwood_sigil_catalogue: {
                        slug: "ember-notch",
                        ascii_body: "||",
                        a11y_label: "Ember notch",
                        width: 2,
                        height: 3,
                        is_fallback: false,
                      },
                    },
                  ],
                  error: null,
                });
              },
            };
          },
        };
      },
    };

    const snap = await getFirePresenceSnapshot(
      PROFILE_A,
      admin as never,
      now,
    );
    assert.equal(snap.activeCount, 1);
    assert.equal(snap.members.length, 1);
    assert.equal(snap.self.present, true);
    assert.equal(snap.self.sitting, true);
    assert.equal(snap.members[0]?.displayName, "rook");
    assert.equal(snap.members[0]?.isSelf, true);
    assert.equal(snap.members[0]?.sitting, true);
    assert.equal(snap.members[0]?.sigil?.slug, "ember-notch");
    const encoded = JSON.stringify(snap);
    assert.doesNotMatch(encoded, /profile_id|wallet|privy|11111111-1111/i);
  });

  it("one profile appears once even with a single presence row", async () => {
    const { getFirePresenceSnapshot } = await import("./presence/ops");
    const now = Date.parse("2026-08-01T12:00:00.000Z");
    const admin = {
      from(table: string) {
        if (table === "greenwood_presence") {
          return {
            select() {
              return Promise.resolve({
                data: [
                  {
                    profile_id: PROFILE_A,
                    last_seen_at: "2026-08-01T11:59:50.000Z",
                    sitting: false,
                    profiles: {
                      outlaw_number: 1,
                      alias: null,
                      greenwood_entered_at: "2026-07-01T00:00:00.000Z",
                    },
                  },
                ],
                error: null,
              });
            },
          };
        }
        return {
          select() {
            return {
              in() {
                return Promise.resolve({ data: [], error: null });
              },
            };
          },
        };
      },
    };
    const snap = await getFirePresenceSnapshot(
      PROFILE_A,
      admin as never,
      now,
    );
    assert.equal(snap.members.length, 1);
    assert.equal(snap.members[0]?.outlawLabel, "OUTLAW 00001");
  });
});

describe("Living Greenwood 2 source safety", () => {
  it("migration locks presence to service_role RPCs", () => {
    const migration = readFileSync(
      join(
        repoRoot,
        "supabase/migrations/20260801110000_34_living_greenwood_2_presence.sql",
      ),
      "utf8",
    );
    assert.match(migration, /CREATE TABLE public\.greenwood_presence/);
    assert.match(migration, /heartbeat_greenwood_presence/);
    assert.match(migration, /sit_greenwood_presence/);
    assert.match(migration, /leave_greenwood_presence/);
    assert.match(migration, /ON CONFLICT ON CONSTRAINT greenwood_presence_pkey/);
    assert.match(migration, /RETURN QUERY/);
    assert.match(migration, /REVOKE ALL ON public\.greenwood_presence/);
    assert.match(migration, /TO service_role/);
    assert.doesNotMatch(migration, /supabase\.channel/);
    assert.doesNotMatch(migration, /\.channel\(/);
  });

  it("presence routes resolve Privy profile and reject body identity", () => {
    for (const rel of [
      "src/app/api/greenwood/presence/heartbeat/route.ts",
      "src/app/api/greenwood/presence/sit/route.ts",
      "src/app/api/greenwood/presence/leave/route.ts",
    ]) {
      const source = readFileSync(join(repoRoot, rel), "utf8");
      assert.match(source, /rejectNonEmptyJsonBody/);
      assert.match(source, /requireGreenwoodMemberPresence/);
      assert.doesNotMatch(source, /body\.profileId|body\.wallet/);
    }
    const getRoute = readFileSync(
      join(repoRoot, "src/app/api/greenwood/presence/route.ts"),
      "utf8",
    );
    assert.match(getRoute, /requireGreenwoodMemberPresence/);
    assert.match(getRoute, /getFirePresenceSnapshot/);
  });

  it("client helpers never send profile ids", () => {
    const client = readFileSync(join(here, "client.ts"), "utf8");
    assert.match(client, /postGreenwoodPresenceHeartbeat/);
    assert.match(client, /postGreenwoodPresenceSit/);
    assert.match(client, /postGreenwoodPresenceLeave/);
    assert.match(client, /fetchGreenwoodPresence/);
    const heartbeat = client.slice(
      client.indexOf("export async function postGreenwoodPresenceHeartbeat"),
    );
    assert.doesNotMatch(heartbeat, /JSON\.stringify/);
    assert.doesNotMatch(heartbeat, /profileId/);
  });

  it("Fire UI wires presence without Realtime or reward claims", () => {
    const member = readFileSync(
      join(repoRoot, "src/components/greenwood/greenwood-member.tsx"),
      "utf8",
    );
    const presenceUi = readFileSync(
      join(repoRoot, "src/components/greenwood/greenwood-fire-presence.tsx"),
      "utf8",
    );
    const hook = readFileSync(
      join(repoRoot, "src/hooks/use-greenwood-fire-presence.ts"),
      "utf8",
    );
    assert.match(member, /GreenwoodFirePresence/);
    assert.match(presenceUi, /AT THE FIRE/);
    assert.match(presenceUi, /SIT BY THE FIRE/);
    assert.match(presenceUi, /LEAVE THE FIRE/);
    assert.match(hook, /usePagePulse/);
    assert.match(hook, /GREENWOOD_FIRE_HEARTBEAT_MS/);
    assert.match(hook, /WORLD_PULSE_GREENWOOD_FIRE_MS/);
    assert.doesNotMatch(hook, /supabase\.channel|WebSocket|beforeunload/);
    assert.doesNotMatch(presenceUi, /awardLeaf|hollow|raise.?hand/i);
  });

  it("World Pulse documents Fire refresh cadence", () => {
    const intervals = readFileSync(
      join(repoRoot, "src/lib/world-pulse/intervals.ts"),
      "utf8",
    );
    assert.match(intervals, /WORLD_PULSE_GREENWOOD_FIRE_MS\s*=\s*25_000/);
  });
});
