import {
  CLEARING_FEED_DEFAULT_LIMIT,
  CLEARING_FEED_MAX_LIMIT,
  CLEARING_MESSAGE_MAX_CHARS,
} from "@/lib/clearing/config";
import { ClearingError } from "@/lib/clearing/errors";
import { isClearingUuid } from "@/lib/clearing/cookie";

/**
 * Safe public message DTO — no profile ids, cookies, or moderation private fields.
 */
export type SafeClearingMessage = {
  kind: "message";
  id: string;
  occurredAt: string;
  author: {
    type: "traveller" | "outlaw" | "keeper";
    label: string;
  };
  body: string;
};

/**
 * Safe public world event from published Market Watch acquisitions only.
 * No worker state, buyer identity, raw logs, or suppressed rows.
 */
export type SafeMarketWatchFeedItem = {
  kind: "market_watch";
  id: string;
  occurredAt: string;
  /** e.g. `18,420 $FENN` — preformatted server-side. */
  amountLabel: string;
  /** Explorer transaction URL, or null if chain/hash unsupported. */
  transactionUrl: string | null;
};

/**
 * Public feed union. Browser only renders kinds it understands.
 */
export type SafeClearingFeedItem = SafeClearingMessage | SafeMarketWatchFeedItem;

export type SafeClearingFeedPage = {
  items: SafeClearingFeedItem[];
  nextCursor: string | null;
  /** Public global mode — safe for UI lock/composer. */
  state?: {
    readOnly: boolean;
    slowModeSeconds: number;
  };
};

export type SafeTravellerIdentity = {
  displayName: string;
  messagesRemaining: number;
  /** Always three for allowance display; remaining is authoritative. */
  messagesLimit: number;
};

export function toSafeClearingMessage(row: {
  id: string;
  author_type: string;
  author_display_name_snapshot: string;
  body: string;
  created_at: string;
}): SafeClearingMessage {
  const type =
    row.author_type === "traveller" ||
    row.author_type === "outlaw" ||
    row.author_type === "keeper"
      ? row.author_type
      : "traveller";
  return {
    kind: "message",
    id: row.id,
    occurredAt: row.created_at,
    author: {
      type,
      label: row.author_display_name_snapshot,
    },
    body: row.body,
  };
}

/**
 * Authoritative body validation — plain text, no HTML interpretation.
 * Strips NUL; rejects control characters outside tab/newline.
 */
export function validateClearingMessageBody(raw: unknown): string {
  if (typeof raw !== "string") {
    throw new ClearingError(
      "clearing_invalid_body",
      "Message must be a string",
      400,
    );
  }
  // Strip null bytes & normalize newlines; drop other C0 controls
  let text = raw
    .replace(/\u0000/g, "")
    .replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
  text = text.trim();
  if (!text) {
    throw new ClearingError(
      "clearing_invalid_body",
      "Message cannot be empty",
      400,
    );
  }
  if (text.length > CLEARING_MESSAGE_MAX_CHARS) {
    throw new ClearingError(
      "clearing_invalid_body",
      `Message exceeds ${CLEARING_MESSAGE_MAX_CHARS} characters`,
      400,
    );
  }
  return text;
}

export function requireClientRequestId(raw: unknown): string {
  if (typeof raw !== "string" || !isClearingUuid(raw.trim())) {
    throw new ClearingError(
      "clearing_invalid_request",
      "client_request_id must be a UUID",
      400,
    );
  }
  return raw.trim().toLowerCase();
}

export function clampFeedLimit(raw: unknown): number {
  if (raw == null || raw === "") return CLEARING_FEED_DEFAULT_LIMIT;
  const n = typeof raw === "number" ? raw : Number.parseInt(String(raw), 10);
  if (!Number.isFinite(n) || n < 1) return CLEARING_FEED_DEFAULT_LIMIT;
  return Math.min(Math.floor(n), CLEARING_FEED_MAX_LIMIT);
}

/**
 * Cursor: `${created_at_iso}|${id}` for reverse chrono.
 */
export function encodeFeedCursor(createdAt: string, id: string): string {
  return Buffer.from(`${createdAt}|${id}`, "utf8").toString("base64url");
}

export function decodeFeedCursor(
  raw: string | null | undefined,
): { createdAt: string; id: string } | null {
  if (!raw || typeof raw !== "string") return null;
  try {
    const decoded = Buffer.from(raw, "base64url").toString("utf8");
    const pipe = decoded.indexOf("|");
    if (pipe <= 0) return null;
    const createdAt = decoded.slice(0, pipe);
    const id = decoded.slice(pipe + 1);
    if (!createdAt || !isClearingUuid(id)) return null;
    if (Number.isNaN(Date.parse(createdAt))) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}
