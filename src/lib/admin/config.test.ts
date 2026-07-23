import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isWalletInAdminAllowlist,
  parseAdminWalletAllowlist,
} from "@/lib/admin/config";

describe("admin allowlist config", () => {
  it("allowlist parsing normalizes valid addresses", () => {
    const list = parseAdminWalletAllowlist(
      "0xABCDEF0123456789ABCDEF0123456789ABCDEF01,0x0000000000000000000000000000000000000001",
    );
    assert.deepEqual(list, [
      "0xabcdef0123456789abcdef0123456789abcdef01",
      "0x0000000000000000000000000000000000000001",
    ]);
  });

  it("whitespace/empty comma items handled", () => {
    const list = parseAdminWalletAllowlist(
      "  0xABCDEF0123456789ABCDEF0123456789ABCDEF01  ,  , ,0x0000000000000000000000000000000000000001,",
    );
    assert.equal(list.length, 2);
    assert.equal(
      list[0],
      "0xabcdef0123456789abcdef0123456789abcdef01",
    );
  });

  it("invalid configured address rejected", () => {
    assert.throws(
      () => parseAdminWalletAllowlist("not-an-address"),
      /Invalid address in FENN_ADMIN_WALLETS/,
    );
    assert.throws(
      () =>
        parseAdminWalletAllowlist(
          "0xABCDEF0123456789ABCDEF0123456789ABCDEF01,0xshort",
        ),
      /Invalid address in FENN_ADMIN_WALLETS/,
    );
  });

  it("address comparison is case-insensitive through canonical normalization", () => {
    const allowlist = parseAdminWalletAllowlist(
      "0xAbCdEf0123456789aBcDeF0123456789AbCdEf01",
    );
    assert.equal(
      isWalletInAdminAllowlist(
        "0xABCDEF0123456789ABCDEF0123456789ABCDEF01",
        allowlist,
      ),
      true,
    );
    assert.equal(
      isWalletInAdminAllowlist(
        "0xabcdef0123456789abcdef0123456789abcdef01",
        allowlist,
      ),
      true,
    );
    assert.equal(
      isWalletInAdminAllowlist(
        "0x0000000000000000000000000000000000000001",
        allowlist,
      ),
      false,
    );
  });

  it("null/undefined/empty allowlist is empty", () => {
    assert.deepEqual(parseAdminWalletAllowlist(undefined), []);
    assert.deepEqual(parseAdminWalletAllowlist(null), []);
    assert.deepEqual(parseAdminWalletAllowlist(""), []);
    assert.deepEqual(parseAdminWalletAllowlist("  , , "), []);
  });
});
