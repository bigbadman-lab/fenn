import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isWalletInAdminAllowlist,
  parseAdminWalletAllowlist,
} from "@/lib/admin/config";

const WALLET_A = "11111111111111111111111111111111";
const WALLET_B = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";

describe("admin allowlist config", () => {
  it("allowlist parsing preserves valid Solana addresses", () => {
    const list = parseAdminWalletAllowlist(`${WALLET_A},${WALLET_B}`);
    assert.deepEqual(list, [WALLET_A, WALLET_B]);
  });

  it("whitespace/empty comma items handled", () => {
    const list = parseAdminWalletAllowlist(
      `  ${WALLET_A}  ,  , ,${WALLET_B},`,
    );
    assert.equal(list.length, 2);
    assert.equal(list[0], WALLET_A);
  });

  it("invalid configured address rejected", () => {
    assert.throws(
      () => parseAdminWalletAllowlist("not-an-address"),
      /Invalid address in FENN_ADMIN_WALLETS/,
    );
    assert.throws(
      () =>
        parseAdminWalletAllowlist(
          `${WALLET_A},0xabcdef0123456789abcdef0123456789abcdef01`,
        ),
      /Invalid address in FENN_ADMIN_WALLETS/,
    );
  });

  it("address comparison is exact and case-sensitive", () => {
    const allowlist = parseAdminWalletAllowlist(WALLET_B);
    assert.equal(isWalletInAdminAllowlist(WALLET_B, allowlist), true);
    assert.equal(
      isWalletInAdminAllowlist(WALLET_B.toLowerCase(), allowlist),
      false,
    );
    assert.equal(isWalletInAdminAllowlist(WALLET_A, allowlist), false);
  });

  it("null/undefined/empty allowlist is empty", () => {
    assert.deepEqual(parseAdminWalletAllowlist(undefined), []);
    assert.deepEqual(parseAdminWalletAllowlist(null), []);
    assert.deepEqual(parseAdminWalletAllowlist(""), []);
    assert.deepEqual(parseAdminWalletAllowlist("  , , "), []);
  });
});
