import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  abbreviateSolanaAddress,
  isNormalizedSolanaAddress,
  normalizeSolanaAddress,
  parseSolanaAddress,
  solanaAddressesEqual,
} from "@/lib/wallet/solana";

const WALLET_A = "11111111111111111111111111111111";
const WALLET_B = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";

describe("Solana wallet addresses", () => {
  it("accepts typical base58 pubkeys", () => {
    assert.equal(isNormalizedSolanaAddress(WALLET_A), true);
    assert.equal(isNormalizedSolanaAddress(WALLET_B), true);
    assert.equal(parseSolanaAddress(`  ${WALLET_B}  `), WALLET_B);
  });

  it("rejects EVM and malformed values", () => {
    assert.equal(
      isNormalizedSolanaAddress(
        "0xabcdef0123456789abcdef0123456789abcdef01",
      ),
      false,
    );
    assert.equal(isNormalizedSolanaAddress("0xshort"), false);
    assert.equal(isNormalizedSolanaAddress("not-a-wallet"), false);
    assert.throws(() => parseSolanaAddress("bad"), /Invalid Solana wallet address/);
  });

  it("preserves case for equality and abbreviation", () => {
    const mixed = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
    assert.equal(normalizeSolanaAddress(` ${mixed} `), mixed);
    assert.equal(solanaAddressesEqual(mixed, mixed), true);
    assert.equal(solanaAddressesEqual(mixed, WALLET_A), false);
    assert.match(abbreviateSolanaAddress(mixed), /^9WzD\.\.\.AWWM$/);
  });
});
