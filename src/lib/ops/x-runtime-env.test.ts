import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  listMissingXAgentRuntimeEnv,
  validateXAgentRuntimeEnv,
  X_AGENT_RUNTIME_REQUIRED_ENV,
  XAgentRuntimeEnvError,
} from "@/lib/ops/x-runtime-env";

function fullEnv(
  overrides: Record<string, string | undefined> = {},
): NodeJS.ProcessEnv {
  const base: Record<string, string | undefined> = { NODE_ENV: "test" };
  for (const name of X_AGENT_RUNTIME_REQUIRED_ENV) {
    base[name] =
      name === "FENN_X_USER_ID" ? "1234567890" : `value-for-${name}`;
  }
  return { ...base, ...overrides } as NodeJS.ProcessEnv;
}

describe("x-runtime-env", () => {
  it("passes when all required vars are present", () => {
    assert.doesNotThrow(() => validateXAgentRuntimeEnv(fullEnv()));
    assert.deepEqual(listMissingXAgentRuntimeEnv(fullEnv()), []);
  });

  it("fails early with names only (no secret values)", () => {
    const env = fullEnv({
      OPENAI_API_KEY: undefined,
      X_BEARER_TOKEN: "   ",
      SUPABASE_SERVICE_ROLE_KEY: "super-secret-value",
    });
    assert.throws(
      () => validateXAgentRuntimeEnv(env),
      (error: unknown) => {
        assert.ok(error instanceof XAgentRuntimeEnvError);
        assert.deepEqual(error.missing.sort(), [
          "OPENAI_API_KEY",
          "X_BEARER_TOKEN",
        ]);
        assert.doesNotMatch(error.message, /super-secret-value/);
        assert.match(error.message, /OPENAI_API_KEY/);
        assert.match(error.message, /X_BEARER_TOKEN/);
        return true;
      },
    );
  });

  it("rejects non-digit FENN_X_USER_ID without echoing the value", () => {
    const env = fullEnv({ FENN_X_USER_ID: "not-a-snowflake" });
    assert.throws(
      () => validateXAgentRuntimeEnv(env),
      (error: unknown) => {
        assert.ok(error instanceof XAgentRuntimeEnvError);
        assert.doesNotMatch(error.message, /not-a-snowflake/);
        assert.match(error.message, /FENN_X_USER_ID/);
        return true;
      },
    );
  });
});
