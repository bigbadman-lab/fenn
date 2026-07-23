import { CommonsError } from "@/lib/commons/errors";

/**
 * Normalize Postgres `numeric` values to exact decimal strings.
 * Refuses unsafe JS number coercion that would lose precision.
 */
export function exactNumericString(value: unknown, field: string): string {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!/^-?\d+(\.\d+)?$/.test(trimmed)) {
      throw new CommonsError(
        "commons_malformed_amount",
        `Malformed numeric value for ${field}`,
        500,
      );
    }
    return trimmed;
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value) || !Number.isSafeInteger(value)) {
      throw new CommonsError(
        "commons_malformed_amount",
        `Unsafe numeric coercion for ${field}`,
        500,
      );
    }
    return String(value);
  }

  throw new CommonsError(
    "commons_malformed_amount",
    `Missing or invalid numeric value for ${field}`,
    500,
  );
}
