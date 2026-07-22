import { LeafError } from "@/lib/leaf/errors";

/** Reason text bounds (DB requires non-empty trim). */
export const LEAF_REASON_MAX_LENGTH = 500;

/** Idempotency key bounds. */
export const LEAF_IDEMPOTENCY_KEY_MAX_LENGTH = 200;

/** Metadata JSON size bound (serialized). */
export const LEAF_METADATA_MAX_BYTES = 8_192;

/** History page size. */
export const LEAF_HISTORY_DEFAULT_LIMIT = 20;
export const LEAF_HISTORY_MAX_LIMIT = 50;

/**
 * LEAF amounts must be safe JS integers so DTO numbers stay exact.
 * Postgres bigint can exceed this; we reject unsafe values at the boundary.
 */
export const LEAF_AMOUNT_ABS_MAX = Number.MAX_SAFE_INTEGER;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function assertProfileId(profileId: string): string {
  const id = profileId?.trim() ?? "";
  if (!UUID_RE.test(id)) {
    throw new LeafError("INVALID_PROFILE_ID", "profileId must be a UUID");
  }
  return id;
}

export function assertSafeIntegerAmount(
  value: unknown,
  field: string,
  code: "INVALID_AMOUNT" | "INVALID_LIFETIME_DELTA" | "UNSAFE_BIGINT" = "INVALID_AMOUNT",
): number {
  if (typeof value === "string") {
    if (!/^-?\d+$/.test(value.trim())) {
      throw new LeafError(code, `${field} must be an integer`);
    }
    const asNum = Number(value);
    if (!Number.isSafeInteger(asNum)) {
      throw new LeafError(
        "UNSAFE_BIGINT",
        `${field} exceeds safe integer range`,
      );
    }
    return asNum;
  }

  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new LeafError(code, `${field} must be a finite number`);
  }
  if (!Number.isInteger(value)) {
    throw new LeafError(code, `${field} must be an integer`);
  }
  if (!Number.isSafeInteger(value)) {
    throw new LeafError("UNSAFE_BIGINT", `${field} exceeds safe integer range`);
  }
  return value;
}

export function assertPositiveAwardAmount(amount: number): number {
  const n = assertSafeIntegerAmount(amount, "amount");
  if (n <= 0) {
    throw new LeafError("INVALID_AMOUNT", "amount must be greater than 0");
  }
  return n;
}

export function assertNonZeroAdjustAmount(amount: number): number {
  const n = assertSafeIntegerAmount(amount, "amount");
  if (n === 0) {
    throw new LeafError("INVALID_AMOUNT", "amount must be non-zero");
  }
  return n;
}

export function assertLifetimeDelta(lifetimeDelta: number): number {
  return assertSafeIntegerAmount(
    lifetimeDelta,
    "lifetimeDelta",
    "INVALID_LIFETIME_DELTA",
  );
}

export function assertReason(reason: string): string {
  const trimmed = reason?.trim() ?? "";
  if (!trimmed) {
    throw new LeafError("INVALID_REASON", "reason is required");
  }
  if (trimmed.length > LEAF_REASON_MAX_LENGTH) {
    throw new LeafError("INVALID_REASON", "reason is too long");
  }
  return trimmed;
}

export function assertIdempotencyKey(key: string): string {
  const trimmed = key?.trim() ?? "";
  if (!trimmed) {
    throw new LeafError(
      "INVALID_IDEMPOTENCY_KEY",
      "idempotencyKey is required",
    );
  }
  if (trimmed.length > LEAF_IDEMPOTENCY_KEY_MAX_LENGTH) {
    throw new LeafError(
      "INVALID_IDEMPOTENCY_KEY",
      "idempotencyKey is too long",
    );
  }
  return trimmed;
}

export function assertActorId(actorId: string): string {
  const trimmed = actorId?.trim() ?? "";
  if (!trimmed) {
    throw new LeafError("INVALID_ACTOR", "actorId is required");
  }
  if (trimmed.length > 200) {
    throw new LeafError("INVALID_ACTOR", "actorId is too long");
  }
  return trimmed;
}

export function assertOptionalActorId(
  actorId: string | null | undefined,
): string | null {
  if (actorId == null) return null;
  const trimmed = String(actorId).trim();
  if (!trimmed) return null;
  if (trimmed.length > 200) {
    throw new LeafError("INVALID_ACTOR", "actorId is too long");
  }
  return trimmed;
}

export function assertOptionalSourceId(
  value: string | null | undefined,
): string | null {
  if (value == null) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  if (trimmed.length > 200) {
    throw new LeafError("INVALID_METADATA", "source id is too long");
  }
  return trimmed;
}

export function assertMetadata(
  metadata: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const value = metadata ?? {};
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new LeafError("INVALID_METADATA", "metadata must be an object");
  }

  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new LeafError("INVALID_METADATA", "metadata is not serializable");
  }

  if (serialized.length > LEAF_METADATA_MAX_BYTES) {
    throw new LeafError("INVALID_METADATA", "metadata is too large");
  }

  return value;
}

export function parseHistoryLimit(limit: number | undefined): number {
  if (limit == null) return LEAF_HISTORY_DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit < 1) {
    throw new LeafError("INVALID_AMOUNT", "limit must be a positive integer");
  }
  return Math.min(limit, LEAF_HISTORY_MAX_LIMIT);
}

/** Idempotency key helpers for future callers (do not invent keys in awardLeaf). */
export const leafIdempotencyKeys = {
  deedApproval: (submissionId: string) =>
    `deed_submission:${submissionId}:approval`,
  campMessageReward: (messageId: string) =>
    `camp_message:${messageId}:reward`,
  adminAdjustment: (adjustmentId: string) =>
    `admin_adjustment:${adjustmentId}`,
  system: (eventId: string, purpose: string) =>
    `system:${eventId}:${purpose}`,
} as const;
