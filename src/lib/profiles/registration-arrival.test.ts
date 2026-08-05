import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  OUTLAW_REGISTRATION_ARRIVAL_METHOD,
  OUTLAW_REGISTRATION_ARRIVAL_PATH,
} from "./registration-arrival";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "../../..");

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

describe("Outlaw registration arrival (Book of the Road)", () => {
  it("defines /outlaw as the post-registration destination with replace", () => {
    assert.equal(OUTLAW_REGISTRATION_ARRIVAL_PATH, "/outlaw");
    assert.equal(OUTLAW_REGISTRATION_ARRIVAL_METHOD, "replace");
  });

  it("shared panel is the one success handler for homepage and standalone register", () => {
    const panel = read("src/components/outlaw/outlaw-register-panel.tsx");
    const home = read("src/components/home/home-outlaw-register.tsx");
    const standalone = read("src/app/outlaw/register/page.tsx");

    assert.match(home, /OutlawRegisterPanel/);
    assert.match(standalone, /OutlawRegisterPanel/);
    assert.doesNotMatch(home, /router\.(push|replace)/);
    assert.doesNotMatch(standalone, /router\.(push|replace)/);

    assert.match(panel, /OUTLAW_REGISTRATION_ARRIVAL_PATH/);
    assert.match(panel, /router\.replace\(OUTLAW_REGISTRATION_ARRIVAL_PATH\)/);
    assert.doesNotMatch(panel, /router\.push\(/);
  });

  it("refreshes bootstrap before navigation and only after successful response", () => {
    const panel = read("src/components/outlaw/outlaw-register-panel.tsx");
    const onSubmit = panel.slice(
      panel.indexOf("async function onSubmit"),
      panel.indexOf("function wrap("),
    );

    assert.match(onSubmit, /\/api\/outlaw\/register/);
    assert.match(onSubmit, /if \(!response\.ok\)/);
    assert.match(onSubmit, /setFormError/);
    assert.doesNotMatch(
      onSubmit.slice(0, onSubmit.indexOf("if (!response.ok)")),
      /router\.replace/,
    );

    const successPath = onSubmit.slice(onSubmit.indexOf("if (!response.ok)"));
    // Failure returns before replace.
    assert.match(successPath, /return;[\s\S]*setArriving\(true\)/);
    assert.match(successPath, /await refreshMe\(\)/);
    const refreshIdx = successPath.indexOf("await refreshMe()");
    const replaceIdx = successPath.indexOf("router.replace");
    assert.ok(refreshIdx >= 0 && replaceIdx > refreshIdx);

    // Failures never start arrival navigation.
    assert.match(onSubmit, /setArriving\(false\)/);
  });

  it("guards against double submit while waiting or arriving", () => {
    const panel = read("src/components/outlaw/outlaw-register-panel.tsx");
    assert.match(panel, /if \(submitting \|\| arriving\)/);
    assert.match(panel, /disabled=\{submitting \|\| !selectedWallet\}/);
    assert.match(panel, /the road opens\.\.\./);
  });

  it("does not leave a long-lived success state on the registration form", () => {
    const panel = read("src/components/outlaw/outlaw-register-panel.tsx");
    assert.doesNotMatch(panel, /successNumber/);
    assert.doesNotMatch(panel, /\[ continue \]/);
    assert.doesNotMatch(panel, />accepted\.</);
  });

  it("invite consumption remains server-side before the success response", () => {
    const register = read("src/lib/profiles/register.ts");
    const route = read("src/app/api/outlaw/register/route.ts");
    assert.match(register, /tryConsumeInviteAfterRegistration/);
    assert.match(register, /if \(created\)/);
    assert.ok(
      register.indexOf("tryConsumeInviteAfterRegistration") <
        register.indexOf("return {"),
    );
    assert.match(route, /registerOutlaw\(identity, body\)/);
    assert.match(route, /status: result\.created \? 201 : 200/);
  });

  it("idempotent success (200 existing) still uses the same client success path", () => {
    const panel = read("src/components/outlaw/outlaw-register-panel.tsx");
    const onSubmit = panel.slice(
      panel.indexOf("async function onSubmit"),
      panel.indexOf("function wrap("),
    );
    // Any response.ok — not only 201 — navigates.
    assert.match(onSubmit, /if \(!response\.ok\)/);
    assert.doesNotMatch(onSubmit, /response\.status\s*===\s*201/);
    assert.match(onSubmit, /router\.replace\(OUTLAW_REGISTRATION_ARRIVAL_PATH\)/);
  });

  it("does not introduce register ↔ outlaw redirect loops on the outlaw page", () => {
    const outlawPage = read("src/app/outlaw/page.tsx");
    assert.doesNotMatch(outlawPage, /router\.(push|replace)/);
    assert.doesNotMatch(outlawPage, /redirect\(/);
    // Unregistered still get a link, not an automatic bounce loop through replace.
    assert.match(outlawPage, /\/outlaw\/register/);
  });

  it("registration rules and RPC path are unchanged", () => {
    const register = read("src/lib/profiles/register.ts");
    assert.match(register, /register_outlaw/);
    assert.match(register, /outlawRegisterSchema/);
    assert.match(register, /assertWalletOwnedByIdentity/);
  });
});
