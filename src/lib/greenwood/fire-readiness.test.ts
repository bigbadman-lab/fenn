import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "../../..");

function read(rel: string): string {
  return readFileSync(join(repo, rel), "utf8");
}

describe("Fire readiness — member meaning and UI", () => {
  it("not-sitting copy explains waiting without technical jargon", () => {
    const ui = read("src/components/greenwood/greenwood-fire-presence.tsx");
    assert.match(ui, /Those who sit here are considered present/);
    assert.match(ui, /may be called first/);
    assert.match(ui, /Leave whenever you wish/);
    assert.match(ui, /SIT BY THE FIRE/);
    assert.doesNotMatch(ui, /heartbeat|online|polling|active session|status toggle/i);
  });

  it("seated copy communicates readiness without promising rewards", () => {
    const ui = read("src/components/greenwood/greenwood-fire-presence.tsx");
    assert.match(ui, /THE FIRE KNOWS YOU ARE HERE/);
    assert.match(ui, /Your place is held/);
    assert.match(ui, /counted among those waiting/);
    assert.match(ui, /YOU ARE HERE/);
    assert.match(ui, /LEAVE THE FIRE/);
    assert.doesNotMatch(ui, /will receive|guaranteed|LEAF|reward|selected/i);
  });

  it("seated self is elevated and excluded from remaining lists", () => {
    const ui = read("src/components/greenwood/greenwood-fire-presence.tsx");
    assert.match(ui, /filter\(\(m\) => !m\.isSelf\)/);
    assert.match(ui, /greenwood-fire-presence__self-sigil/);
    assert.match(ui, /WAITING BY THE FIRE/);
    assert.match(ui, /MARKS STILL WARM/);
    assert.match(ui, /THE FIRE WAITS|OTHERS ARE ALREADY WAITING/);
  });

  it("Fire section exposes id=the-fire and keeps gf-at-fire heading", () => {
    const ui = read("src/components/greenwood/greenwood-fire-presence.tsx");
    assert.match(ui, /id="the-fire"/);
    assert.match(ui, /id="gf-at-fire"/);
    assert.match(ui, /aria-labelledby="gf-at-fire"/);
  });

  it("hash scroll helper runs once with reduced-motion respect", () => {
    const scroll = read(
      "src/components/greenwood/greenwood-fire-hash-scroll.tsx",
    );
    const member = read("src/components/greenwood/greenwood-member.tsx");
    assert.match(scroll, /#the-fire/);
    assert.match(scroll, /#gf-at-fire/);
    assert.match(scroll, /scrolled\.current = true/);
    assert.match(scroll, /prefers-reduced-motion/);
    assert.match(scroll, /behavior: reduced \? "auto" : "smooth"/);
    assert.match(member, /GreenwoodFireHashScroll/);
  });

  it("failed sit\/leave shows restrained inline feedback", () => {
    const hook = read("src/hooks/use-greenwood-fire-presence.ts");
    const ui = read("src/components/greenwood/greenwood-fire-presence.tsx");
    assert.match(hook, /the Fire did not answer/);
    assert.match(ui, /actionError/);
    assert.doesNotMatch(ui, /toast|PGRST|stack/i);
  });
});

describe("Fire readiness — Gathering copy", () => {
  it("Gathering states reference the Fire without promising rewards", () => {
    const gathering = read(
      "src/components/greenwood/greenwood-fire-gathering.tsx",
    );
    assert.match(
      gathering,
      /Those waiting at the Fire will be here when one begins/,
    );
    assert.match(
      gathering,
      /Those already seated at the Fire will be present when the Gathering begins/,
    );
    assert.match(gathering, /Those seated at the Fire are here/);
    assert.doesNotMatch(
      gathering,
      /will receive|guaranteed selection|automatically rewarded/i,
    );
  });
});

describe("Fire readiness — shell status and heartbeat ownership", () => {
  it("shell status appears only for seated members and links to the Fire", () => {
    const status = read("src/components/shell/shell-fire-status.tsx");
    const shell = read("src/components/shell/application-shell.tsx");
    const provider = read("src/components/shell/fire-presence-provider.tsx");
    assert.match(status, /seated/);
    assert.match(status, /\/greenwood#the-fire/);
    assert.match(status, /Return to the Fire/);
    assert.match(status, /● AT THE FIRE/);
    assert.match(status, /● FIRE/);
    assert.match(shell, /FirePresenceProvider/);
    assert.match(shell, /ShellFireStatus/);
    assert.doesNotMatch(status, /LEAVE THE FIRE|leaveTheFire/);
    assert.match(provider, /GREENWOOD_FIRE_HEARTBEAT_MS/);
    assert.match(provider, /enabled: seated/);
  });

  it("compact self endpoint returns only member\/active\/sitting", () => {
    const route = read("src/app/api/greenwood/presence/self/route.ts");
    const self = read("src/lib/greenwood/presence/self-status.ts");
    const client = read("src/lib/greenwood/client.ts");
    assert.match(route, /getFireSelfStatus/);
    assert.match(route, /private, no-store/);
    assert.match(self, /member: true/);
    assert.match(self, /isFirePresenceActive/);
    assert.doesNotMatch(self, /wallet_address|ascii_body|outlaw_number/);
    assert.doesNotMatch(route, /presence\.members|ascii_body|wallet_address/);
    assert.match(client, /fetchGreenwoodFireSelfStatus/);
  });

  it("local and shell heartbeat ownership does not duplicate seated loops", () => {
    const hook = read("src/hooks/use-greenwood-fire-presence.ts");
    const provider = read("src/components/shell/fire-presence-provider.tsx");
    assert.match(hook, /enabled: enabled && !seated/);
    assert.match(hook, /notifySitting/);
    assert.match(provider, /enabled: seated/);
    assert.match(hook, /Shell owns heartbeat while seated/);
  });

  it("75-second expiry constant remains unchanged", () => {
    const constants = read("src/lib/greenwood/presence/constants.ts");
    assert.match(constants, /GREENWOOD_FIRE_ACTIVE_TIMEOUT_MS = 75_000/);
    assert.match(constants, /GREENWOOD_FIRE_HEARTBEAT_MS = 22_000/);
  });
});

describe("Fire readiness — Desk visibility", () => {
  it("Desk separates waiting and warm members and stays read-only", () => {
    const ui = read("src/components/desk/desk-fire-panel.tsx");
    const types = read("src/lib/desk/fire-types.ts");
    const lib = read("src/lib/desk/fire.ts");
    const route = read("src/app/api/desk/fire/route.ts");
    assert.match(ui, /WAITING BY THE FIRE/);
    assert.match(ui, /MARKS STILL WARM/);
    assert.match(ui, /OPEN GATHERINGS/);
    assert.match(ui, /WHO IS WAITING TO BE CALLED/);
    assert.doesNotMatch(ui, /force leave|clear fire|configurable expiry/i);
    assert.match(types, /sittingSince/);
    assert.match(types, /waitingLabel/);
    assert.match(types, /warmCount/);
    assert.match(lib, /sitting_since/);
    assert.match(route, /requireFennDeskAccess/);
  });
});
