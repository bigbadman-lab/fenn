import "server-only";

import { z } from "zod";

import { publicEnv } from "@/lib/env/public";

/**
 * Optional later-stage credentials.
 * Empty strings are treated as unset so Stage 1 can boot without them.
 * This module must never be imported from Client Components.
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

const serverOnlySchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: optionalSecret,
  NEXT_PUBLIC_PRIVY_APP_ID: optionalSecret,
  PRIVY_APP_SECRET: optionalSecret,
  OPENAI_API_KEY: optionalSecret,
  ROBINHOOD_CHAIN_RPC_URL: optionalSecret,
  FENN_TREASURY_ADDRESS: optionalSecret,
  X_API_KEY: optionalSecret,
  X_API_SECRET: optionalSecret,
  X_BEARER_TOKEN: optionalSecret,
  X_OAUTH_CLIENT_ID: optionalSecret,
  X_OAUTH_CLIENT_SECRET: optionalSecret,
});

export type ServerOnlyEnv = z.infer<typeof serverOnlySchema>;

function readServerOnlyEnv(): ServerOnlyEnv {
  const parsed = serverOnlySchema.safeParse({
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    NEXT_PUBLIC_PRIVY_APP_ID: process.env.NEXT_PUBLIC_PRIVY_APP_ID,
    PRIVY_APP_SECRET: process.env.PRIVY_APP_SECRET,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    ROBINHOOD_CHAIN_RPC_URL: process.env.ROBINHOOD_CHAIN_RPC_URL,
    FENN_TREASURY_ADDRESS: process.env.FENN_TREASURY_ADDRESS,
    X_API_KEY: process.env.X_API_KEY,
    X_API_SECRET: process.env.X_API_SECRET,
    X_BEARER_TOKEN: process.env.X_BEARER_TOKEN,
    X_OAUTH_CLIENT_ID: process.env.X_OAUTH_CLIENT_ID,
    X_OAUTH_CLIENT_SECRET: process.env.X_OAUTH_CLIENT_SECRET,
  });

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "env"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid server environment configuration:\n${details}`);
  }

  return parsed.data;
}

const serverOnlyEnv = readServerOnlyEnv();

/**
 * Server-side env access. Prefer `publicEnv` when only public values are needed.
 * Do not re-export this object into client modules.
 */
export const serverEnv = {
  ...publicEnv,
  ...serverOnlyEnv,
} as const;
