import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isWalletInEvmAllowlist,
  isWalletInSolanaAllowlist,
  parseEvmWalletAllowlist,
  parseSolanaWalletAllowlist,
} from "@/lib/wallet/allowlist";

const A = "0xABCDEF0123456789ABCDEF0123456789ABCDEF01";
const A_LOWER = "0xabcdef0123456789abcdef0123456789abcdef01";
const B = "0x0000000000000000000000000000000000000001";

describe("parseEvmWalletAllowlist", () => {
  it("empty / null / undefined yields empty allowlist", () => {
    assert.deepEqual(parseEvmWalletAllowlist(undefined, "TEST"), []);
    assert.deepEqual(parseEvmWalletAllowlist(null, "TEST"), []);
    assert.deepEqual(parseEvmWalletAllowlist("", "TEST"), []);
    assert.deepEqual(parseEvmWalletAllowlist("  , , ", "TEST"), []);
  });

  it("parses one and multiple wallets, normalising to lowercase", () => {
    assert.deepEqual(parseEvmWalletAllowlist(A, "TEST"), [A_LOWER]);
    assert.deepEqual(parseEvmWalletAllowlist(`${A},${B}`, "TEST"), [
      A_LOWER,
      B.toLowerCase(),
    ]);
  });

  it("trims whitespace and collapses duplicates", () => {
    const list = parseEvmWalletAllowlist(
      `  ${A}  ,  , ${A_LOWER}, ${B},`,
      "TEST",
    );
    assert.deepEqual(list, [A_LOWER, B.toLowerCase()]);
  });

  it("malformed non-empty entries fail loudly with label", () => {
    assert.throws(
      () => parseEvmWalletAllowlist("not-an-address", "FENN_DESK_WALLETS"),
      /Invalid address in FENN_DESK_WALLETS/,
    );
    assert.throws(
      () => parseEvmWalletAllowlist(`${A},0xshort`, "FENN_ADMIN_WALLETS"),
      /Invalid address in FENN_ADMIN_WALLETS/,
    );
  });

  it("membership is exact after normalisation — no substring match", () => {
    const allowlist = parseEvmWalletAllowlist(A, "TEST");
    assert.equal(isWalletInEvmAllowlist(A, allowlist), true);
    assert.equal(isWalletInEvmAllowlist(A_LOWER, allowlist), true);
    assert.equal(isWalletInEvmAllowlist(B, allowlist), false);
    assert.equal(
      isWalletInEvmAllowlist(A_LOWER.slice(0, 20), allowlist),
      false,
    );
    assert.equal(
      isWalletInEvmAllowlist(`${A_LOWER}00`, allowlist),
      false,
    );
  });
});

describe("parseSolanaWalletAllowlist", () => {
  const A = "11111111111111111111111111111111";
  const B = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";

  it("parses Solana identity allowlists", () => {
    assert.deepEqual(parseSolanaWalletAllowlist(`${A},${B}`, "TEST"), [A, B]);
    const list = parseSolanaWalletAllowlist(A, "TEST");
    assert.equal(isWalletInSolanaAllowlist(A, list), true);
    assert.throws(
      () => parseSolanaWalletAllowlist("0xdeadbeef", "TEST"),
      /Invalid address in TEST/,
    );
  });
});
