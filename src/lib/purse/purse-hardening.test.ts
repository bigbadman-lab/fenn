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
  it("does not put economic effects in speech action enum", () => {
    const authority = read("src/lib/agent/authority-config.ts");
    assert.match(authority, /transfer_fenn/);
    // Live type list may include transfer_fenn for execution schema, but planning does not.
    const policy = read("src/lib/agent/authority-policy.ts");
    assert.match(policy, /planEconomicEffects/);

    const actions = read("src/lib/agent/actions.ts");
    assert.doesNotMatch(actions, /transfer_fenn|burn_fenn/);

    const execute = read("src/lib/agent/stage126-execute.ts");
    assert.match(execute, /transfer_fenn/);
    assert.match(execute, /executeTransferFennViaPurse/);
    assert.doesNotMatch(execute, /writeContract|privateKeyToAccount|FENN_PURSE_PRIVATE_KEY/);
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

  it("test-mode migration excludes is_test from public RLS", () => {
    const sql = read("supabase/migrations/20260809120000_54_purse_p0_test_mode.sql");
    assert.match(sql, /is_test boolean NOT NULL DEFAULT false/);
    assert.match(sql, /status = 'confirmed' AND is_test = false/);
    assert.doesNotMatch(sql, /private_key|mnemonic/i);
  });

  it("public listConfirmed filters is_test = false in application layer", () => {
    const query = read("src/lib/purse/transfers-query.ts");
    assert.match(query, /\.eq\("is_test", false\)/);
    assert.match(query, /\.eq\("status", "confirmed"\)/);
    assert.match(query, /action_type/);
  });

  it("operator CLIs exist and are not a public API route", () => {
    const script = read("scripts/purse-transfer-one.ts");
    assert.match(script, /executeManualOneFennTransfer/);
    assert.match(script, /buildManualTransferPreview/);
    assert.doesNotMatch(script, /FENN_PURSE_PRIVATE_KEY/);
    assert.doesNotMatch(script, /executeManualTestTransfer|FENN_PURSE_TEST_/);

    const testScript = read("scripts/purse-transfer-one-test.ts");
    assert.match(testScript, /executeManualTestTransfer/);
    assert.match(testScript, /buildManualTestTransferPreview/);
    assert.match(testScript, /NOT OFFICIAL FENN/);
    assert.doesNotMatch(testScript, /FENN_PURSE_PRIVATE_KEY/);

    // No public Next route for transfer
    assert.throws(() => read("src/app/api/purse/transfer/route.ts"));
  });

  it("Purse movements use canonical Robinhood Blockscout explorer helper", () => {
    const query = read("src/lib/purse/transfers-query.ts");
    assert.match(query, /explorerTxUrl/);
    assert.match(query, /@\/lib\/greenwood\/hollow\/explorer/);
    assert.doesNotMatch(query, /explorer\.robinhood\.com|blockscout/);

    const readout = read("src/components/commons/purse-readout.tsx");
    assert.match(readout, /explorerTxUrl/);
    assert.match(readout, /view on Robinhood Chain/);

    const explorer = read("src/lib/greenwood/hollow/explorer.ts");
    assert.match(
      explorer,
      /ROBINHOOD_CHAIN_EXPLORER_BASE\s*=\s*"https:\/\/robinhoodchain\.blockscout\.com"/,
    );
    assert.doesNotMatch(explorer, /explorer\.robinhood\.com/);
  });

  it("normal transfer path ignores FENN_PURSE_TEST_MODE envs", () => {
    const transfer = read("src/lib/purse/transfer.ts");
    // Official execute path must not call resolveArmedPurseTestToken
    assert.match(transfer, /export async function executeManualOneFennTransfer/);
    assert.match(transfer, /export async function executeManualTestTransfer/);
    assert.match(transfer, /assertOfficialFennTokenOnly/);
    // Official path never imports resolve inside OneFenn body via wrong call
    const oneFennSlice = transfer.slice(
      transfer.indexOf("export async function executeManualOneFennTransfer"),
      transfer.indexOf("export async function executeManualTestTransfer"),
    );
    assert.doesNotMatch(oneFennSlice, /resolveArmedPurseTestToken/);
    assert.doesNotMatch(oneFennSlice, /FENN_PURSE_TEST_/);
  });

  it("Commons purse UI never labels disposable test as FENN movements", () => {
    const readout = read("src/components/commons/purse-readout.tsx");
    assert.match(readout, /THE PURSE OF FENN/);
    assert.doesNotMatch(readout, /is_test|TEST token|disposable/i);
  });

  it("env example documents FENN_PURSE_PRIVATE_KEY without a sample key", () => {
    const env = read(".env.example");
    assert.match(env, /FENN_PURSE_PRIVATE_KEY=/);
    assert.match(env, /purse_config/);
    assert.match(env, /FENN_PURSE_TEST_MODE/);
    assert.match(env, /explicit_allow/);
    assert.doesNotMatch(env, /0x[a-fA-F0-9]{64}/);
  });
});
