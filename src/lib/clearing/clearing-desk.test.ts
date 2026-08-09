import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  CLEARING_MUTE_PRESETS_SECONDS,
  CLEARING_SLOW_MODE_PRESETS,
  isAllowedSlowModeSeconds,
  muteUntilFromPresetSeconds,
} from "@/lib/clearing/desk-types";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "../../..");

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

describe("Clearing 1.0C Desk access and route", () => {
  it("exposes /desk/clearing module; desk surface gated while hidden", () => {
    const page = read("src/app/desk/clearing/page.tsx");
    assert.match(page, /DeskClearingPanel/);
    assert.match(page, /CLEARING_DESK_SURFACE_ENABLED/);
    assert.match(page, /notFound/);
    const layout = read("src/app/desk/layout.tsx");
    assert.match(layout, /DeskGate/);
    const visibility = read("src/lib/clearing/visibility.ts");
    assert.match(visibility, /CLEARING_DESK_SURFACE_ENABLED\s*=\s*false/);
  });

  it("Desk nav omits CLEARING link while desk surface is hidden", () => {
    const gate = read("src/components/desk/desk-gate.tsx");
    assert.match(gate, /CLEARING_DESK_SURFACE_ENABLED/);
    assert.match(gate, /href="\/desk\/clearing"/);
  });

  it("GET /api/desk/clearing requires Desk access", () => {
    const route = read("src/app/api/desk/clearing/route.ts");
    assert.match(route, /requireFennDeskAccess/);
    assert.match(route, /getClearingDeskSnapshot/);
    assert.match(route, /deskJson/);
  });

  it("POST moderation requires Desk and logs actions", () => {
    const route = read("src/app/api/clearing/moderation/route.ts");
    assert.match(route, /requireFennDeskAccess/);
    assert.match(route, /logClearingModeration/);
    assert.match(route, /hide|unhide|mute_traveller|ban_outlaw|set_state/);
    assert.match(route, /THE MESSAGE IS HIDDEN/);
    assert.match(route, /THE CLEARING HAS BEEN CLOSED TO NEW VOICES/);
  });
});

describe("Clearing Desk global state validation", () => {
  it("allows only discrete slow-mode presets", () => {
    for (const n of CLEARING_SLOW_MODE_PRESETS) {
      assert.equal(isAllowedSlowModeSeconds(n), true);
    }
    assert.equal(isAllowedSlowModeSeconds(7), false);
    assert.equal(isAllowedSlowModeSeconds(-1), false);
    assert.equal(isAllowedSlowModeSeconds(3600), false);
    assert.equal(isAllowedSlowModeSeconds("10" as unknown), false);
  });

  it("mute presets cover 10m..7d", () => {
    assert.ok(CLEARING_MUTE_PRESETS_SECONDS.includes(600));
    assert.ok(CLEARING_MUTE_PRESETS_SECONDS.includes(3600));
    assert.ok(CLEARING_MUTE_PRESETS_SECONDS.includes(86400));
    assert.ok(CLEARING_MUTE_PRESETS_SECONDS.includes(604800));
    const until = muteUntilFromPresetSeconds(600, Date.parse("2026-08-05T12:00:00.000Z"));
    assert.equal(until, "2026-08-05T12:10:00.000Z");
  });
});

describe("Clearing Desk DTO and security sources", () => {
  it("desk ops strip secrets from query paths", () => {
    const ops = read("src/lib/clearing/desk-ops.ts");
    assert.doesNotMatch(ops, /fenn_clearing_traveller|wallet_address|network_key|SUPABASE_SERVICE_ROLE/i);
    assert.match(ops, /ClearingDeskMessage|ClearingModerationLogItem/);
    assert.match(ops, /clearing_moderation_log/);
  });

  it("messages DTO includes voice without cookie secrets", () => {
    const types = read("src/lib/clearing/desk-types.ts");
    assert.match(types, /travellerId/);
    assert.match(types, /profileId/);
    assert.doesNotMatch(types, /fenn_clearing_traveller|walletAddress|network_key/i);
  });

  it("moderation log migration is Desk-only service_role", () => {
    const mig = read(
      "supabase/migrations/20260805120000_48_clearing_moderation_log.sql",
    );
    assert.match(mig, /clearing_moderation_log/);
    assert.match(mig, /REVOKE ALL ON public\.clearing_moderation_log FROM anon/);
    assert.match(mig, /GRANT ALL ON public\.clearing_moderation_log TO service_role/);
    assert.match(mig, /actor_profile_id/);
    assert.doesNotMatch(mig, /GRANT SELECT.*anon/i);
  });

  it("does not mutate LEAF, Camp, Greenwood, or Market Watch", () => {
    const route = read("src/app/api/clearing/moderation/route.ts");
    assert.doesNotMatch(route, /leaf|greenwood|camp_messages|market_watch|reward/i);
    const panel = read("src/components/desk/desk-clearing-panel.tsx");
    assert.doesNotMatch(panel, /LEAF award|market watch|AI modera/i);
    assert.match(panel, /CLEARING VOICE ONLY/);
  });
});

describe("Clearing Desk UI panel", () => {
  it("covers hide/restore mute ban slow read-only history", () => {
    const panel = read("src/components/desk/desk-clearing-panel.tsx");
    assert.match(panel, /CLOSE THE CLEARING TO NEW VOICES/);
    assert.match(panel, /REOPEN THE CLEARING/);
    assert.match(panel, /SET SLOW MODE/);
    assert.match(panel, /\[ HIDE \]/);
    assert.match(panel, /\[ RESTORE \]/);
    assert.match(panel, /MUTE/);
    assert.match(panel, /BAN/);
    assert.match(panel, /UNMUTE/);
    assert.match(panel, /UNBAN/);
    assert.match(panel, /MODERATION HISTORY/);
    assert.match(panel, /htmlFor="clearing-filter"/);
    assert.match(panel, /aria-live="polite"/);
    assert.match(panel, /POLL_MS|15000/);
    assert.match(panel, /\/api\/clearing\/moderation/);
    assert.match(panel, /\/api\/desk\/clearing/);
  });

  it("public clearing and camp AI remain separate surfaces", () => {
    const camp = read("src/components/camp/camp-ground.tsx");
    assert.doesNotMatch(camp, /GO TO THE CLEARING/);
    assert.match(camp, /FENN/);
    const publicUi = read("src/components/clearing/clearing-page.tsx");
    assert.match(publicUi, /Nothing spoken here earns LEAF automatically/);
  });
});
