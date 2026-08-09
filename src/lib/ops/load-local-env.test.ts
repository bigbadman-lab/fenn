import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  loadLocalEnvIfPresent,
  parseEnvLine,
} from "@/lib/ops/load-local-env";

describe("load-local-env", () => {
  it("parses keys, quotes, and skips comments", () => {
    assert.deepEqual(parseEnvLine("FOO=bar"), { key: "FOO", value: "bar" });
    assert.deepEqual(parseEnvLine('FOO="bar baz"'), {
      key: "FOO",
      value: "bar baz",
    });
    assert.equal(parseEnvLine("# comment"), null);
    assert.equal(parseEnvLine(""), null);
    assert.equal(parseEnvLine("=nope"), null);
  });

  it("loads .env.local without overwriting existing env", () => {
    const dir = mkdtempSync(join(tmpdir(), "fenn-env-"));
    try {
      writeFileSync(
        join(dir, ".env.local"),
        ["KEEP=from-file", "OVERRIDE=from-file", "# ignore", ""].join("\n"),
        "utf8",
      );
      const env = {
        OVERRIDE: "from-process",
        NODE_ENV: "test",
      } as NodeJS.ProcessEnv;
      const result = loadLocalEnvIfPresent({ cwd: dir, env });
      assert.equal(result.loaded, true);
      assert.equal(result.keysSet, 1);
      assert.equal(env.KEEP, "from-file");
      assert.equal(env.OVERRIDE, "from-process");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("never injects blank file values or overwrites non-blank process values", () => {
    const dir = mkdtempSync(join(tmpdir(), "fenn-env-blank-"));
    try {
      writeFileSync(
        join(dir, ".env.local"),
        ["KEEP=from-process-stay", "BLANK_ONLY=", "FILL_ME=from-file"].join(
          "\n",
        ),
        "utf8",
      );
      const env = {
        KEEP: "from-process-stay",
        BLANK_ONLY: undefined,
      } as NodeJS.ProcessEnv;
      const result = loadLocalEnvIfPresent({ cwd: dir, env });
      assert.equal(result.keysSet, 1);
      assert.equal(env.KEEP, "from-process-stay");
      assert.equal(env.BLANK_ONLY, undefined);
      assert.equal(env.FILL_ME, "from-file");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("no-ops when .env.local is absent", () => {
    const dir = mkdtempSync(join(tmpdir(), "fenn-env-missing-"));
    try {
      const env = { NODE_ENV: "test" } as NodeJS.ProcessEnv;
      const result = loadLocalEnvIfPresent({ cwd: dir, env });
      assert.equal(result.loaded, false);
      assert.equal(result.keysSet, 0);
      assert.equal(env.NODE_ENV, "test");
      assert.equal(Object.keys(env).filter((k) => k !== "NODE_ENV").length, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
