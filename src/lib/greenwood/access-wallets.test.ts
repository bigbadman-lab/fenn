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
const WALLET_A = "11111111111111111111111111111111";
const WALLET_B = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";

const ORIGINAL_ENV = process.env.GREENWOOD_ACCESS_WALLETS;

afterEach(() => {
  if (ORIGINAL_ENV === undefined) {
    delete process.env.GREENWOOD_ACCESS_WALLETS;
  } else {
    process.env.GREENWOOD_ACCESS_WALLETS = ORIGINAL_ENV;
  }
});

describe("parseGreenwoodAccessWallets", () => {
  it("preserves valid addresses and ignores empty/malformed entries", () => {
    const list = parseGreenwoodAccessWallets(
      `  ${WALLET_A}  , not-an-address, ,0xshort,${WALLET_B},`,
    );
    assert.deepEqual(list, [WALLET_A, WALLET_B]);
  });

  it("de-duplicates exact matches", () => {
    const list = parseGreenwoodAccessWallets(`${WALLET_A},${WALLET_A},${WALLET_A}`);
    assert.deepEqual(list, [WALLET_A]);
  });

  it("membership is exact — case-sensitive", () => {
    const allowlist = parseGreenwoodAccessWallets(WALLET_B);
    assert.equal(isWalletInGreenwoodAccessAllowlist(WALLET_B, allowlist), true);
    assert.equal(
      isWalletInGreenwoodAccessAllowlist(WALLET_B.toLowerCase(), allowlist),
      false,
    );
  });
});

describe("profileHasGreenwoodAccessOverride", () => {
  it("reads env at call time", () => {
    process.env.GREENWOOD_ACCESS_WALLETS = WALLET_A;
    assert.equal(profileHasGreenwoodAccessOverride(WALLET_A), true);
    assert.equal(profileHasGreenwoodAccessOverride(WALLET_B), false);
  });
});

describe("Greenwood access wallet source", () => {
  it("uses Solana validation for profile override allowlist", () => {
    const source = readFileSync(join(here, "access-wallets.ts"), "utf8");
    assert.match(source, /is_normalized_solana_address|isNormalizedSolanaAddress/);
    assert.match(source, /Solana addresses/);
  });
});
