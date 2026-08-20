import "server-only";

import OpenAI from "openai";

let client: OpenAI | null = null;
/** `undefined` = use env; `null` = force missing (tests). */
let testApiKeyOverride: string | null | undefined = undefined;

/**
 * Read OPENAI_API_KEY from process.env only.
 * Do not load full serverEnv — wallet allowlists / Privy / etc. must not block
 * Living Book, Camp, or other AI surfaces when those unrelated vars are stale.
 */
function resolveApiKey(): string | undefined {
  if (testApiKeyOverride !== undefined) {
    return testApiKeyOverride ?? undefined;
  }
  const raw = process.env.OPENAI_API_KEY;
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
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
