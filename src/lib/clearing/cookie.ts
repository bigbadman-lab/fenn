import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import {
  CLEARING_TRAVELLER_COOKIE_MAX_AGE_SECONDS,
  CLEARING_TRAVELLER_COOKIE_NAME,
} from "@/lib/clearing/config";
import { ClearingError } from "@/lib/clearing/errors";

export { CLEARING_TRAVELLER_COOKIE_NAME, CLEARING_TRAVELLER_COOKIE_MAX_AGE_SECONDS };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isClearingUuid(value: string): boolean {
  return UUID_RE.test(value.trim());
}

/**
 * Resolve HMAC secret. Prefer dedicated secret; fall back to service role for
 * single-box deploys. Never empty.
 */
export function resolveClearingCookieSecret(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const dedicated = env.FENN_CLEARING_COOKIE_SECRET?.trim();
  if (dedicated && dedicated.length >= 16) return dedicated;
  const fallback = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (fallback && fallback.length >= 16) return fallback;
  throw new ClearingError(
    "clearing_internal",
    "Clearing cookie secret is not configured",
    500,
  );
}

type Payload = {
  v: 1;
  id: string;
  exp: number;
};

function base64UrlEncode(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlDecode(s: string): Buffer {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
  return Buffer.from(b64, "base64");
}

function sign(body: string, secret: string): string {
  return base64UrlEncode(
    createHmac("sha256", secret).update(body, "utf8").digest(),
  );
}

/**
 * Build signed cookie value: base64url(payload).signature
 */
export function sealTravellerCookie(
  travellerId: string,
  options?: { nowMs?: number; maxAgeSeconds?: number; secret?: string },
): string {
  const id = travellerId.trim();
  if (!isClearingUuid(id)) {
    throw new ClearingError(
      "clearing_invalid_request",
      "Invalid traveller id",
      400,
    );
  }
  const maxAge =
    options?.maxAgeSeconds ?? CLEARING_TRAVELLER_COOKIE_MAX_AGE_SECONDS;
  const now = options?.nowMs ?? Date.now();
  const secret = options?.secret ?? resolveClearingCookieSecret();
  const payload: Payload = {
    v: 1,
    id,
    exp: Math.floor(now / 1000) + maxAge,
  };
  const body = base64UrlEncode(Buffer.from(JSON.stringify(payload), "utf8"));
  const sig = sign(body, secret);
  return `${body}.${sig}`;
}

/**
 * Verify signed cookie; returns traveller id or null if invalid/expired.
 */
export function openTravellerCookie(
  raw: string | null | undefined,
  options?: { nowMs?: number; secret?: string },
): string | null {
  if (!raw || typeof raw !== "string") return null;
  const trimmed = raw.trim();
  const dot = trimmed.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = trimmed.slice(0, dot);
  const sig = trimmed.slice(dot + 1);
  if (!body || !sig) return null;

  let secret: string;
  try {
    secret = options?.secret ?? resolveClearingCookieSecret();
  } catch {
    return null;
  }

  const expected = sign(body, secret);
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }

  try {
    const json = base64UrlDecode(body).toString("utf8");
    const payload = JSON.parse(json) as Payload;
    if (payload.v !== 1) return null;
    if (!isClearingUuid(payload.id)) return null;
    const nowSec = Math.floor((options?.nowMs ?? Date.now()) / 1000);
    if (!Number.isFinite(payload.exp) || payload.exp < nowSec) return null;
    return payload.id;
  } catch {
    return null;
  }
}

export function generateTravellerId(): string {
  // RFC4122-ish from random bytes (uuid v4)
  const b = randomBytes(16);
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = b.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function travellerCookieOptions(maxAgeSeconds?: number) {
  const isProd = process.env.NODE_ENV === "production";
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: isProd,
    path: "/",
    maxAge: maxAgeSeconds ?? CLEARING_TRAVELLER_COOKIE_MAX_AGE_SECONDS,
  };
}
