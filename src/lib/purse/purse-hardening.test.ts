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

describe("Purse P0 architecture hardening", () => {
  it("does not extend X perception effects with transfer_fenn", () => {
    const authority = read("src/lib/agent/authority-config.ts");
    assert.match(authority, /STAGE125_EFFECT_TYPES = \["reply_on_x", "write_to_wall"\]/);
    assert.doesNotMatch(authority, /transfer_fenn/);

    const execute = read("src/lib/agent/stage126-execute.ts");
    assert.doesNotMatch(execute, /transfer_fenn|purse|writeContract/);
  });

  it("public Commons readers never touch private keys or wallet clients", () => {
    for (const file of [
      "src/lib/purse/snapshot.ts",
      "src/lib/purse/transfers-query.ts",
      "src/lib/purse/config.ts",
      "src/lib/commons/page-data.ts",
      "src/components/commons/purse-readout.tsx",
    ]) {
      const source = read(file);
      assert.doesNotMatch(
        source,
        /FENN_PURSE_PRIVATE_KEY|privateKeyToAccount|createWalletClient|writeContract/i,
      );
    }
  });

  it("wallet signing is confined to purse/wallet.ts", () => {
    const wallet = read("src/lib/purse/wallet.ts");
    assert.match(wallet, /server-only/);
    assert.match(wallet, /createWalletClient/);
    assert.match(wallet, /ERC20_TRANSFER_ABI/);
    assert.match(wallet, /functionName: "transfer"/);
    // Never log secret material.
    assert.doesNotMatch(wallet, /console\.(log|info|debug)\(/);
  });

  it("migration enforces public confirmed-only select and no client writes", () => {
    const sql = read("supabase/migrations/20260808120000_53_purse_p0.sql");
    assert.match(sql, /CREATE TABLE public\.purse_config/);
    assert.match(sql, /CREATE TABLE public\.purse_transfers/);
    assert.match(sql, /purse_transfers_operation_id_uidx/);
    assert.match(sql, /purse_transfers_tx_hash_uidx/);
    assert.match(sql, /status = 'confirmed'/);
    assert.match(sql, /REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public\.purse_config/);
    assert.match(sql, /REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public\.purse_transfers/);
    assert.match(sql, /try_acquire_purse_transfer_lock/);
    assert.doesNotMatch(sql, /private_key|mnemonic/i);
  });

  it("operator CLI exists and is not a public API route", () => {
    const script = read("scripts/purse-transfer-one.ts");
    assert.match(script, /executeManualOneFennTransfer/);
    assert.match(script, /buildManualTransferPreview/);
    assert.doesNotMatch(script, /FENN_PURSE_PRIVATE_KEY/);
    // No public Next route for transfer
    assert.throws(() => read("src/app/api/purse/transfer/route.ts"));
  });

  it("env example documents FENN_PURSE_PRIVATE_KEY without a sample key", () => {
    const env = read(".env.example");
    assert.match(env, /FENN_PURSE_PRIVATE_KEY=/);
    assert.match(env, /purse_config/);
    assert.doesNotMatch(env, /0x[a-fA-F0-9]{64}/);
  });
});
