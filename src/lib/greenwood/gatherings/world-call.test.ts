import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  announcementStyleShowsGreenwoodBanner,
  announcementStyleShowsHomepageMap,
  parseGatheringAnnouncementStyle,
} from "@/lib/greenwood/gatherings/announcement-style";
import {
  PUBLIC_HOME_GATHERING_HREF,
  PUBLIC_HOME_GATHERING_MESSAGE,
} from "@/lib/greenwood/gatherings/public-home-signal-types";
import { WORLD_PULSE_HOME_GATHERING_MS } from "@/lib/world-pulse/intervals";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "../../../..");

function read(rel: string): string {
  return readFileSync(join(repo, rel), "utf8");
}

describe("World Call announcement style", () => {
  it("parses world_call and falls back invalid values to quiet", () => {
    assert.equal(parseGatheringAnnouncementStyle("world_call"), "world_call");
    assert.equal(parseGatheringAnnouncementStyle("quiet"), "quiet");
    assert.equal(parseGatheringAnnouncementStyle("fire_calling"), "fire_calling");
    assert.equal(parseGatheringAnnouncementStyle("World Call"), "quiet");
    assert.equal(parseGatheringAnnouncementStyle(null), "quiet");
  });

  it("World Call includes Greenwood banner and homepage map; Quiet does not", () => {
    assert.equal(announcementStyleShowsGreenwoodBanner("quiet"), false);
    assert.equal(announcementStyleShowsGreenwoodBanner("fire_calling"), true);
    assert.equal(announcementStyleShowsGreenwoodBanner("world_call"), true);
    assert.equal(announcementStyleShowsHomepageMap("quiet"), false);
    assert.equal(announcementStyleShowsHomepageMap("fire_calling"), false);
    assert.equal(announcementStyleShowsHomepageMap("world_call"), true);
  });

  it("Desk form exposes WORLD CALL and persists world_call value", () => {
    const form = read("src/components/desk/desk-gathering-call-form.tsx");
    const style = read("src/lib/greenwood/gatherings/announcement-style.ts");
    assert.match(form, /WORLD CALL/);
    assert.match(form, /Promote this Gathering at the Greenwood and on the homepage/);
    assert.match(form, /setAnnouncementStyle\("world_call"\)/);
    assert.match(style, /"world_call"/);
  });

  it("preview includes Fire Calling banner and homepage map for World Call", () => {
    const preview = read("src/components/desk/desk-gathering-preview.tsx");
    assert.match(preview, /announcementStyleShowsGreenwoodBanner/);
    assert.match(preview, /FennMapGatheringCall/);
    assert.match(preview, /world_call/);
    assert.match(preview, /mode="preview"/);
  });
});

describe("Public home Gathering signal contract", () => {
  it("public types expose only safe fields and fixed message", () => {
    const types = read(
      "src/lib/greenwood/gatherings/public-home-signal-types.ts",
    );
    assert.match(types, /PUBLIC_HOME_GATHERING_MESSAGE/);
    assert.equal(PUBLIC_HOME_GATHERING_MESSAGE, "GATHERING CALLED AT THE GREENWOOD");
    assert.equal(PUBLIC_HOME_GATHERING_HREF, "/greenwood?crossing=1");
    assert.match(types, /startsAt/);
    assert.match(types, /endsAt/);
    assert.match(types, /message/);
    assert.match(types, /href/);
    assert.doesNotMatch(
      types,
      /handCount|attendance|rewardLeaf|memberSummary|profileId/i,
    );
  });

  it("server reader selects only active world_call and never titles/summaries", () => {
    const lib = read("src/lib/greenwood/gatherings/public-home-signal.ts");
    assert.match(lib, /announcementStyleShowsHomepageMap/);
    assert.match(lib, /resolved !== "active"/);
    assert.match(lib, /PUBLIC_HOME_GATHERING_MESSAGE/);
    assert.match(lib, /server-only/);
    assert.doesNotMatch(lib, /title:|summary:|hand_count|reward_leaf/i);
  });

  it("public API is unauthenticated, no-store, and not the member Gathering API", () => {
    const route = read("src/app/api/home/gathering-call/route.ts");
    const member = read("src/app/api/greenwood/gatherings/route.ts");
    assert.match(route, /getPublicHomeGatheringCall/);
    assert.match(route, /no-store/);
    assert.doesNotMatch(route, /requireFenn|getVerifiedPrivyUser|DeskAccess/);
    assert.match(member, /getVerifiedPrivyUser|greenwood_membership|getFireGatheringsSnapshot/);
  });

  it("map UI polls softly, links through Greenwood gate, and respects reduced motion", () => {
    const ui = read("src/components/home/fenn-map-gathering-call.tsx");
    const map = read("src/components/home/fenn-world-map.tsx");
    const css = read("src/app/globals.css");
    assert.match(map, /FennMapGatheringCall/);
    assert.match(ui, /\/api\/home\/gathering-call/);
    assert.match(ui, /WORLD_PULSE_HOME_GATHERING_MS/);
    assert.match(ui, /usePagePulse/);
    assert.match(ui, /greenwood\?crossing=1|signal\.href/);
    assert.match(ui, /GATHERING CALLED AT THE GREENWOOD/);
    assert.doesNotMatch(ui, /handCount|attendance|capacity|rewardLeaf/i);
    assert.match(css, /fenn-map-ember-pulse/);
    assert.match(css, /prefers-reduced-motion: reduce/);
    assert.match(css, /\.fenn-map-world-call__ember[\s\S]*animation:\s*none/);
    assert.ok(WORLD_PULSE_HOME_GATHERING_MS >= 25_000);
    assert.ok(WORLD_PULSE_HOME_GATHERING_MS <= 45_000);
  });

  it("does not auto-post Wall, Speaks, Outlaw, or arrival ceremony", () => {
    const lib = read("src/lib/greenwood/gatherings/public-home-signal.ts");
    const begin = read("src/lib/desk/begin-gathering.ts");
    assert.doesNotMatch(lib, /writeFennWallEntry|wall_entries|fire_messages|arrival_ceremony/i);
    assert.doesNotMatch(begin, /writeFennWallEntry|publishSpeaks|world_call.*wall/i);
    assert.doesNotMatch(
      read("src/components/home/fenn-map-gathering-call.tsx"),
      /Notification\(|toast|modal/i,
    );
  });
});

describe("getPublicHomeGatheringCall selection", () => {
  it("returns active world_call only and nearest-ending among multiples", async () => {
    const { getPublicHomeGatheringCall } = await import(
      "./public-home-signal"
    );

    const now = Date.parse("2026-08-04T12:30:00.000Z");
    const rows = [
      {
        id: "1",
        title: "PRIVATE TITLE",
        slug: "a",
        summary: "private summary",
        location: "fire",
        starts_at: "2026-08-04T12:00:00.000Z",
        ends_at: "2026-08-04T13:00:00.000Z",
        status: "scheduled",
        interaction_type: "raise_hand",
        capacity: 10,
        reward_leaf_preview: 25,
        linked_deed_id: null,
        created_by_actor_id: "keeper",
        cancelled_at: null,
        cancellation_reason: null,
        closed_at: null,
        metadata: { announcementStyle: "world_call" },
        created_at: "2026-08-04T11:00:00.000Z",
        updated_at: "2026-08-04T11:00:00.000Z",
      },
      {
        id: "2",
        title: "OTHER",
        slug: "b",
        summary: "x",
        location: "fire",
        starts_at: "2026-08-04T12:00:00.000Z",
        ends_at: "2026-08-04T12:45:00.000Z",
        status: "scheduled",
        interaction_type: "raise_hand",
        capacity: null,
        reward_leaf_preview: null,
        linked_deed_id: null,
        created_by_actor_id: "keeper",
        cancelled_at: null,
        cancellation_reason: null,
        closed_at: null,
        metadata: { announcementStyle: "world_call" },
        created_at: "2026-08-04T11:00:00.000Z",
        updated_at: "2026-08-04T11:00:00.000Z",
      },
      {
        id: "3",
        title: "quiet live",
        slug: "c",
        summary: "no map",
        location: "fire",
        starts_at: "2026-08-04T12:00:00.000Z",
        ends_at: "2026-08-04T14:00:00.000Z",
        status: "scheduled",
        interaction_type: "raise_hand",
        capacity: null,
        reward_leaf_preview: null,
        linked_deed_id: null,
        created_by_actor_id: "keeper",
        cancelled_at: null,
        cancellation_reason: null,
        closed_at: null,
        metadata: { announcementStyle: "quiet" },
        created_at: "2026-08-04T11:00:00.000Z",
        updated_at: "2026-08-04T11:00:00.000Z",
      },
      {
        id: "4",
        title: "cancelled world",
        slug: "d",
        summary: "x",
        location: "fire",
        starts_at: "2026-08-04T12:00:00.000Z",
        ends_at: "2026-08-04T14:00:00.000Z",
        status: "cancelled",
        interaction_type: "raise_hand",
        capacity: null,
        reward_leaf_preview: null,
        linked_deed_id: null,
        created_by_actor_id: "keeper",
        cancelled_at: "2026-08-04T12:10:00.000Z",
        cancellation_reason: "storm",
        closed_at: null,
        metadata: { announcementStyle: "world_call" },
        created_at: "2026-08-04T11:00:00.000Z",
        updated_at: "2026-08-04T11:00:00.000Z",
      },
      {
        id: "5",
        title: "scheduled future world",
        slug: "e",
        summary: "later",
        location: "fire",
        starts_at: "2026-08-04T15:00:00.000Z",
        ends_at: "2026-08-04T16:00:00.000Z",
        status: "scheduled",
        interaction_type: "raise_hand",
        capacity: null,
        reward_leaf_preview: null,
        linked_deed_id: null,
        created_by_actor_id: "keeper",
        cancelled_at: null,
        cancellation_reason: null,
        closed_at: null,
        metadata: { announcementStyle: "world_call" },
        created_at: "2026-08-04T11:00:00.000Z",
        updated_at: "2026-08-04T11:00:00.000Z",
      },
    ];

    const db = {
      from: () => ({
        select: () => ({
          neq: () => ({
            order: async () => ({ data: rows, error: null }),
          }),
        }),
      }),
    };

    const signal = await getPublicHomeGatheringCall(db as never, now);
    assert.equal(signal.active, true);
    if (!signal.active) return;
    assert.equal(signal.message, PUBLIC_HOME_GATHERING_MESSAGE);
    assert.equal(signal.href, PUBLIC_HOME_GATHERING_HREF);
    assert.equal(signal.state, "active");
    // Nearest-ending among the two active world_call rows is id 2 (ends 12:45).
    assert.equal(signal.endsAt, "2026-08-04T12:45:00.000Z");
    assert.doesNotMatch(JSON.stringify(signal), /PRIVATE TITLE|private summary|storm|25/);
    assert.doesNotMatch(JSON.stringify(signal), /hand|attendance|capacity|"title"/i);

    const afterEnd = await getPublicHomeGatheringCall(
      db as never,
      Date.parse("2026-08-04T13:01:00.000Z"),
    );
    assert.equal(afterEnd.active, false);
  });
});
