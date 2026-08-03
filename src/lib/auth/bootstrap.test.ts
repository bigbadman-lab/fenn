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

describe("Authenticated world bootstrap", () => {
  const service = read("src/lib/auth/bootstrap.ts");
  const route = read("src/app/api/auth/bootstrap/route.ts");
  const auth = read("src/components/auth/fenn-auth-provider.tsx");
  const ftHook = read("src/hooks/use-first-thirty.ts");
  const inviteHook = read("src/hooks/use-outlaw-invite.ts");
  const homeFt = read("src/components/home/home-first-thirty.tsx");
  const outlawPage = read("src/app/outlaw/page.tsx");
  const outlawInvite = read("src/components/outlaw/outlaw-invite.tsx");
  const css = read("src/app/globals.css");
  const meRoute = read("src/app/api/auth/me/route.ts");
  const ftRoute = read("src/app/api/first-thirty/route.ts");
  const inviteRoute = read("src/app/api/invites/me/route.ts");

  it("bootstrap service verifies once via caller identity and loads profile once", () => {
    assert.match(service, /getAuthenticatedWorldBootstrap/);
    assert.match(service, /findProfileByPrivyUserId/);
    // single runtime profile lookup by privy (import + one await call)
    assert.match(service, /const profileRow = await findProfileByPrivyUserId/);
    assert.doesNotMatch(service, /fetch\(['"`]\/api\//);
  });

  it("loads First Thirty and invite in parallel after profile", () => {
    assert.match(service, /Promise\.all/);
    assert.match(service, /getFirstThirtyProgress/);
    assert.match(service, /getOutlawInviteMemberSummary/);
    assert.match(service, /inviteCode:\s*profileRow\.invite_code/);
  });

  it("skips First Thirty for Greenwood members; invite still loads", () => {
    assert.match(service, /isGreenwoodMember/);
    assert.match(
      service,
      /firstThirtyPromise = isGreenwoodMember\s*\?\s*Promise\.resolve/,
    );
  });

  it("unregistered bootstrap returns null journey and invite", () => {
    assert.match(service, /registered: false/);
    assert.match(service, /firstThirty: null/);
    assert.match(service, /inviteSummary: null/);
  });

  it("isolates secondary errors without discarding profile", () => {
    assert.match(service, /errors:\s*\{\s*firstThirty:/);
    assert.match(service, /\[bootstrap firstThirty\]/);
    assert.match(service, /\[bootstrap inviteSummary\]/);
    assert.match(service, /registered: true/);
    assert.match(service, /profile: safeProfile/);
  });

  it("bootstrap API is Bearer no-store and safe on AuthError", () => {
    assert.match(route, /getVerifiedPrivyUser/);
    assert.match(route, /getAuthenticatedWorldBootstrap/);
    assert.match(route, /private, no-store/);
    assert.match(route, /AuthError/);
    assert.doesNotMatch(route, /fetch\(['"`]\/api\/auth\/me/);
    assert.doesNotMatch(route, /fetch\(['"`]\/api\/first-thirty/);
    assert.doesNotMatch(route, /fetch\(['"`]\/api\/invites\/me/);
  });

  it("bootstrap response type avoids private identity fields in client surface", () => {
    assert.match(service, /AuthenticatedWorldBootstrap/);
    assert.doesNotMatch(service, /privyUserId:/);
    // SafeProfile is the outbound profile shape
    assert.match(service, /SafeProfile/);
  });

  it("FennAuthProvider uses one bootstrap request for initial auth load", () => {
    assert.match(auth, /\/api\/auth\/bootstrap/);
    assert.doesNotMatch(auth, /\/api\/auth\/me/);
    assert.match(auth, /firstThirtySnapshot/);
    assert.match(auth, /inviteSnapshot/);
    assert.match(auth, /bootstrapGeneration/);
    assert.match(auth, /clearMemberSnapshots|clearFennProfileState/);
  });

  it("First Thirty hook seeds from bootstrap and skips immediate duplicate fetch", () => {
    assert.match(ftHook, /useBootstrapSnapshot/);
    assert.match(ftHook, /firstThirtySnapshot/);
    assert.match(ftHook, /bootstrapSeed/);
    assert.match(ftHook, /if \(bootstrapSeed\) return/);
    assert.match(ftHook, /\/api\/first-thirty/);
  });

  it("invite hook seeds from bootstrap without mount waterfall when seeded", () => {
    assert.match(inviteHook, /inviteSnapshot/);
    assert.match(inviteHook, /bootstrapSeed/);
    assert.match(inviteHook, /if \(bootstrapSeed\) return/);
    assert.match(inviteHook, /\/api\/invites\/me/);
  });

  it("homepage uses bootstrap First Thirty and reserves stable region", () => {
    assert.match(homeFt, /useBootstrapSnapshot:\s*true/);
    assert.match(homeFt, /home-first-thirty--stable/);
    assert.match(homeFt, /the road is being read|loading/);
    assert.doesNotMatch(homeFt, /0\s*\/\s*30/);
  });

  it("/outlaw does not issue separate me→ft→invite sequence", () => {
    assert.doesNotMatch(outlawPage, /\/api\/auth\/me/);
    assert.doesNotMatch(outlawPage, /\/api\/first-thirty/);
    assert.doesNotMatch(outlawPage, /\/api\/invites\/me/);
    assert.match(outlawPage, /the road is being read/);
    assert.match(outlawPage, /OutlawFirstThirty/);
    assert.match(outlawPage, /OutlawInvite/);
  });

  it("invite soft failure keeps section layout", () => {
    assert.match(outlawInvite, /the road cannot be copied just now/);
    assert.match(outlawInvite, /outlaw-invite--stable/);
  });

  it("layout-stability CSS exists without skeleton cards", () => {
    assert.match(css, /home-first-thirty--stable/);
    assert.match(css, /outlaw-invite--stable/);
    assert.match(css, /outlaw-ft-region/);
    assert.match(css, /forced-colors:\s*active/);
    assert.doesNotMatch(css, /\.skeleton|\.shimmer|skeleton-card/i);
  });

  it("standalone APIs remain for refresh/compat", () => {
    assert.match(meRoute, /export async function GET/);
    assert.match(ftRoute, /export async function GET/);
    assert.match(inviteRoute, /export async function GET/);
    assert.match(ftRoute, /getFirstThirtyProgress/);
  });

  it("registration refresh continues via refreshMe (bootstrap)", () => {
    const reg = read("src/components/outlaw/outlaw-register-panel.tsx");
    assert.match(reg, /refreshMe\(\)/);
    assert.match(auth, /\/api\/auth\/bootstrap/);
  });

  it("logs bootstrap timing without private fields", () => {
    assert.match(service, /auth_bootstrap/);
    assert.match(service, /profileMs/);
    assert.doesNotMatch(service, /accessToken|wallet_address|email/);
  });

  it("member-summary accepts trusted inviteCode to skip profile re-read", () => {
    const summary = read("src/lib/invites/member-summary.ts");
    assert.match(summary, /inviteCode\?:/);
    assert.match(summary, /if \(!inviteCode\)/);
  });
});
