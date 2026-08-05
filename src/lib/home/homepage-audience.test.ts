import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  HOMEPAGE_ACTIONS,
  HOMEPAGE_GREETING,
  HOMEPAGE_MAP_ORIENTATION,
  HOMEPAGE_OUTLAW_THRESHOLD,
  homepageGreetingTitle,
  resolveHomepageAudience,
  shouldShowBecomeOutlawCta,
  shouldShowBeginHere,
  shouldShowExploreMapCta,
  type HomepageAudienceInput,
} from "@/lib/home/homepage-audience";

const repo = process.cwd();

function read(rel: string): string {
  return readFileSync(join(repo, rel), "utf8");
}

const base: HomepageAudienceInput = {
  privyReady: true,
  authLoading: false,
  profileResolved: true,
  authenticated: false,
  registered: false,
  greenwoodMember: false,
};

describe("resolveHomepageAudience", () => {
  it("SSR / Privy-not-ready defaults to stranger (hydration-stable public path)", () => {
    assert.equal(
      resolveHomepageAudience({ ...base, privyReady: false }),
      "stranger",
    );
  });

  it("anonymous visitor → stranger", () => {
    assert.equal(resolveHomepageAudience(base), "stranger");
    assert.equal(homepageGreetingTitle("stranger"), HOMEPAGE_GREETING.stranger);
    assert.equal(shouldShowBecomeOutlawCta("stranger"), true);
    assert.equal(shouldShowExploreMapCta("stranger"), true);
    assert.equal(shouldShowBeginHere("stranger"), true);
  });

  it("authenticated but profile unresolved → pending (no wrong greeting)", () => {
    assert.equal(
      resolveHomepageAudience({
        ...base,
        authenticated: true,
        profileResolved: false,
      }),
      "pending",
    );
    assert.equal(homepageGreetingTitle("pending"), null);
    assert.equal(shouldShowBecomeOutlawCta("pending"), false);
  });

  it("auth loading while authenticated → pending", () => {
    assert.equal(
      resolveHomepageAudience({
        ...base,
        authenticated: true,
        authLoading: true,
        profileResolved: false,
      }),
      "pending",
    );
  });

  it("registered non-Greenwood → outlaw", () => {
    assert.equal(
      resolveHomepageAudience({
        ...base,
        authenticated: true,
        registered: true,
        greenwoodMember: false,
      }),
      "outlaw",
    );
    assert.equal(homepageGreetingTitle("outlaw"), HOMEPAGE_GREETING.outlaw);
    assert.equal(shouldShowBecomeOutlawCta("outlaw"), false);
    assert.equal(shouldShowExploreMapCta("outlaw"), true);
    assert.equal(shouldShowBeginHere("outlaw"), false);
  });

  it("Greenwood member → greenwood", () => {
    assert.equal(
      resolveHomepageAudience({
        ...base,
        authenticated: true,
        registered: true,
        greenwoodMember: true,
      }),
      "greenwood",
    );
    assert.equal(
      homepageGreetingTitle("greenwood"),
      HOMEPAGE_GREETING.greenwood,
    );
    assert.equal(shouldShowBecomeOutlawCta("greenwood"), false);
  });

  it("authenticated but unregistered stays stranger", () => {
    assert.equal(
      resolveHomepageAudience({
        ...base,
        authenticated: true,
        registered: false,
      }),
      "stranger",
    );
    assert.equal(shouldShowBecomeOutlawCta("stranger"), true);
  });
});

describe("homepage copy constants", () => {
  it("uses prescribed greetings and CTAs", () => {
    assert.equal(HOMEPAGE_GREETING.stranger, "WELCOME, STRANGER.");
    assert.equal(HOMEPAGE_GREETING.outlaw, "WELCOME, OUTLAW.");
    assert.equal(HOMEPAGE_GREETING.greenwood, "WELCOME HOME.");
    assert.equal(HOMEPAGE_ACTIONS.becomeOutlaw, "[ BECOME AN OUTLAW ]");
    assert.equal(HOMEPAGE_ACTIONS.exploreMap, "[ EXPLORE THE MAP ]");
    assert.equal(HOMEPAGE_MAP_ORIENTATION.title, "THE WORLD");
    assert.ok(
      HOMEPAGE_MAP_ORIENTATION.lines.some((l) =>
        /named place can be entered/i.test(l),
      ),
    );
    assert.equal(HOMEPAGE_OUTLAW_THRESHOLD.title, "BECOME AN OUTLAW");
  });
});

describe("homepage V2 structure and wiring", () => {
  it("places welcome → journey → map → outlaw threshold before lore voice", () => {
    const page = read("src/app/page.tsx");
    const welcome = page.indexOf("<HomeWelcome");
    const journey = page.indexOf("<HomeFirstThirty");
    const identity = page.indexOf("<HomeIdentity");
    const register = page.indexOf("<HomeOutlawRegister");
    const voice = page.indexOf("<HomeFennVoice");
    const transmission = page.indexOf("<LoreTransmission");
    assert.ok(welcome >= 0 && journey > welcome);
    assert.ok(identity > journey);
    assert.ok(register > identity);
    assert.ok(voice > register);
    assert.ok(transmission > voice);
  });

  it("welcome uses audience helpers and does not hardcode OUTLAW for all", () => {
    const welcome = read("src/components/home/home-welcome.tsx");
    assert.match(welcome, /resolveHomepageAudience/);
    assert.match(welcome, /HOMEPAGE_ACTIONS\.becomeOutlaw/);
    assert.match(welcome, /HOMEPAGE_ACTIONS\.outlawThresholdId/);
    assert.match(welcome, /HOMEPAGE_ACTIONS\.mapId/);
    assert.doesNotMatch(welcome, /ENTER THE MAP/);
  });

  it("map keeps orientation copy and semantic nav", () => {
    const identity = read("src/components/home/home-identity.tsx");
    const map = read("src/components/home/fenn-world-map.tsx");
    assert.match(identity, /HOMEPAGE_MAP_ORIENTATION|THE WORLD/);
    assert.match(map, /aria-label="map of fenn"/);
    assert.match(map, /id="the-map"/);
    assert.match(map, /nav className="fenn-map"/);
  });

  it("map content still links all landmarks", () => {
    const map = read("src/content/home-world-map.ts");
    for (const label of [
      "[ the book ]",
      "[ the oak ]",
      "[ the greenwood ]",
      "[ deeds ]",
      "[ the camp ]",
      "[ the ledger ]",
      "[ the commons ]",
      "[ the wall ]",
    ]) {
      assert.ok(map.includes(`label: "${label}"`), label);
    }
  });

  it("outlaw threshold explains permanence without price language", () => {
    const panel = read("src/components/home/home-outlaw-register.tsx");
    const audience = read("src/lib/home/homepage-audience.ts");
    assert.match(panel, /HOMEPAGE_OUTLAW_THRESHOLD/);
    assert.match(audience, /permanent name in the Register/);
    assert.match(audience, /journey permanent/);
    assert.doesNotMatch(audience, /price|ROI|APY|airdrop/i);
  });

  it("shell and register auth use begin not connect/enter for Privy login", () => {
    const shell = read("src/components/shell/shell-auth-controls.tsx");
    const register = read("src/components/outlaw/outlaw-register-panel.tsx");
    assert.match(shell, /\[\s*begin\s*\]/);
    assert.doesNotMatch(shell, /\[\s*connect\s*\]/);
    assert.doesNotMatch(shell, /\[\s*enter\s*\]/);
    assert.match(shell, /onClick=\{\(\) => login\(\)\}/);

    assert.match(register, /\[\s*begin\s*\]/);
    assert.doesNotMatch(
      register.replace(/missing auth tokens\. reconnect\./, ""),
      /\[\s*connect\s*\]/,
    );
    assert.doesNotMatch(register, /\[\s*enter\s*\]/);
    assert.match(register, /onClick=\{\(\) => login\(\)\}/);
    assert.match(register, /\[\s*claim the name\s*\]/);

    const audience = read("src/lib/home/homepage-audience.ts");
    assert.match(audience, /\[ BECOME AN OUTLAW \]/);
  });
});
