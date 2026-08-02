import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  isWalletInDeskAllowlist,
  parseDeskWalletAllowlist,
} from "@/lib/desk/config";

const here = dirname(fileURLToPath(import.meta.url));

const A = "0xABCDEF0123456789ABCDEF0123456789ABCDEF01";
const A_LOWER = "0xabcdef0123456789abcdef0123456789abcdef01";
const B = "0x0000000000000000000000000000000000000001";

describe("desk allowlist config", () => {
  it("empty FENN_DESK_WALLETS yields no authorised wallets", () => {
    assert.deepEqual(parseDeskWalletAllowlist(""), []);
    assert.deepEqual(parseDeskWalletAllowlist(undefined), []);
    assert.deepEqual(parseDeskWalletAllowlist(null), []);
  });

  it("parses one and multiple comma-separated wallets to lowercase", () => {
    assert.deepEqual(parseDeskWalletAllowlist(A), [A_LOWER]);
    assert.deepEqual(parseDeskWalletAllowlist(`${A}, ${B}`), [
      A_LOWER,
      B.toLowerCase(),
    ]);
  });

  it("duplicates collapse", () => {
    assert.deepEqual(parseDeskWalletAllowlist(`${A},${A_LOWER}`), [A_LOWER]);
  });

  it("malformed address fails closed", () => {
    assert.throws(
      () => parseDeskWalletAllowlist("0xdead"),
      /Invalid address in FENN_DESK_WALLETS/,
    );
  });

  it("substring does not match", () => {
    const list = parseDeskWalletAllowlist(A);
    assert.equal(isWalletInDeskAllowlist(A_LOWER.slice(2), list), false);
  });

  it("env example and server env keep Desk allowlist server-only", () => {
    const example = readFileSync(join(here, "../../../.env.example"), "utf8");
    assert.match(example, /FENN_DESK_WALLETS=/);
    assert.match(
      example,
      /Comma-separated EVM wallets authorised to access `\/desk`/,
    );
    assert.doesNotMatch(example, /NEXT_PUBLIC_FENN_DESK_WALLETS/);
    assert.doesNotMatch(
      example.split("FENN_DESK_WALLETS=")[1]?.split("\n\n")[0] ?? "",
      /Greenwood|CROSS|LEAF threshold/i,
    );

    const serverEnv = readFileSync(join(here, "../env/server.ts"), "utf8");
    assert.match(serverEnv, /FENN_DESK_WALLETS/);
    assert.match(serverEnv, /parseDeskWalletAllowlist/);
    assert.match(serverEnv, /import "server-only"/);

    const publicEnv = readFileSync(join(here, "../env/public.ts"), "utf8");
    assert.doesNotMatch(publicEnv, /FENN_DESK_WALLETS/);
  });
});
