/**
 * P2A — purse env load path (Render process.env + local load-env).
 * Never logs secret values — presence / names only.
 */

import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { loadLocalEnvIfPresent } from "@/lib/ops/load-local-env";
import {
  PURSE_EXECUTOR_RUNTIME_REQUIRED_ENV,
  listMissingPurseExecutorRuntimeEnv,
  purseExecutorEnvPresence,
  validatePurseExecutorRuntimeEnv,
  PurseExecutorRuntimeEnvError,
} from "@/lib/ops/purse-executor-env";

const RENDER_LIKE: NodeJS.ProcessEnv = {
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-test-value",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-test-value",
  ROBINHOOD_CHAIN_RPC_URL: "https://rpc.example",
  FENN_PURSE_PRIVATE_KEY: "0x" + "ab".repeat(32),
};

function fullPresence(env: NodeJS.ProcessEnv) {
  return purseExecutorEnvPresence(env);
}

describe("P2A Render purse env path", () => {
  it("1. Render-like populated env passes validator", () => {
    assert.doesNotThrow(() => validatePurseExecutorRuntimeEnv(RENDER_LIKE));
    assert.deepEqual(listMissingPurseExecutorRuntimeEnv(RENDER_LIKE), []);
  });

  it("2. all five variables survive load-env path (process wins)", () => {
    const dir = mkdtempSync(join(tmpdir(), "fenn-purse-env-"));
    try {
      // File tries to clobber with blanks / different values
      writeFileSync(
        join(dir, ".env.local"),
        [
          "NEXT_PUBLIC_SUPABASE_URL=",
          "NEXT_PUBLIC_SUPABASE_ANON_KEY=from-file",
          "SUPABASE_SERVICE_ROLE_KEY=",
          "ROBINHOOD_CHAIN_RPC_URL=https://file-should-not-win",
          "FENN_PURSE_PRIVATE_KEY=",
          "ONLY_FROM_FILE=local-only",
        ].join("\n"),
        "utf8",
      );

      const env: NodeJS.ProcessEnv = { ...RENDER_LIKE };
      const result = loadLocalEnvIfPresent({ cwd: dir, env });
      assert.equal(result.loaded, true);

      // Process values preserved even when file has blanks/different values
      assert.equal(env.NEXT_PUBLIC_SUPABASE_URL, RENDER_LIKE.NEXT_PUBLIC_SUPABASE_URL);
      assert.equal(
        env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        RENDER_LIKE.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      );
      assert.equal(
        env.SUPABASE_SERVICE_ROLE_KEY,
        RENDER_LIKE.SUPABASE_SERVICE_ROLE_KEY,
      );
      assert.equal(
        env.ROBINHOOD_CHAIN_RPC_URL,
        RENDER_LIKE.ROBINHOOD_CHAIN_RPC_URL,
      );
      assert.equal(env.FENN_PURSE_PRIVATE_KEY, RENDER_LIKE.FENN_PURSE_PRIVATE_KEY);
      // New key only from file
      assert.equal(env.ONLY_FROM_FILE, "local-only");

      assert.doesNotThrow(() => validatePurseExecutorRuntimeEnv(env));
      const presence = fullPresence(env);
      for (const name of PURSE_EXECUTOR_RUNTIME_REQUIRED_ENV) {
        assert.equal(presence[name], true, `${name} must remain present`);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("3. missing one reports exactly that variable", () => {
    const env: NodeJS.ProcessEnv = { ...RENDER_LIKE };
    delete env.FENN_PURSE_PRIVATE_KEY;
    const missing = listMissingPurseExecutorRuntimeEnv(env);
    assert.deepEqual(missing, ["FENN_PURSE_PRIVATE_KEY"]);
    assert.throws(
      () => validatePurseExecutorRuntimeEnv(env),
      (error: unknown) => {
        assert.ok(error instanceof PurseExecutorRuntimeEnvError);
        assert.deepEqual(error.missing, ["FENN_PURSE_PRIVATE_KEY"]);
        // Names only — never secret payload
        assert.doesNotMatch(error.message, /0xab|service-role|anon-test/i);
        return true;
      },
    );
  });

  it("4. local env loading still fills missing keys", () => {
    const dir = mkdtempSync(join(tmpdir(), "fenn-purse-local-"));
    try {
      writeFileSync(
        join(dir, ".env.local"),
        [
          `NEXT_PUBLIC_SUPABASE_URL=${RENDER_LIKE.NEXT_PUBLIC_SUPABASE_URL}`,
          `NEXT_PUBLIC_SUPABASE_ANON_KEY=${RENDER_LIKE.NEXT_PUBLIC_SUPABASE_ANON_KEY}`,
          `SUPABASE_SERVICE_ROLE_KEY=${RENDER_LIKE.SUPABASE_SERVICE_ROLE_KEY}`,
          `ROBINHOOD_CHAIN_RPC_URL=${RENDER_LIKE.ROBINHOOD_CHAIN_RPC_URL}`,
          `FENN_PURSE_PRIVATE_KEY=${RENDER_LIKE.FENN_PURSE_PRIVATE_KEY}`,
        ].join("\n"),
        "utf8",
      );
      const env: NodeJS.ProcessEnv = { NODE_ENV: "test" };
      const result = loadLocalEnvIfPresent({ cwd: dir, env });
      assert.equal(result.loaded, true);
      assert.equal(result.keysSet, 5);
      assert.doesNotThrow(() => validatePurseExecutorRuntimeEnv(env));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("4b. blank process values may be filled by file (empty is not valid)", () => {
    const dir = mkdtempSync(join(tmpdir(), "fenn-purse-blank-"));
    try {
      writeFileSync(
        join(dir, ".env.local"),
        "ROBINHOOD_CHAIN_RPC_URL=https://from-file-rpc\n",
        "utf8",
      );
      const env: NodeJS.ProcessEnv = {
        ...RENDER_LIKE,
        ROBINHOOD_CHAIN_RPC_URL: "   ",
      };
      loadLocalEnvIfPresent({ cwd: dir, env });
      assert.equal(env.ROBINHOOD_CHAIN_RPC_URL, "https://from-file-rpc");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("4c. absent .env.local is no-op (Render)", () => {
    const dir = mkdtempSync(join(tmpdir(), "fenn-purse-none-"));
    try {
      const env: NodeJS.ProcessEnv = { ...RENDER_LIKE };
      const result = loadLocalEnvIfPresent({ cwd: dir, env });
      assert.equal(result.loaded, false);
      assert.equal(result.keysSet, 0);
      assert.doesNotThrow(() => validatePurseExecutorRuntimeEnv(env));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("5. no secret values logged in env modules / settle entry", () => {
    const envSrc = readFileSync(
      join(process.cwd(), "src/lib/ops/purse-executor-env.ts"),
      "utf8",
    );
    const loadSrc = readFileSync(
      join(process.cwd(), "src/lib/ops/load-local-env.ts"),
      "utf8",
    );
    const settleSrc = readFileSync(
      join(process.cwd(), "scripts/purse-settle.ts"),
      "utf8",
    );
    for (const src of [envSrc, loadSrc, settleSrc]) {
      assert.doesNotMatch(src, /console\.log\([^)]*process\.env/);
      assert.doesNotMatch(src, /console\.log\([^)]*SERVICE_ROLE/);
      assert.doesNotMatch(src, /console\.log\([^)]*PRIVATE_KEY/);
    }
    assert.match(settleSrc, /validatePurseExecutorRuntimeEnv\(process\.env\)/);
    assert.match(settleSrc, /loadLocalEnvIfPresent/);
  });

  it("createAdminClient does not require Privy / site URL", () => {
    const admin = readFileSync(
      join(process.cwd(), "src/lib/supabase/admin.ts"),
      "utf8",
    );
    assert.doesNotMatch(admin, /from\s+[\"']@\/lib\/env\/public[\"']/);
    assert.doesNotMatch(admin, /from\s+[\"']@\/lib\/env\/server[\"']/);
    assert.doesNotMatch(admin, /\bpublicEnv\./);
    assert.doesNotMatch(admin, /\bserverEnv\./);
    assert.match(admin, /NEXT_PUBLIC_SUPABASE_URL/);
    assert.match(admin, /SUPABASE_SERVICE_ROLE_KEY/);
    assert.doesNotMatch(admin, /PRIVY_APP_SECRET|NEXT_PUBLIC_SITE_URL/);
  });

  it("7. X agent env behaviour unchanged (still requires full X set)", async () => {
    const { X_AGENT_RUNTIME_REQUIRED_ENV, validateXAgentRuntimeEnv } =
      await import("@/lib/ops/x-runtime-env");
    assert.ok(X_AGENT_RUNTIME_REQUIRED_ENV.includes("NEXT_PUBLIC_SITE_URL"));
    assert.ok(X_AGENT_RUNTIME_REQUIRED_ENV.includes("PRIVY_APP_SECRET"));
    assert.ok(
      !(X_AGENT_RUNTIME_REQUIRED_ENV as readonly string[]).includes(
        "FENN_PURSE_PRIVATE_KEY",
      ),
    );
    assert.throws(() =>
      validateXAgentRuntimeEnv({
        ...RENDER_LIKE,
        // incomplete for X
      } as NodeJS.ProcessEnv),
    );
  });
});
