import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  isEmailInDeskAllowlist,
  isWalletInDeskAllowlist,
  parseDeskEmailAllowlist,
  parseDeskWalletAllowlist,
} from "@/lib/desk/config";
import {
  evaluateDeskAccess,
  type DeskEvalIdentity,
  type DeskEvalProfile,
} from "@/lib/desk/evaluate";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "../../..");

const WALLET_A = "11111111111111111111111111111111";
const WALLET_B = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const WALLET_C = "7EcDhSYGxXyoWPo9a6p9q7q7q7q7q7q7q7q7q7q7q7q7";
const EMAIL_A = "keeper@askvell.com";
const EMAIL_B = "other@example.com";

function identity(
  wallets: string[],
  emails: string[] = [],
): DeskEvalIdentity {
  return {
    wallets: wallets.map((address) => ({ address })),
    emails,
  };
}

function profile(wallet: string): DeskEvalProfile {
  return { wallet_address: wallet };
}

describe("evaluateDeskAccess", () => {
  const deskAllowlist = parseDeskWalletAllowlist(WALLET_A);

  it("authorised registered profile succeeds", () => {
    const result = evaluateDeskAccess({
      identity: identity([WALLET_A, WALLET_B]),
      profile: profile(WALLET_A),
      walletAllowlist: deskAllowlist,
      emailAllowlist: [],
    });
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.walletAddress, WALLET_A);
  });

  it("authorised verified email grants Desk without wallet allowlist", () => {
    const result = evaluateDeskAccess({
      identity: identity([WALLET_B], [EMAIL_A]),
      profile: profile(WALLET_B),
      walletAllowlist: [],
      emailAllowlist: parseDeskEmailAllowlist(EMAIL_A),
    });
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.walletAddress, WALLET_B);
  });

  it("email allowlist is case-insensitive", () => {
    const result = evaluateDeskAccess({
      identity: identity([WALLET_B], ["Keeper@AskVell.com"]),
      profile: profile(WALLET_B),
      walletAllowlist: [],
      emailAllowlist: parseDeskEmailAllowlist(EMAIL_A),
    });
    assert.equal(result.ok, true);
  });

  it("unauthenticated user denied", () => {
    const result = evaluateDeskAccess({
      identity: null,
      profile: profile(WALLET_A),
      walletAllowlist: deskAllowlist,
      emailAllowlist: [],
    });
    assert.deepEqual(result, {
      ok: false,
      reason: "unauthenticated",
      status: 401,
    });
  });

  it("authenticated unregistered user denied", () => {
    const result = evaluateDeskAccess({
      identity: identity([WALLET_A]),
      profile: null,
      walletAllowlist: deskAllowlist,
      emailAllowlist: [],
    });
    assert.deepEqual(result, {
      ok: false,
      reason: "profile_required",
      status: 403,
    });
  });

  it("unauthorised registered wallet denied", () => {
    const result = evaluateDeskAccess({
      identity: identity([WALLET_B]),
      profile: profile(WALLET_B),
      walletAllowlist: deskAllowlist,
      emailAllowlist: [],
    });
    assert.deepEqual(result, {
      ok: false,
      reason: "desk_not_allowed",
      status: 403,
    });
  });

  it("unrelated email does not grant Desk", () => {
    const result = evaluateDeskAccess({
      identity: identity([WALLET_B], [EMAIL_B]),
      profile: profile(WALLET_B),
      walletAllowlist: [],
      emailAllowlist: parseDeskEmailAllowlist(EMAIL_A),
    });
    assert.deepEqual(result, {
      ok: false,
      reason: "desk_not_allowed",
      status: 403,
    });
  });

  it("authoritative stored wallet must still be linked to Privy", () => {
    const result = evaluateDeskAccess({
      identity: identity([WALLET_B], [EMAIL_A]),
      profile: profile(WALLET_A),
      walletAllowlist: deskAllowlist,
      emailAllowlist: parseDeskEmailAllowlist(EMAIL_A),
    });
    assert.deepEqual(result, {
      ok: false,
      reason: "wallet_not_owned",
      status: 403,
    });
  });

  it("multiple linked wallets do not override the stored authoritative wallet", () => {
    const result = evaluateDeskAccess({
      identity: identity([WALLET_A, WALLET_C]),
      profile: profile(WALLET_C),
      walletAllowlist: deskAllowlist,
      emailAllowlist: [],
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "desk_not_allowed");
  });

  it("missing env / empty allowlists fails closed", () => {
    const result = evaluateDeskAccess({
      identity: identity([WALLET_A], [EMAIL_A]),
      profile: profile(WALLET_A),
      walletAllowlist: parseDeskWalletAllowlist(""),
      emailAllowlist: parseDeskEmailAllowlist(""),
    });
    assert.deepEqual(result, {
      ok: false,
      reason: "desk_not_allowed",
      status: 403,
    });
  });

  it("does not accept a separate client-supplied wallet parameter", () => {
    const evaluateSource = readFileSync(join(here, "evaluate.ts"), "utf8");
    const authSource = readFileSync(join(here, "auth.ts"), "utf8");
    assert.doesNotMatch(evaluateSource, /body\.wallet|query\.wallet|searchParams/);
    assert.match(evaluateSource, /profile\.wallet_address/);
    assert.match(authSource, /Never trusts wallet\/email flags from the request body/);
  });
});

describe("Desk access isolation", () => {
  it("GREENWOOD_ACCESS_WALLETS alone does not grant Desk access", () => {
    const result = evaluateDeskAccess({
      identity: identity([WALLET_A]),
      profile: profile(WALLET_A),
      walletAllowlist: parseDeskWalletAllowlist(""),
      emailAllowlist: [],
    });
    assert.equal(result.ok, false);
  });

  it("FENN_ADMIN_WALLETS alone does not grant Desk access", () => {
    const result = evaluateDeskAccess({
      identity: identity([WALLET_A]),
      profile: profile(WALLET_A),
      walletAllowlist: [],
      emailAllowlist: [],
    });
    assert.equal(result.ok, false);

    const authSource = readFileSync(join(here, "auth.ts"), "utf8");
    assert.doesNotMatch(authSource, /serverEnv\.FENN_ADMIN_WALLETS/);
    assert.doesNotMatch(authSource, /serverEnv\.GREENWOOD_ACCESS_WALLETS/);
    assert.doesNotMatch(
      authSource,
      /parseAdminWalletAllowlist|isWalletInAdminAllowlist|parseGreenwoodAccessWallets/,
    );
    assert.match(authSource, /serverEnv\.FENN_DESK_WALLETS/);
    assert.match(authSource, /serverEnv\.FENN_DESK_EMAILS/);
    assert.match(authSource, /parseDeskWalletAllowlist/);
    assert.match(authSource, /parseDeskEmailAllowlist/);
  });

  it("requireFennAdmin remains a separate guard", () => {
    const adminAuth = readFileSync(
      join(repo, "src/lib/admin/auth.ts"),
      "utf8",
    );
    assert.match(adminAuth, /export async function requireFennAdmin/);
    assert.match(adminAuth, /FENN_ADMIN_WALLETS/);
    assert.doesNotMatch(adminAuth, /FENN_DESK_WALLETS|requireFennDeskAccess/);
  });
});

describe("Desk surface privacy and architecture", () => {
  it("quiet copy and no Connect / deny copy on gate", () => {
    const shell = readFileSync(
      join(repo, "src/components/desk/desk-gate.tsx"),
      "utf8",
    );
    assert.match(shell, /THE DESK/);
    assert.match(shell, /There is nothing here\./);
    assert.match(shell, /The world can be tended from here\./);
    assert.match(shell, /Keeper/);
    assert.doesNotMatch(shell, /Connect Wallet|Access denied|Administrator/i);
    assert.doesNotMatch(shell, /Wrong wallet|Allowlist|Permission/i);
    assert.doesNotMatch(shell, /walletAddress|FENN_DESK_WALLETS|FENN_DESK_EMAILS/);
  });

  it("session API uses requireFennDeskAccess and no-store", () => {
    const route = readFileSync(
      join(repo, "src/app/api/desk/session/route.ts"),
      "utf8",
    );
    assert.match(route, /requireFennDeskAccess/);
    assert.match(route, /private, no-store/);
    assert.match(route, /force-dynamic/);
    assert.doesNotMatch(route, /walletAddress|allowlist/);
    assert.doesNotMatch(route, /FENN_ADMIN_WALLETS/);
  });

  it("layout is dynamic, noindex, and documents API independence", () => {
    const layout = readFileSync(join(repo, "src/app/desk/layout.tsx"), "utf8");
    assert.match(layout, /force-dynamic/);
    assert.match(layout, /buildPrivateMetadata\("THE DESK"\)/);
    assert.match(layout, /independently/);
  });

  it("no public navigation or map link to /desk", () => {
    const map = readFileSync(
      join(repo, "src/content/home-world-map.ts"),
      "utf8",
    );
    const path = readFileSync(
      join(repo, "src/lib/home/fenn-map-path.ts"),
      "utf8",
    );
    assert.doesNotMatch(map, /\/desk/);
    assert.doesNotMatch(path, /\/desk/);
  });

  it("existing admin pages and oauth start remain unchanged entrypoints", () => {
    assert.match(
      readFileSync(join(repo, "src/app/admin/deeds/page.tsx"), "utf8"),
      /AdminDeedsBoard/,
    );
    assert.match(
      readFileSync(
        join(repo, "src/app/admin/greenwood/gatherings/page.tsx"),
        "utf8",
      ),
      /AdminGatheringsBoard/,
    );
    assert.match(
      readFileSync(
        join(repo, "src/app/admin/greenwood/rewards/page.tsx"),
        "utf8",
      ),
      /AdminRewardsBoard/,
    );
    assert.match(
      readFileSync(
        join(repo, "src/app/api/admin/x/oauth/start/route.ts"),
        "utf8",
      ),
      /requireFennAdmin/,
    );
  });

  it("admin allowlist still uses shared strict parser with admin label", () => {
    const adminConfig = readFileSync(
      join(repo, "src/lib/admin/config.ts"),
      "utf8",
    );
    assert.match(adminConfig, /parseSolanaWalletAllowlist/);
    assert.match(adminConfig, /FENN_ADMIN_WALLETS/);
    const greenwood = readFileSync(
      join(repo, "src/lib/greenwood/access-wallets.ts"),
      "utf8",
    );
    assert.doesNotMatch(greenwood, /parseSolanaWalletAllowlist/);
    assert.match(greenwood, /ignores empty\/malformed|Malformed entries ignored/i);
  });

  it("verified Privy identity includes emails for Desk email gate", () => {
    const privy = readFileSync(
      join(repo, "src/lib/auth/get-verified-privy-user.ts"),
      "utf8",
    );
    assert.match(privy, /emails: string\[\]/);
    assert.match(privy, /extractVerifiedEmails/);
    assert.match(privy, /account\.type !== "email"/);
  });
});

describe("desk email allowlist config", () => {
  it("parses and matches emails", () => {
    assert.deepEqual(parseDeskEmailAllowlist(""), []);
    assert.deepEqual(parseDeskEmailAllowlist(`${EMAIL_A}, ${EMAIL_B}`), [
      EMAIL_A,
      EMAIL_B,
    ]);
    assert.deepEqual(parseDeskEmailAllowlist(` ${EMAIL_A.toUpperCase()} ,${EMAIL_A}`), [
      EMAIL_A,
    ]);
    assert.equal(isEmailInDeskAllowlist("Keeper@AskVell.com", [EMAIL_A]), true);
    assert.equal(isEmailInDeskAllowlist(EMAIL_B, [EMAIL_A]), false);
    assert.throws(
      () => parseDeskEmailAllowlist("not-an-email"),
      /Invalid email in FENN_DESK_EMAILS/,
    );
  });
});
