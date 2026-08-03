import { z } from "zod";

/**
 * Client-safe environment variables only.
 * Import this module from Client Components and shared code.
 * Never add server secrets here.
 *
 * Values are read lazily on first property access so Next.js can import
 * modules during `next build` without requiring secrets for every route.
 * Public vars are still required before any page that uses them can render.
 */
const publicEnvSchema = z.object({
  NEXT_PUBLIC_SITE_URL: z
    .string()
    .min(1, "NEXT_PUBLIC_SITE_URL is required")
    .url("NEXT_PUBLIC_SITE_URL must be a valid URL"),
  NEXT_PUBLIC_SUPABASE_URL: z
    .string()
    .min(1, "NEXT_PUBLIC_SUPABASE_URL is required")
    .url("NEXT_PUBLIC_SUPABASE_URL must be a valid URL"),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z
    .string()
    .min(1, "NEXT_PUBLIC_SUPABASE_ANON_KEY is required"),
  NEXT_PUBLIC_PRIVY_APP_ID: z
    .string()
    .min(1, "NEXT_PUBLIC_PRIVY_APP_ID is required"),
});

export type PublicEnv = z.infer<typeof publicEnvSchema>;

function readPublicEnv(): PublicEnv {
  const raw = {
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL?.trim(),
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL?.trim(),
    NEXT_PUBLIC_SUPABASE_ANON_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim(),
    NEXT_PUBLIC_PRIVY_APP_ID: process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim(),
  };

  const parsed = publicEnvSchema.safeParse(raw);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "env"}: ${issue.message}`)
      .join("\n");
    const missing = (
      [
        "NEXT_PUBLIC_SITE_URL",
        "NEXT_PUBLIC_SUPABASE_URL",
        "NEXT_PUBLIC_SUPABASE_ANON_KEY",
        "NEXT_PUBLIC_PRIVY_APP_ID",
      ] as const
    ).filter((key) => !raw[key]);
    const missingHint =
      missing.length > 0
        ? `\nMissing or empty: ${missing.join(", ")}`
        : "";
    throw new Error(
      `Invalid public environment configuration:${missingHint}\n${details}\n` +
        "Set these in Vercel → Project → Settings → Environment Variables " +
        "(Production + Preview), then redeploy. Values must match .env.local / .env.example.",
    );
  }

  return parsed.data;
}

let cachedPublicEnv: PublicEnv | undefined;

/** Validate and return public env (memoized). */
export function getPublicEnv(): PublicEnv {
  if (!cachedPublicEnv) {
    cachedPublicEnv = readPublicEnv();
  }
  return cachedPublicEnv;
}

/**
 * Lazy public env bag — property access triggers validation once.
 * Prefer this over reading process.env directly in product code.
 */
export const publicEnv: PublicEnv = new Proxy({} as PublicEnv, {
  get(_target, prop) {
    if (typeof prop !== "string") {
      return undefined;
    }
    return getPublicEnv()[prop as keyof PublicEnv];
  },
});
