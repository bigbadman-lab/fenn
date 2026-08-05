import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { CLEARING_RATE_LIMITS } from "@/lib/clearing/config";
import { ClearingError } from "@/lib/clearing/errors";
import { logClearing } from "@/lib/clearing/log";
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

export type ConsumeRateBucketResult = {
  allowed: true;
  hits: number;
  remaining: number;
  maxHits: number;
};

/**
 * Atomic fixed-window counter via Postgres RPC.
 * Fail closed on RPC failure (does not silently allow spam).
 */
export async function consumeRateBucket(input: {
  bucketKey: string;
  windowSeconds: number;
  maxHits: number;
  admin?: SupabaseClient;
  now?: Date;
}): Promise<ConsumeRateBucketResult> {
  if (input.maxHits <= 0) {
    return {
      allowed: true,
      hits: 0,
      remaining: 0,
      maxHits: 0,
    };
  }
  const admin = input.admin ?? (await defaultAdmin());
  const now = input.now ?? new Date();
  const windowMs = input.windowSeconds * 1000;
  const windowStartMs = Math.floor(now.getTime() / windowMs) * windowMs;
  const windowStart = new Date(windowStartMs).toISOString();

  const { data, error } = await admin.rpc("consume_clearing_rate_bucket", {
    p_bucket_key: input.bucketKey,
    p_window_start: windowStart,
    p_max_hits: input.maxHits,
  });

  if (error) {
    const msg = (error.message ?? "").toLowerCase();
    if (msg.includes("rate_limited")) {
      logClearing({
        event: "rate_limited",
        ok: false,
        code: "clearing_rate_limited",
        detail: input.bucketKey.split(":")[0],
      });
      throw new ClearingError(
        "clearing_rate_limited",
        "the road asks for a slower voice.",
        429,
        {
          retryAfterSeconds: input.windowSeconds,
        },
      );
    }
    logClearing({
      event: "rpc_fail",
      ok: false,
      code: "clearing_internal",
      detail: "consume_clearing_rate_bucket",
    });
    // Fail closed — do not allow spam when rate storage is broken
    throw new ClearingError(
      "clearing_internal",
      "Rate limit unavailable",
      503,
    );
  }

  const hits = typeof data === "number" ? data : Number(data);
  if (!Number.isFinite(hits)) {
    throw new ClearingError(
      "clearing_internal",
      "Rate limit unavailable",
      503,
    );
  }

  return {
    allowed: true,
    hits,
    remaining: Math.max(0, input.maxHits - hits),
    maxHits: input.maxHits,
  };
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

  const [kind, id] = input.authorKey.split(":");
  if (!kind || !id) return;

  let query = admin
    .from("clearing_messages")
    .select("id, created_at")
    .in("status", ["published", "hidden"])
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
    // Fail closed — cannot verify cooldown
    throw new ClearingError(
      "clearing_internal",
      "Cooldown check failed",
      503,
    );
  }
  if (data) {
    throw new ClearingError(
      "clearing_slow_mode",
      "wait a breath before speaking again.",
      429,
      { retryAfterSeconds: input.cooldownSeconds },
    );
  }
}

export { CLEARING_RATE_LIMITS };
