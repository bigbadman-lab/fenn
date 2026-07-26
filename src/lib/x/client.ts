import "server-only";

import {
  X_API_BASE_URL,
  X_HTTP_TIMEOUT_MS,
  X_MENTIONS_MAX_PAGES,
  X_MENTIONS_MAX_RESULTS,
  type XReadConfig,
} from "@/lib/x/config";
import { XError } from "@/lib/x/errors";
import { assertSnowflakeId } from "@/lib/x/snowflake";
import {
  normalizeMention,
  parseXErrorPayload,
  validateMentionsResponse,
  validateUserLookupResponse,
  type NormalizedXPerception,
  type XUser,
} from "@/lib/x/validate";

export type XHttpFetch = (
  input: string,
  init: RequestInit,
) => Promise<Response>;

export type LookupUserByUsernameResult = {
  id: string;
  username: string;
  name: string | null;
};

export type FetchMentionsResult = {
  perceptions: NormalizedXPerception[];
  pagesFetched: number;
  /** True when API returned a successful empty set (not an error). */
  empty: boolean;
};

export type XClientDeps = {
  fetchFn?: XHttpFetch;
  timeoutMs?: number;
};

function bearerHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
  };
}

async function xFetchJson(
  url: string,
  bearerToken: string,
  deps: XClientDeps,
): Promise<{ status: number; body: unknown }> {
  const fetchFn = deps.fetchFn ?? fetch;
  const timeoutMs = deps.timeoutMs ?? X_HTTP_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchFn(url, {
      method: "GET",
      headers: bearerHeaders(bearerToken),
      signal: controller.signal,
      cache: "no-store",
    });

    let body: unknown = null;
    const text = await response.text();
    if (text.length > 0) {
      try {
        body = JSON.parse(text) as unknown;
      } catch {
        throw new XError(
          "x_invalid_response",
          "X API returned non-JSON body",
          502,
        );
      }
    }

    return { status: response.status, body };
  } catch (error) {
    if (error instanceof XError) throw error;
    if (
      error instanceof Error &&
      (error.name === "AbortError" || error.message.includes("aborted"))
    ) {
      throw new XError("x_timeout", "X API request timed out", 504);
    }
    throw new XError(
      "x_network",
      error instanceof Error ? error.message : "X API network failure",
      502,
    );
  } finally {
    clearTimeout(timer);
  }
}

function throwForHttpStatus(status: number, body: unknown): never {
  if (status === 401 || status === 403) {
    throw new XError(
      "x_auth_failed",
      parseXErrorPayload(body) || "X API authentication failed",
      status,
      body,
    );
  }
  throw new XError(
    "x_api_error",
    parseXErrorPayload(body) || `X API HTTP ${status}`,
    status >= 400 && status < 600 ? status : 502,
    body,
  );
}

/**
 * GET /2/users/by/username/:username
 */
export async function lookupUserByUsername(
  config: XReadConfig,
  username: string,
  deps: XClientDeps = {},
): Promise<LookupUserByUsernameResult> {
  const handle = username.replace(/^@/, "").trim();
  if (!handle) {
    throw new XError("x_config_invalid", "username required", 400);
  }

  const url = `${X_API_BASE_URL}/users/by/username/${encodeURIComponent(handle)}?user.fields=username,name`;
  const { status, body } = await xFetchJson(url, config.bearerToken, deps);

  if (status < 200 || status >= 300) {
    throwForHttpStatus(status, body);
  }

  const parsed = validateUserLookupResponse(body);
  if (!parsed.data) {
    throw new XError(
      "x_invalid_response",
      `X user @${handle} not found`,
      404,
      body,
    );
  }

  return {
    id: assertSnowflakeId(parsed.data.id, "user.id"),
    username: parsed.data.username,
    name: parsed.data.name ?? null,
  };
}

/**
 * GET /2/users/:id/mentions with since_id + pagination.
 * Returns normalized perceptions; does not persist.
 */
export async function fetchUserMentions(
  config: XReadConfig,
  userId: string,
  options: {
    sinceId?: string | null;
    maxPages?: number;
  } = {},
  deps: XClientDeps = {},
): Promise<FetchMentionsResult> {
  const id = assertSnowflakeId(userId, "FENN_X_USER_ID");
  const maxPages = options.maxPages ?? X_MENTIONS_MAX_PAGES;
  const perceptions: NormalizedXPerception[] = [];
  let pagesFetched = 0;
  let paginationToken: string | undefined;
  let sawAnyPage = false;

  do {
    const params = new URLSearchParams({
      max_results: String(X_MENTIONS_MAX_RESULTS),
      "tweet.fields":
        "id,text,author_id,created_at,conversation_id,referenced_tweets",
      expansions: "author_id",
      "user.fields": "id,username,name",
    });
    if (options.sinceId) {
      params.set("since_id", assertSnowflakeId(options.sinceId, "since_id"));
    }
    if (paginationToken) {
      params.set("pagination_token", paginationToken);
    }

    const url = `${X_API_BASE_URL}/users/${id}/mentions?${params.toString()}`;
    const { status, body } = await xFetchJson(url, config.bearerToken, deps);

    if (status < 200 || status >= 300) {
      throwForHttpStatus(status, body);
    }

    const parsed = validateMentionsResponse(body);
    pagesFetched += 1;
    sawAnyPage = true;

    const authorsById = new Map<string, XUser>();
    for (const user of parsed.includes?.users ?? []) {
      authorsById.set(user.id, user);
    }

    for (const tweet of parsed.data ?? []) {
      perceptions.push(normalizeMention(tweet, authorsById));
    }

    paginationToken = parsed.meta?.next_token;
  } while (paginationToken && pagesFetched < maxPages);

  return {
    perceptions,
    pagesFetched,
    empty: sawAnyPage && perceptions.length === 0,
  };
}
