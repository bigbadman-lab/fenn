import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { parseDeskWalletAllowlist } from "@/lib/desk/config";
import {
  evaluateDeskAccess,
  type DeskEvalIdentity,
  type DeskEvalProfile,
} from "@/lib/desk/evaluate";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "../../..");

const WALLET_A = "0xabcdef0123456789abcdef0123456789abcdef01";
const WALLET_B = "0x0000000000000000000000000000000000000001";
const WALLET_C = "0x1111111111111111111111111111111111111111";

function identity(wallets: string[]): DeskEvalIdentity {
  return {
    wallets: wallets.map((address) => ({ address })),
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
      allowlist: deskAllowlist,
    });
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.walletAddress, WALLET_A);
  });

  it("unauthenticated user denied", () => {
    const result = evaluateDeskAccess({
      identity: null,
      profile: profile(WALLET_A),
      allowlist: deskAllowlist,
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
      allowlist: deskAllowlist,
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
      allowlist: deskAllowlist,
    });
    assert.deepEqual(result, {
      ok: false,
      reason: "desk_not_allowed",
      status: 403,
    });
  });

  it("authoritative stored wallet must still be linked to Privy", () => {
    const result = evaluateDeskAccess({
      identity: identity([WALLET_B]),
      profile: profile(WALLET_A),
      allowlist: deskAllowlist,
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
      allowlist: deskAllowlist,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "desk_not_allowed");
  });

  it("missing env / empty allowlist fails closed", () => {
    const result = evaluateDeskAccess({
      identity: identity([WALLET_A]),
      profile: profile(WALLET_A),
      allowlist: parseDeskWalletAllowlist(""),
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
    assert.match(authSource, /Never trusts wallet flags from the request body/);
  });
});

describe("Desk access isolation", () => {
  it("GREENWOOD_ACCESS_WALLETS alone does not grant Desk access", () => {
    const result = evaluateDeskAccess({
      identity: identity([WALLET_A]),
      profile: profile(WALLET_A),
      allowlist: parseDeskWalletAllowlist(""),
    });
    assert.equal(result.ok, false);
  });

  it("FENN_ADMIN_WALLETS alone does not grant Desk access", () => {
    const result = evaluateDeskAccess({
      identity: identity([WALLET_A]),
      profile: profile(WALLET_A),
      allowlist: [],
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
    assert.match(authSource, /parseDeskWalletAllowlist/);
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
    assert.doesNotMatch(shell, /walletAddress|FENN_DESK_WALLETS/);
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
    assert.match(adminConfig, /parseEvmWalletAllowlist/);
    assert.match(adminConfig, /FENN_ADMIN_WALLETS/);
    const greenwood = readFileSync(
      join(repo, "src/lib/greenwood/access-wallets.ts"),
      "utf8",
    );
    assert.doesNotMatch(greenwood, /parseEvmWalletAllowlist/);
    assert.match(greenwood, /ignores empty\/malformed|Malformed entries ignored/i);
  });
});
