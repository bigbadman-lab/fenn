/**
 * Future X write auth (Stage 12 speech+) — contract only.
 * Stage 12.2 does not post to X and does not implement OAuth.
 *
 * READ PUBLIC MENTIONS → app-only X_BEARER_TOKEN
 * WRITE AS @askfenn → OAuth 2.0 Authorization Code + PKCE
 */
export const X_WRITE_AUTH_CONTRACT = {
  flow: "oauth2_authorization_code_pkce",
  scopes: ["tweet.read", "tweet.write", "users.read", "offline.access"] as const,
  productionCallbackUrl: "https://imfenn.com/api/auth/x/callback",
  readAuth: "app_only_bearer",
  writeAuth: "user_context_oauth",
} as const;
