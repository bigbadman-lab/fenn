import { XError } from "@/lib/x/errors";

/** X snowflake IDs must remain strings — never coerce via Number. */
export function assertSnowflakeId(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new XError(
      "x_invalid_response",
      `${label} must be a string snowflake id`,
      502,
    );
  }
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new XError(
      "x_invalid_response",
      `${label} must be a digit string`,
      502,
    );
  }
  return trimmed;
}

export function compareSnowflake(a: string, b: string): number {
  const left = BigInt(assertSnowflakeId(a, "snowflake"));
  const right = BigInt(assertSnowflakeId(b, "snowflake"));
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export function maxSnowflake(ids: string[]): string | null {
  if (ids.length === 0) return null;
  return ids.reduce((best, id) =>
    compareSnowflake(id, best) > 0 ? id : best,
  );
}
