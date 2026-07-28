import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  isWalletInGreenwoodAccessAllowlist,
  parseGreenwoodAccessWallets,
  profileHasGreenwoodAccessOverride,
} from "./access-wallets";

const here = dirname(fileURLToPath(import.meta.url));
const WALLET_A = "0xABCDEF0123456789ABCDEF0123456789ABCDEF01";
const WALLET_A_NORM = "0xabcdef0123456789abcdef0123456789abcdef01";
const WALLET_B = "0x0000000000000000000000000000000000000001";

const ORIGINAL_ENV = process.env.GREENWOOD_ACCESS_WALLETS;

afterEach(() => {
  if (ORIGINAL_ENV === undefined) {
    delete process.env.GREENWOOD_ACCESS_WALLETS;
  } else {
    process.env.GREENWOOD_ACCESS_WALLETS = ORIGINAL_ENV;
  }
});

describe("parseGreenwoodAccessWallets", () => {
  it("normalizes valid addresses and ignores empty/malformed entries", () => {
    const list = parseGreenwoodAccessWallets(
      `  ${WALLET_A}  , not-an-address, ,0xshort,${WALLET_B},`,
    );
    assert.deepEqual(list, [WALLET_A_NORM, WALLET_B]);
  });

  it("de-duplicates case-insensitively", () => {
    const list = parseGreenwoodAccessWallets(
      `${WALLET_A},${WALLET_A_NORM},${WALLET_A.toLowerCase()}`,
    );
    assert.deepEqual(list, [WALLET_A_NORM]);
  });

  it("returns empty for null/undefined/blank", () => {
    assert.deepEqual(parseGreenwoodAccessWallets(undefined), []);
    assert.deepEqual(parseGreenwoodAccessWallets(null), []);
    assert.deepEqual(parseGreenwoodAccessWallets(""), []);
    assert.deepEqual(parseGreenwoodAccessWallets("  , , "), []);
  });
});

describe("isWalletInGreenwoodAccessAllowlist", () => {
  it("matches case-insensitively", () => {
    const allowlist = parseGreenwoodAccessWallets(WALLET_A);
    assert.equal(isWalletInGreenwoodAccessAllowlist(WALLET_A, allowlist), true);
    assert.equal(
      isWalletInGreenwoodAccessAllowlist(WALLET_A_NORM, allowlist),
      true,
    );
    assert.equal(isWalletInGreenwoodAccessAllowlist(WALLET_B, allowlist), false);
  });
});

describe("profileHasGreenwoodAccessOverride", () => {
  it("reads env allowlist without inventing LEAF", () => {
    process.env.GREENWOOD_ACCESS_WALLETS = WALLET_A;
    assert.equal(profileHasGreenwoodAccessOverride(WALLET_A_NORM), true);
    assert.equal(profileHasGreenwoodAccessOverride(WALLET_B), false);
  });
});

describe("greenwood access override source safety", () => {
  it("module is server-only and never NEXT_PUBLIC", () => {
    const source = readFileSync(join(here, "access-wallets.ts"), "utf8");
    assert.match(source, /import "server-only"/);
    assert.doesNotMatch(source, /NEXT_PUBLIC_GREENWOOD/);
    assert.doesNotMatch(source, /awardLeaf|leaf_balance|leaf_ledger/);
  });

  it("status uses trusted profile wallet for override eligibility", () => {
    const status = readFileSync(join(here, "status.ts"), "utf8");
    assert.match(status, /profileHasGreenwoodAccessOverride\(row\.wallet_address\)/);
    assert.match(status, /wallet_address/);
    assert.doesNotMatch(status, /body\.wallet|request\.wallet|clientWallet/);
  });

  it("admission derives override from stored profile wallet and RPC flag", () => {
    const admission = readFileSync(join(here, "admission.ts"), "utf8");
    assert.match(admission, /select\("wallet_address"\)/);
    assert.match(admission, /profileHasGreenwoodAccessOverride/);
    assert.match(admission, /p_access_override:\s*accessOverride/);
    assert.doesNotMatch(admission, /body\.wallet|p_wallet/);
    assert.doesNotMatch(admission, /awardLeaf|leaf_balance/);
  });

  it("enter route still rejects client body authority", () => {
    const enter = readFileSync(
      join(here, "../../app/api/greenwood/enter/route.ts"),
      "utf8",
    );
    assert.match(enter, /Request body must be empty/);
    assert.doesNotMatch(enter, /body\.walletAddress|body\.wallet/);
    assert.match(enter, /admitProfileToGreenwood\(profile\.id/);
  });

  it("env example and server env keep variable server-only", () => {
    const example = readFileSync(join(here, "../../../.env.example"), "utf8");
    assert.match(example, /GREENWOOD_ACCESS_WALLETS=/);
    assert.match(example, /never NEXT_PUBLIC/);
    assert.doesNotMatch(example, /NEXT_PUBLIC_GREENWOOD_ACCESS_WALLETS/);

    const serverEnv = readFileSync(join(here, "../env/server.ts"), "utf8");
    assert.match(serverEnv, /GREENWOOD_ACCESS_WALLETS/);
    assert.match(serverEnv, /import "server-only"/);

    const publicEnv = readFileSync(join(here, "../env/public.ts"), "utf8");
    assert.doesNotMatch(publicEnv, /GREENWOOD_ACCESS_WALLETS/);
  });

  it("UI does not advertise admin bypass", () => {
    const gate = readFileSync(
      join(here, "../../components/greenwood/greenwood-gate.tsx"),
      "utf8",
    );
    const member = readFileSync(
      join(here, "../../components/greenwood/greenwood-member.tsx"),
      "utf8",
    );
    assert.doesNotMatch(gate, /admin bypass|access override|founder wallet/i);
    assert.doesNotMatch(member, /admin bypass|access override|founder wallet/i);
  });
});
