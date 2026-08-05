import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { CLEARING_RATE_LIMITS } from "@/lib/clearing/config";
import { ClearingError } from "@/lib/clearing/errors";
import { createHash } from "node:crypto";

async function defaultAdmin(): Promise<SupabaseClient> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return createAdminClient();
}

/**
 * Hash network key (IP) so raw IPs are not stored.
 */
export function hashClearingNetworkKey(
  raw: string,
  salt: string = "clearing-v1",
): string {
  return createHash("sha256")
    .update(`${salt}:${raw.trim()}`, "utf8")
    .digest("hex")
    .slice(0, 32);
}

export function networkKeyFromRequest(request: Request): string {
  const xf = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const realIp = request.headers.get("x-real-ip")?.trim();
  const raw = xf || realIp || "unknown";
  return hashClearingNetworkKey(raw);
}

/**
 * Sliding fixed-window counter in Postgres.
 * Returns remaining hits or throws rate_limited.
 */
export async function consumeRateBucket(input: {
  bucketKey: string;
  windowSeconds: number;
  maxHits: number;
  admin?: SupabaseClient;
  now?: Date;
}): Promise<void> {
  if (input.maxHits <= 0) return;
  const admin = input.admin ?? (await defaultAdmin());
  const now = input.now ?? new Date();
  const windowMs = input.windowSeconds * 1000;
  const windowStartMs =
    Math.floor(now.getTime() / windowMs) * windowMs;
  const windowStart = new Date(windowStartMs).toISOString();

  const { data: existing } = await admin
    .from("clearing_rate_buckets")
    .select("bucket_key, window_start, hit_count")
    .eq("bucket_key", input.bucketKey)
    .maybeSingle();

  if (!existing || existing.window_start !== windowStart) {
    const { error } = await admin.from("clearing_rate_buckets").upsert(
      {
        bucket_key: input.bucketKey,
        window_start: windowStart,
        hit_count: 1,
      },
      { onConflict: "bucket_key" },
    );
    if (error) {
      throw new ClearingError(
        "clearing_internal",
        "Rate limit storage failed",
        500,
      );
    }
    return;
  }

  const hits = Number(existing.hit_count) + 1;
  if (hits > input.maxHits) {
    throw new ClearingError(
      "clearing_rate_limited",
      "the road asks for a slower voice.",
      429,
    );
  }

  const { error } = await admin
    .from("clearing_rate_buckets")
    .update({ hit_count: hits })
    .eq("bucket_key", input.bucketKey)
    .eq("window_start", windowStart);

  if (error) {
    throw new ClearingError(
      "clearing_internal",
      "Rate limit storage failed",
      500,
    );
  }
}

export async function assertAuthorCooldown(input: {
  authorKey: string;
  cooldownSeconds: number;
  admin?: SupabaseClient;
}): Promise<void> {
  if (input.cooldownSeconds <= 0) return;
  const admin = input.admin ?? (await defaultAdmin());
  const since = new Date(
    Date.now() - input.cooldownSeconds * 1000,
  ).toISOString();

  // authorKey: traveller:<uuid> or profile:<uuid>
  const [kind, id] = input.authorKey.split(":");
  if (!kind || !id) return;

  let query = admin
    .from("clearing_messages")
    .select("id, created_at")
    .eq("status", "published")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(1);

  if (kind === "traveller") {
    query = query.eq("traveller_id", id);
  } else {
    query = query.eq("profile_id", id);
  }

  const { data, error } = await query.maybeSingle();
  if (error) {
    throw new ClearingError(
      "clearing_internal",
      "Cooldown check failed",
      500,
    );
  }
  if (data) {
    throw new ClearingError(
      "clearing_slow_mode",
      "wait a breath before speaking again.",
      429,
    );
  }
}

export { CLEARING_RATE_LIMITS };
