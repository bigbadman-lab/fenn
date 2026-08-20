import "server-only";

import { z } from "zod";

import { parseAdminWalletAllowlist } from "@/lib/admin/config";
import {
  parseDeskEmailAllowlist,
  parseDeskWalletAllowlist,
} from "@/lib/desk/config";
import { getPublicEnv, type PublicEnv } from "@/lib/env/public";

/**
 * Server-only credentials.
 * This module must never be imported from Client Components.
 *
 * Values are read lazily so `next build` can collect route modules without
 * requiring secrets at import time. Secrets are still mandatory when code
 * first touches `serverEnv` at request time.
 */
const emptyToUndefined = (value: unknown) => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
};

const optionalSecret = z.preprocess(
  emptyToUndefined,
  z.string().min(1).optional(),
);

const requiredSecret = z.preprocess(
  emptyToUndefined,
  z.string().min(1, "required"),
);

/** Comma-separated Solana admin wallets. Empty/missing = no admins. Invalid entries fail loud. */
const fennAdminWallets = z.preprocess(
  (value) => (typeof value === "string" ? value : ""),
  z.string().superRefine((value, ctx) => {
    try {
      parseAdminWalletAllowlist(value);
    } catch (error) {
      ctx.addIssue({
        code: "custom",
        message:
          error instanceof Error
            ? error.message
            : "Invalid FENN_ADMIN_WALLETS",
      });
    }
  }),
);

/** Comma-separated Solana Desk wallets. Empty/missing = no wallet-based Desk access. Invalid entries fail loud. */
const fennDeskWallets = z.preprocess(
  (value) => (typeof value === "string" ? value : ""),
  z.string().superRefine((value, ctx) => {
    try {
      parseDeskWalletAllowlist(value);
    } catch (error) {
      ctx.addIssue({
        code: "custom",
        message:
          error instanceof Error
            ? error.message
            : "Invalid FENN_DESK_WALLETS",
      });
    }
  }),
);

/** Comma-separated Desk keeper emails. Empty/missing = no email-based Desk access. Invalid entries fail loud. */
const fennDeskEmails = z.preprocess(
  (value) => (typeof value === "string" ? value : ""),
  z.string().superRefine((value, ctx) => {
    try {
      parseDeskEmailAllowlist(value);
    } catch (error) {
      ctx.addIssue({
        code: "custom",
        message:
          error instanceof Error ? error.message : "Invalid FENN_DESK_EMAILS",
      });
    }
  }),
);

const serverOnlySchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: requiredSecret,
  PRIVY_APP_SECRET: requiredSecret,
  OPENAI_API_KEY: optionalSecret,
  /** Server-only Robinhood Chain JSON-RPC URL for Treasury balance reads (Stage 9+). */
  ROBINHOOD_CHAIN_RPC_URL: optionalSecret,
  /**
   * Bootstrap/ops aid for a Treasury wallet address.
   * Canonical configured wallet is treasury_config.treasury_wallet_address (DB).
   * This env value must not override a populated DB row.
   */
  FENN_TREASURY_ADDRESS: optionalSecret,
  /**
   * THE PURSE OF FENN — server-only private key for operator-manual ERC-20 transfer (P0).
   * Hex 32-byte key. Never NEXT_PUBLIC_*. Never store in Supabase.
   * Public Purse address lives in purse_config (DB). Key must match that address.
   * Missing is fine for website boot; transfer CLI fails closed without it.
   */
  FENN_PURSE_PRIVATE_KEY: optionalSecret,
  X_API_KEY: optionalSecret,
  X_API_SECRET: optionalSecret,
  X_BEARER_TOKEN: optionalSecret,
  X_OAUTH_CLIENT_ID: optionalSecret,
  X_OAUTH_CLIENT_SECRET: optionalSecret,
  /** Stable @askfenn X user id (digit string). Verified via npm run x:verify-account. */
  FENN_X_USER_ID: optionalSecret,
  /** X username without @. Defaults to askfenn when unset. */
  FENN_X_USERNAME: optionalSecret,
  FENN_ADMIN_WALLETS: fennAdminWallets,
  /**
   * Comma-separated Solana wallets authorised to access `/desk`.
   * Empty/missing = no wallet-based Desk access. Invalid entries fail loud at boot.
   * Never NEXT_PUBLIC_*. Independent of FENN_ADMIN_WALLETS.
   * Either this or FENN_DESK_EMAILS may grant Desk access.
   */
  FENN_DESK_WALLETS: fennDeskWallets,
  /**
   * Comma-separated emails authorised to access `/desk` (Privy email login).
   * Empty/missing = no email-based Desk access. Invalid entries fail loud at boot.
   * Never NEXT_PUBLIC_*. Independent of FENN_ADMIN_WALLETS / FENN_DESK_WALLETS.
   */
  FENN_DESK_EMAILS: fennDeskEmails,
  /**
   * Trusted Greenwood access override wallets (test/founder).
   * Comma-separated Solana addresses. Malformed entries ignored at use time.
   * Eligibility only — never awards LEAF. Never NEXT_PUBLIC_*.
   */
  GREENWOOD_ACCESS_WALLETS: z.preprocess(
    (value) => (typeof value === "string" ? value : ""),
    z.string(),
  ),
  /** Bearer secret for protected cron routes (Living Book daily writer). */
  CRON_SECRET: optionalSecret,
});

export type ServerOnlyEnv = z.infer<typeof serverOnlySchema>;

export type ServerEnv = PublicEnv & ServerOnlyEnv;

function readServerOnlyEnv(): ServerOnlyEnv {
  const parsed = serverOnlySchema.safeParse({
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    PRIVY_APP_SECRET: process.env.PRIVY_APP_SECRET,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    ROBINHOOD_CHAIN_RPC_URL: process.env.ROBINHOOD_CHAIN_RPC_URL,
    FENN_TREASURY_ADDRESS: process.env.FENN_TREASURY_ADDRESS,
    FENN_PURSE_PRIVATE_KEY: process.env.FENN_PURSE_PRIVATE_KEY,
    X_API_KEY: process.env.X_API_KEY,
    X_API_SECRET: process.env.X_API_SECRET,
    X_BEARER_TOKEN: process.env.X_BEARER_TOKEN,
    X_OAUTH_CLIENT_ID: process.env.X_OAUTH_CLIENT_ID,
    X_OAUTH_CLIENT_SECRET: process.env.X_OAUTH_CLIENT_SECRET,
    FENN_X_USER_ID: process.env.FENN_X_USER_ID,
    FENN_X_USERNAME: process.env.FENN_X_USERNAME,
    FENN_ADMIN_WALLETS: process.env.FENN_ADMIN_WALLETS,
    FENN_DESK_WALLETS: process.env.FENN_DESK_WALLETS,
    FENN_DESK_EMAILS: process.env.FENN_DESK_EMAILS,
    GREENWOOD_ACCESS_WALLETS: process.env.GREENWOOD_ACCESS_WALLETS,
    CRON_SECRET: process.env.CRON_SECRET,
  });

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "env"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid server environment configuration:\n${details}`);
  }

  return parsed.data;
}

let cachedServerEnv: ServerEnv | undefined;

/** Validate and return full server env (memoized). */
export function getServerEnv(): ServerEnv {
  if (!cachedServerEnv) {
    cachedServerEnv = {
      ...getPublicEnv(),
      ...readServerOnlyEnv(),
    };
  }
  return cachedServerEnv;
}

/**
 * Server-side env access. Prefer `publicEnv` when only public values are needed.
 * Do not re-export this object into client modules.
 * Property access triggers validation once.
 */
export const serverEnv: ServerEnv = new Proxy({} as ServerEnv, {
  get(_target, prop) {
    if (typeof prop !== "string") {
      return undefined;
    }
    return getServerEnv()[prop as keyof ServerEnv];
  },
});
