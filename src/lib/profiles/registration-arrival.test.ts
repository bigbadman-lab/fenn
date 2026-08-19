import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  OUTLAW_REGISTRATION_ARRIVAL_METHOD,
  OUTLAW_REGISTRATION_ARRIVAL_PATH,
  REGISTRATION_IDENTITY_PREPARING_COPY,
  REGISTRATION_WRITE_OPEN_FAILED_COPY,
  REGISTRATION_WRITING_COPY,
} from "./registration-arrival";
import { NAMED_DISPLAY } from "@/lib/site/world-vocabulary";

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

  it("defines intentional writing and recovery copy without technical jargon", () => {
    assert.equal(
      REGISTRATION_WRITING_COPY.title,
      "YOUR NAME IS BEING WRITTEN.",
    );
    assert.equal(
      REGISTRATION_WRITING_COPY.body,
      "The Register is remembering you.",
    );
    assert.equal(REGISTRATION_WRITING_COPY.status, "[ writing the name… ]");
    assert.equal(
      REGISTRATION_WRITE_OPEN_FAILED_COPY.title,
      "YOUR NAME WAS WRITTEN.",
    );
    assert.equal(
      REGISTRATION_WRITE_OPEN_FAILED_COPY.body,
      "The road did not open cleanly.",
    );
    assert.equal(
      REGISTRATION_WRITE_OPEN_FAILED_COPY.action,
      NAMED_DISPLAY.continueToHub,
    );
  });

  it("defines pre-form identity preparing copy after Privy auth", () => {
    assert.equal(
      REGISTRATION_IDENTITY_PREPARING_COPY.title,
      NAMED_DISPLAY.becoming,
    );
    assert.equal(
      REGISTRATION_IDENTITY_PREPARING_COPY.body,
      "YOUR IDENTITY IS BEING PREPARED.",
    );
    assert.equal(
      REGISTRATION_IDENTITY_PREPARING_COPY.wait,
      NAMED_DISPLAY.formOpening,
    );
    assert.equal(
      REGISTRATION_IDENTITY_PREPARING_COPY.note,
      "THIS MAY TAKE A FEW SECONDS.",
    );
    assert.doesNotMatch(
      Object.values(REGISTRATION_IDENTITY_PREPARING_COPY).join(" "),
      /loading profile|process your account|please wait/i,
    );
  });

  it("shows identity preparing hold for bootstrap and walletResolving, not registered identity path", () => {
    const panel = read("src/components/outlaw/outlaw-register-panel.tsx");
    const css = read("src/app/globals.css");
    assert.match(panel, /REGISTRATION_IDENTITY_PREPARING_COPY/);
    assert.match(panel, /OutlawIdentityPreparingHold/);
    assert.match(panel, /walletResolving/);
    assert.match(
      panel,
      /if \(authenticated\)[\s\S]*OutlawIdentityPreparingHold/,
    );
    assert.match(
      panel,
      /if \(walletResolving\)[\s\S]*OutlawIdentityPreparingHold/,
    );
    assert.doesNotMatch(panel, /the wood is checking its books/);
    assert.doesNotMatch(panel, /the wood is preparing a place for you/);
    // Unauthenticated listen remains muted one-liner
    assert.match(panel, /the wood is listening\.\.\./);
    // Returning registered identity UI unchanged
    assert.match(panel, /the wood remembers you/);
    assert.match(panel, /if \(registered && profile\)/);
    // Form eligibility still requires wallets
    assert.match(panel, /if \(wallets\.length === 0\)/);
    assert.match(panel, /the wood needs a name/);
    // Holding a11y + red attention (not failure) treatment
    assert.match(panel, /outlaw-register-holding--preparing/);
    assert.match(css, /\.outlaw-register-holding--preparing/);
    assert.match(css, /--color-danger/);
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

  it("uses explicit phases: idle, submitting, writing, write_open_failed", () => {
    const panel = read("src/components/outlaw/outlaw-register-panel.tsx");
    const arrival = read("src/lib/profiles/registration-arrival.ts");
    assert.match(arrival, /OutlawRegisterPhase/);
    assert.match(arrival, /"idle"/);
    assert.match(arrival, /"submitting"/);
    assert.match(arrival, /"writing"/);
    assert.match(arrival, /"write_open_failed"/);
    assert.match(panel, /setPhase\("submitting"\)/);
    assert.match(panel, /setPhase\("writing"\)/);
    assert.match(panel, /setPhase\("write_open_failed"\)/);
    assert.match(panel, /setPhase\("idle"\)/);
  });

  it("shows submitting wait label while the register request is pending", () => {
    const panel = read("src/components/outlaw/outlaw-register-panel.tsx");
    assert.match(panel, /phase === "submitting" \? "\[ waiting \]"/);
    assert.match(panel, /\[ claim the name \]/);
  });

  it("holds intentional writing UI after success and before replace", () => {
    const panel = read("src/components/outlaw/outlaw-register-panel.tsx");
    assert.match(panel, /REGISTRATION_WRITING_COPY/);
    assert.match(panel, /REGISTRATION_WRITING_COPY\.title/);
    assert.match(panel, /REGISTRATION_WRITING_COPY\.body/);
    assert.match(panel, /REGISTRATION_WRITING_COPY\.status/);
    assert.match(panel, /role="status"/);
    assert.match(panel, /aria-live="polite"/);
    assert.match(panel, /aria-busy="true"/);
    assert.doesNotMatch(panel, /setTimeout/);
    assert.doesNotMatch(panel, /progress|spinner|toast/i);
  });

  it("locks form during submit and never after success path re-enables register", () => {
    const panel = read("src/components/outlaw/outlaw-register-panel.tsx");
    assert.match(panel, /const formLocked = phase !== "idle"/);
    assert.match(panel, /if \(phase !== "idle"\)/);
    assert.match(panel, /disabled=\{formLocked\}/);
    assert.match(panel, /disabled=\{formLocked \|\| !selectedWallet\}/);
  });

  it("refreshes bootstrap after success then replace; not on failed response", () => {
    const panel = read("src/components/outlaw/outlaw-register-panel.tsx");
    const open = panel.slice(
      panel.indexOf("const openRoadAfterWrite"),
      panel.indexOf("async function onSubmit"),
    );
    const onSubmit = panel.slice(
      panel.indexOf("async function onSubmit"),
      panel.indexOf("function wrap("),
    );

    assert.match(onSubmit, /\/api\/outlaw\/register/);
    assert.match(onSubmit, /if \(!response\.ok\)/);
    assert.match(onSubmit, /setFormError/);
    assert.doesNotMatch(
      onSubmit.slice(0, onSubmit.indexOf("if (!response.ok)")),
      /openRoadAfterWrite|router\.replace/,
    );
    assert.match(onSubmit, /await openRoadAfterWrite\(\)/);

    assert.match(open, /setPhase\("writing"\)/);
    assert.match(open, /await refreshMe\(\)/);
    const refreshIdx = open.indexOf("await refreshMe()");
    const replaceIdx = open.indexOf("router.replace");
    assert.ok(refreshIdx >= 0 && replaceIdx > refreshIdx);
    assert.match(open, /if \(!refreshed\)/);
    assert.match(open, /navigatedRef/);
  });

  it("failed registration never enters writing phase", () => {
    const panel = read("src/components/outlaw/outlaw-register-panel.tsx");
    const onSubmit = panel.slice(
      panel.indexOf("async function onSubmit"),
      panel.indexOf("function wrap("),
    );
    assert.match(onSubmit, /if \(!response\.ok\)[\s\S]*setPhase\("idle"\)/);
    assert.doesNotMatch(
      onSubmit.slice(
        onSubmit.indexOf("if (!response.ok)"),
        onSubmit.indexOf("profileWritten = true"),
      ),
      /openRoadAfterWrite|setPhase\("writing"\)/,
    );
  });

  it("refresh failure does not claim registration failed and offers continuation", () => {
    const panel = read("src/components/outlaw/outlaw-register-panel.tsx");
    assert.match(panel, /REGISTRATION_WRITE_OPEN_FAILED_COPY/);
    assert.match(panel, /REGISTRATION_WRITE_OPEN_FAILED_COPY\.title/);
    assert.match(panel, /REGISTRATION_WRITE_OPEN_FAILED_COPY\.body/);
    assert.match(panel, /REGISTRATION_WRITE_OPEN_FAILED_COPY\.action/);
    assert.match(panel, /openRoadAfterWrite/);
    const recovery = panel.slice(
      panel.indexOf('phase === "write_open_failed"'),
      panel.indexOf("if (!privyReady || loading)"),
    );
    assert.doesNotMatch(recovery, /\/api\/outlaw\/register/);
    assert.match(recovery, /openRoadAfterWrite/);
  });

  it("does not leave a long-lived local successNumber success state", () => {
    const panel = read("src/components/outlaw/outlaw-register-panel.tsx");
    assert.doesNotMatch(panel, /successNumber/);
    assert.doesNotMatch(panel, /the road opens\.\.\./);
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
    assert.match(onSubmit, /if \(!response\.ok\)/);
    assert.doesNotMatch(onSubmit, /response\.status\s*===\s*201/);
    assert.match(onSubmit, /await openRoadAfterWrite\(\)/);
  });

  it("refreshMe reports bootstrap success for holding recovery", () => {
    const auth = read("src/components/auth/fenn-auth-provider.tsx");
    assert.match(auth, /Promise<boolean>/);
    assert.match(auth, /return true/);
    assert.match(auth, /return false/);
  });

  it("does not introduce register ↔ outlaw redirect loops on the outlaw page", () => {
    const outlawPage = read("src/app/outlaw/page.tsx");
    assert.doesNotMatch(outlawPage, /router\.(push|replace)/);
    assert.doesNotMatch(outlawPage, /redirect\(/);
    assert.match(outlawPage, /REGISTER_ANCHOR_HREF|outlaw-register/);
  });

  it("registration rules and RPC path are unchanged", () => {
    const register = read("src/lib/profiles/register.ts");
    assert.match(register, /register_outlaw/);
    assert.match(register, /outlawRegisterSchema/);
    assert.match(register, /assertWalletOwnedByIdentity/);
  });
});
