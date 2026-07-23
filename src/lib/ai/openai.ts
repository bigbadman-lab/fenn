import "server-only";

import OpenAI from "openai";

let client: OpenAI | null = null;
/** `undefined` = use env; `null` = force missing (tests). */
let testApiKeyOverride: string | null | undefined = undefined;

function resolveApiKey(): string | undefined {
  if (testApiKeyOverride !== undefined) {
    return testApiKeyOverride ?? undefined;
  }
  // Lazy: Camp unit tests with injected model callers never load server env.
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- sync lazy load
  const { serverEnv } = require("@/lib/env/server") as typeof import("@/lib/env/server");
  return serverEnv.OPENAI_API_KEY;
}

/**
 * Lazy OpenAI client for Camp (and later AI surfaces).
 * App boot does not require OPENAI_API_KEY; Camp turns fail closed without it.
 */
export function getOpenAIClient(): OpenAI {
  const apiKey = resolveApiKey();
  if (!apiKey) {
    throw new OpenAIUnavailableError();
  }
  if (!client) {
    client = new OpenAI({ apiKey });
  }
  return client;
}

/** Test helper — not for production routes. */
export function resetOpenAIClientForTests(): void {
  client = null;
  testApiKeyOverride = undefined;
}

/** Test helper — force missing/present key without reloading serverEnv. */
export function setOpenAIApiKeyForTests(key: string | null): void {
  testApiKeyOverride = key;
  client = null;
}

export class OpenAIUnavailableError extends Error {
  constructor(message = "OpenAI is not configured") {
    super(message);
    this.name = "OpenAIUnavailableError";
  }
}
