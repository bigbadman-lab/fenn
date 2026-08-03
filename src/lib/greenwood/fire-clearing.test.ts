import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  GREENWOOD_FIRE_A11Y_SEATED,
  GREENWOOD_FIRE_A11Y_WAITING,
  GREENWOOD_FIRE_CLEARING_LISTENING_TEXT,
  GREENWOOD_FIRE_CLEARING_SEATED_DESKTOP_TEXT,
  GREENWOOD_FIRE_CLEARING_SEATED_MOBILE_TEXT,
  GREENWOOD_FIRE_CLEARING_WAITING_DESKTOP_TEXT,
  GREENWOOD_FIRE_CLEARING_WAITING_LIMIT,
  GREENWOOD_FIRE_CLEARING_WAITING_LIMIT_NARROW,
  GREENWOOD_FIRE_CLEARING_WAITING_MOBILE_TEXT,
  GREENWOOD_FIRE_TITLE_MARK,
  formatFireWaitingOverflow,
} from "@/components/greenwood/greenwood-fire-frames";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "../../..");

function read(rel: string): string {
  return readFileSync(join(repo, rel), "utf8");
}

describe("AT THE FIRE clearing ASCII", () => {
  it("provides waiting and seated desktop/mobile variants", () => {
    assert.ok(GREENWOOD_FIRE_CLEARING_WAITING_DESKTOP_TEXT.includes("/_\\"));
    assert.ok(GREENWOOD_FIRE_CLEARING_SEATED_DESKTOP_TEXT.includes("/_\\"));
    assert.ok(GREENWOOD_FIRE_CLEARING_WAITING_MOBILE_TEXT.includes("/_\\"));
    assert.ok(GREENWOOD_FIRE_CLEARING_SEATED_MOBILE_TEXT.includes("/_\\"));
    assert.ok(GREENWOOD_FIRE_CLEARING_WAITING_DESKTOP_TEXT.includes("/\\"));
    assert.ok(GREENWOOD_FIRE_CLEARING_SEATED_DESKTOP_TEXT.includes("*"));
    assert.ok(GREENWOOD_FIRE_CLEARING_WAITING_MOBILE_TEXT.length > 40);
    assert.ok(GREENWOOD_FIRE_CLEARING_SEATED_MOBILE_TEXT.length > 40);
    assert.ok(GREENWOOD_FIRE_CLEARING_LISTENING_TEXT.includes("^"));
    assert.equal(GREENWOOD_FIRE_TITLE_MARK, "(^)");
    assert.match(GREENWOOD_FIRE_A11Y_WAITING, /quiet campfire/i);
    assert.match(GREENWOOD_FIRE_A11Y_SEATED, /brighter campfire/i);
  });

  it("uses deterministic attendance limits for the clearing ring", () => {
    assert.equal(GREENWOOD_FIRE_CLEARING_WAITING_LIMIT, 4);
    assert.equal(GREENWOOD_FIRE_CLEARING_WAITING_LIMIT_NARROW, 2);
  });

  it("formats singular and plural overflow copy", () => {
    assert.equal(
      formatFireWaitingOverflow(1),
      "+ 1 OTHER MARK WAITS BEYOND THE FIRELIGHT",
    );
    assert.equal(
      formatFireWaitingOverflow(8),
      "+ 8 OTHER MARKS WAIT BEYOND THE FIRELIGHT",
    );
    assert.equal(formatFireWaitingOverflow(0), "");
  });
});

describe("AT THE FIRE clearing composition", () => {
  it("renders waiting and seated modes with elevated self and open place", () => {
    const ui = read("src/components/greenwood/greenwood-fire-presence.tsx");
    assert.match(ui, /GREENWOOD_FIRE_CLEARING_WAITING_/);
    assert.match(ui, /GREENWOOD_FIRE_CLEARING_SEATED_/);
    assert.match(ui, /mode === "waiting"|mode="waiting"/);
    assert.match(ui, /mode === "seated"|mode="seated"/);
    assert.match(ui, /greenwood-fire-presence__self-sigil/);
    assert.match(ui, /YOU ARE HERE/);
    assert.match(ui, /filter\(\(m\) => !m\.isSelf\)/);
    assert.match(ui, /waitingMembers/);
    assert.match(ui, /warmMembers/);
    assert.match(ui, /WAITING BY THE FIRE/);
    assert.match(ui, /MARKS STILL WARM/);
    assert.match(ui, /formatFireWaitingOverflow/);
    assert.match(ui, /A PLACE/);
    assert.match(ui, /AWAITS YOU/);
    assert.match(ui, /showOpenPlace/);
    assert.match(ui, /THE FIRE WAITS/);
    assert.match(ui, /OTHERS ARE ALREADY WAITING/);
    assert.match(ui, /THE FIRE KNOWS YOU ARE HERE/);
    assert.match(ui, /The Fire sees you\. The Greenwood remembers/);
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
    assert.match(ui, /Make your mark\. Sit by the Fire/);
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
    assert.match(css, /greenwood-fire-presence__ascii-line--ember/);
    assert.match(css, /greenwood-fire-presence__open-place/);
    assert.match(css, /--gw-fire-ember/);
  });

  it("full Greenwood heading order remains unchanged", () => {
    const member = read("src/components/greenwood/greenwood-member.tsx");
    const bodyStart = member.indexOf("greenwood-member__body");
    assert.ok(bodyStart >= 0);
    const body = member.slice(bodyStart);
    const order = [
      'id="gf-message"',
      "GreenwoodFireGathering",
      "GreenwoodFirePresence",
      'id="gf-place"',
      'id="gf-deeds"',
      "GreenwoodFireHollow",
    ];
    let cursor = -1;
    for (const marker of order) {
      const next = body.indexOf(marker);
      assert.ok(next > cursor, `expected ${marker} after previous section`);
      cursor = next;
    }
  });
});
