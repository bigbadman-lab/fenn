import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  isAwaitingNameClaim,
  isHomePath,
  REGISTER_LOGIN_GUIDE_HREF,
  REGISTER_LOGIN_GUIDE_ID,
  shouldGuideToRegisterAfterAuthChange,
} from "@/lib/home/register-login-guide";
import {
  REGISTER_ANCHOR_HREF,
  REGISTER_ANCHOR_ID,
} from "@/lib/site/world-vocabulary";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "../../..");

function read(rel: string): string {
  return readFileSync(join(repo, rel), "utf8");
}

const awaiting = {
  privyReady: true,
  authenticated: true,
  profileResolved: true,
  registered: false,
} as const;

describe("register login guide helpers", () => {
  it("detects awaiting name claim only when auth is settled and unnamed", () => {
    assert.equal(isAwaitingNameClaim(awaiting), true);
    assert.equal(
      isAwaitingNameClaim({ ...awaiting, profileResolved: false }),
      false,
    );
    assert.equal(isAwaitingNameClaim({ ...awaiting, registered: true }), false);
    assert.equal(
      isAwaitingNameClaim({ ...awaiting, authenticated: false }),
      false,
    );
    assert.equal(isAwaitingNameClaim({ ...awaiting, privyReady: false }), false);
  });

  it("guides on first ready sample and login edge, not while already authed", () => {
    assert.equal(
      shouldGuideToRegisterAfterAuthChange({
        prevAuthenticated: null,
        current: awaiting,
      }),
      true,
    );
    assert.equal(
      shouldGuideToRegisterAfterAuthChange({
        prevAuthenticated: false,
        current: awaiting,
      }),
      true,
    );
    assert.equal(
      shouldGuideToRegisterAfterAuthChange({
        prevAuthenticated: true,
        current: awaiting,
      }),
      false,
    );
    assert.equal(
      shouldGuideToRegisterAfterAuthChange({
        prevAuthenticated: false,
        current: { ...awaiting, registered: true },
      }),
      false,
    );
  });

  it("targets the homepage register anchor", () => {
    assert.equal(REGISTER_LOGIN_GUIDE_ID, REGISTER_ANCHOR_ID);
    assert.equal(REGISTER_LOGIN_GUIDE_HREF, REGISTER_ANCHOR_HREF);
    assert.equal(REGISTER_LOGIN_GUIDE_ID, "outlaw-register");
    assert.equal(isHomePath("/"), true);
    assert.equal(isHomePath(""), true);
    assert.equal(isHomePath("/camp"), false);
  });
});

describe("post-login register guide wiring", () => {
  it("mounts in the application shell and scrolls to CLAIM A NAME", () => {
    const guide = read("src/components/home/post-login-register-guide.tsx");
    const shell = read("src/components/shell/application-shell.tsx");
    assert.match(guide, /shouldGuideToRegisterAfterAuthChange/);
    assert.match(guide, /REGISTER_LOGIN_GUIDE_ID|outlaw-register/);
    assert.match(guide, /scrollIntoView/);
    assert.match(guide, /prefers-reduced-motion/);
    assert.match(guide, /router\.push\(REGISTER_LOGIN_GUIDE_HREF\)/);
    assert.match(shell, /PostLoginRegisterGuide/);
  });
});
