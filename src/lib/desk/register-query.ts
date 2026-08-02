import { z } from "zod";

export const DESK_REGISTER_DEFAULT_LIMIT = 25;
export const DESK_REGISTER_MAX_LIMIT = 50;

const greenwoodFilterSchema = z.enum(["all", "member", "non_member"]).default("all");
const presenceFilterSchema = z
  .enum(["all", "at_fire", "not_present"])
  .default("all");
const pendingDeedsFilterSchema = z.enum(["all", "pending"]).default("all");

export type DeskRegisterQuery = {
  q: string;
  page: number;
  limit: number;
  greenwood: z.infer<typeof greenwoodFilterSchema>;
  presence: z.infer<typeof presenceFilterSchema>;
  pendingDeeds: z.infer<typeof pendingDeedsFilterSchema>;
};

export class DeskRegisterQueryError extends Error {
  status: 400;

  constructor(message: string) {
    super(message);
    this.name = "DeskRegisterQueryError";
    this.status = 400;
  }
}

/**
 * Validate Register list query params. Rejects unsafe / unbounded inputs.
 */
export function parseDeskRegisterQuery(
  raw: URLSearchParams | Record<string, string | undefined>,
): DeskRegisterQuery {
  const get = (key: string): string | undefined => {
    if (raw instanceof URLSearchParams) {
      return raw.get(key) ?? undefined;
    }
    return raw[key];
  };

  const qRaw = (get("q") ?? "").trim();
  if (qRaw.length > 120) {
    throw new DeskRegisterQueryError("Search query is too long");
  }
  // Reject SQL-like wildcards used as operators; we escape % and _ ourselves.
  if (qRaw.includes(";") || qRaw.includes("--")) {
    throw new DeskRegisterQueryError("Invalid search query");
  }

  const pageRaw = get("page") ?? "1";
  const limitRaw = get("limit") ?? String(DESK_REGISTER_DEFAULT_LIMIT);
  if (!/^\d+$/.test(pageRaw) || !/^\d+$/.test(limitRaw)) {
    throw new DeskRegisterQueryError("Invalid pagination");
  }
  const page = Number(pageRaw);
  const limit = Number(limitRaw);
  if (!Number.isInteger(page) || page < 1 || page > 10_000) {
    throw new DeskRegisterQueryError("Invalid page");
  }
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > DESK_REGISTER_MAX_LIMIT
  ) {
    throw new DeskRegisterQueryError("Invalid limit");
  }

  let greenwood: DeskRegisterQuery["greenwood"] = "all";
  let presence: DeskRegisterQuery["presence"] = "all";
  let pendingDeeds: DeskRegisterQuery["pendingDeeds"] = "all";
  try {
    greenwood = greenwoodFilterSchema.parse(get("greenwood") ?? "all");
    presence = presenceFilterSchema.parse(get("presence") ?? "all");
    pendingDeeds = pendingDeedsFilterSchema.parse(
      get("pendingDeeds") ?? "all",
    );
  } catch {
    throw new DeskRegisterQueryError("Invalid filter");
  }

  return {
    q: qRaw,
    page,
    limit,
    greenwood,
    presence,
    pendingDeeds,
  };
}

/** Escape LIKE metacharacters for prefix/contains search. */
export function escapeIlikePattern(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}
