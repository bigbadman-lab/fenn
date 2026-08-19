/**
 * Stage 12.6 X write auth — OAuth 2.0 Authorization Code + PKCE.
 * READ PUBLIC MENTIONS → app-only X_BEARER_TOKEN
 * WRITE AS @askfenn → user-context OAuth (implemented in Stage 12.6)
 */
export const X_WRITE_AUTH_CONTRACT = {
  flow: "oauth2_authorization_code_pkce",
  scopes: ["tweet.read", "tweet.write", "users.read", "offline.access"] as const,
  productionCallbackUrl: "https://askvell.com/api/auth/x/callback",
  /** Compatibility / fallback Admin start — FENN_ADMIN_WALLETS. */
  oauthStartPath: "/api/admin/x/oauth/start",
  /** Primary Desk start — FENN_DESK_WALLETS. Same PKCE helpers + callback. */
  deskOauthStartPath: "/api/desk/agent/oauth/start",
  readAuth: "app_only_bearer",
  writeAuth: "user_context_oauth",
} as const;
