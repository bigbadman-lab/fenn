/**
 * Stage 12.6 — trusted effect execution config.
 * 0 OpenAI. 0 RAG. 0 live reads. Executes only Stage 12.5 pending effects.
 */

export const STAGE126_EXECUTE_BATCH_DEFAULT = 1;
export const STAGE126_EXECUTE_BATCH_MAX = 5;

export const STAGE126_FAILURE_CLASSES = [
  "retryable",
  "terminal",
  "ambiguous",
] as const;

export type Stage126FailureClass = (typeof STAGE126_FAILURE_CLASSES)[number];

/** OAuth credential slot — single @askfenn binding for MVP. */
export const X_OAUTH_CREDENTIAL_SLOT = "askfenn" as const;

export const X_OAUTH_SCOPES = [
  "tweet.read",
  "tweet.write",
  "users.read",
  "offline.access",
] as const;

export const X_OAUTH_AUTHORIZE_URL = "https://twitter.com/i/oauth2/authorize";
export const X_OAUTH_TOKEN_URL = "https://api.x.com/2/oauth2/token";
export const X_OAUTH_USERS_ME_URL = "https://api.x.com/2/users/me";
export const X_OAUTH_TWEETS_URL = "https://api.x.com/2/tweets";

/** PKCE session TTL. */
export const X_OAUTH_PKCE_TTL_MS = 10 * 60 * 1000;
