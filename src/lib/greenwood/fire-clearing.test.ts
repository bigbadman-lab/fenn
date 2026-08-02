import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  GREENWOOD_FIRE_A11Y_SEATED,
  GREENWOOD_FIRE_A11Y_WAITING,
  GREENWOOD_FIRE_CLEARING_LISTENING,
  GREENWOOD_FIRE_CLEARING_SEATED_DESKTOP,
  GREENWOOD_FIRE_CLEARING_SEATED_MOBILE,
  GREENWOOD_FIRE_CLEARING_WAITING_DESKTOP,
  GREENWOOD_FIRE_CLEARING_WAITING_LIMIT,
  GREENWOOD_FIRE_CLEARING_WAITING_LIMIT_NARROW,
  GREENWOOD_FIRE_CLEARING_WAITING_MOBILE,
} from "@/components/greenwood/greenwood-fire-frames";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "../../..");

function read(rel: string): string {
  return readFileSync(join(repo, rel), "utf8");
}

describe("AT THE FIRE clearing ASCII", () => {
  it("provides waiting and seated desktop/mobile variants", () => {
    assert.ok(GREENWOOD_FIRE_CLEARING_WAITING_DESKTOP.includes("/___\\"));
    assert.ok(GREENWOOD_FIRE_CLEARING_SEATED_DESKTOP.includes("/___\\"));
    assert.ok(GREENWOOD_FIRE_CLEARING_WAITING_MOBILE.includes("/___\\"));
    assert.ok(GREENWOOD_FIRE_CLEARING_SEATED_MOBILE.includes("/___\\"));
    assert.ok(GREENWOOD_FIRE_CLEARING_WAITING_MOBILE.length > 20);
    assert.ok(GREENWOOD_FIRE_CLEARING_SEATED_MOBILE.length > 20);
    assert.ok(GREENWOOD_FIRE_CLEARING_LISTENING.includes("^"));
    assert.match(GREENWOOD_FIRE_A11Y_WAITING, /quiet campfire/i);
    assert.match(GREENWOOD_FIRE_A11Y_SEATED, /place by the fire/i);
  });

  it("uses deterministic attendance limits", () => {
    assert.equal(GREENWOOD_FIRE_CLEARING_WAITING_LIMIT, 6);
    assert.equal(GREENWOOD_FIRE_CLEARING_WAITING_LIMIT_NARROW, 4);
    assert.ok(
      GREENWOOD_FIRE_CLEARING_WAITING_LIMIT_NARROW <
        GREENWOOD_FIRE_CLEARING_WAITING_LIMIT,
    );
  });
});

describe("AT THE FIRE clearing composition", () => {
  it("renders waiting and seated ASCII modes with elevated self block", () => {
    const ui = read("src/components/greenwood/greenwood-fire-presence.tsx");
    assert.match(ui, /GREENWOOD_FIRE_CLEARING_WAITING_/);
    assert.match(ui, /GREENWOOD_FIRE_CLEARING_SEATED_/);
    assert.match(ui, /mode === "waiting"|mode="waiting"/);
    assert.match(ui, /mode === "seated"|mode="seated"/);
    assert.match(ui, /greenwood-fire-presence__self-sigil/);
    assert.match(ui, /YOU ARE HERE/);
    assert.match(ui, /filter\(\(m\) => !m\.isSelf\)/);
    assert.match(ui, /WAITING BY THE FIRE/);
    assert.match(ui, /MARKS STILL WARM/);
    assert.match(ui, /WAIT BEYOND THE[\s\S]*FIRELIGHT/);
    assert.match(ui, /slice\(0, limit\)/);
  });

  it("keeps anchors, a11y, and sit\/leave handlers", () => {
    const ui = read("src/components/greenwood/greenwood-fire-presence.tsx");
    assert.match(ui, /id="the-fire"/);
    assert.match(ui, /id="gf-at-fire"/);
    assert.match(ui, /aria-labelledby="gf-at-fire"/);
    assert.match(ui, /aria-hidden="true"/);
    assert.match(ui, /visually-hidden/);
    assert.match(ui, /void sit\(\)/);
    assert.match(ui, /void leave\(\)/);
    assert.match(ui, /the Fire did not answer|actionError/);
    assert.match(ui, /the Fire is listening/);
    assert.match(ui, /the marks cannot be read just now/);
    assert.doesNotMatch(ui, /dashboard|card-grid|skeleton|spinner/i);
  });

  it("does not alter presence APIs or heartbeat ownership", () => {
    const frames = read("src/components/greenwood/greenwood-fire-frames.ts");
    const ui = read("src/components/greenwood/greenwood-fire-presence.tsx");
    assert.doesNotMatch(frames, /fetch\(|rpc\(|createAdminClient/);
    assert.doesNotMatch(ui, /GREENWOOD_FIRE_HEARTBEAT_MS|postGreenwoodPresence/);
    assert.match(ui, /useGreenwoodFirePresence/);
    const provider = read("src/components/shell/fire-presence-provider.tsx");
    assert.match(provider, /enabled: seated/);
    const hook = read("src/hooks/use-greenwood-fire-presence.ts");
    assert.match(hook, /enabled: enabled && !seated/);
  });

  it("CSS avoids horizontal scroll and supports forced-colours", () => {
    const css = read("src/app/globals.css");
    assert.match(css, /greenwood-fire-presence__clearing/);
    assert.match(css, /overflow-x: hidden/);
    assert.match(css, /forced-colors: active/);
    assert.match(css, /prefers-reduced-motion: reduce/);
    assert.match(css, /greenwood-fire-presence__ring-list/);
  });
});
