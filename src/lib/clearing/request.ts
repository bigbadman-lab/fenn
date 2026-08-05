import "server-only";

import {
  CLEARING_MAX_CURSOR_CHARS,
  CLEARING_MAX_REQUEST_BODY_BYTES,
} from "@/lib/clearing/config";
import { ClearingError } from "@/lib/clearing/errors";

/**
 * Read JSON body with explicit size and content-type guards.
 * Rejects before expensive work. Does not echo attacker payload.
 */
export async function readClearingJsonBody(
  request: Request,
  options?: { maxBytes?: number },
): Promise<unknown> {
  const maxBytes = options?.maxBytes ?? CLEARING_MAX_REQUEST_BODY_BYTES;
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new ClearingError(
      "clearing_invalid_request",
      "Content-Type must be application/json",
      415,
    );
  }

  const lengthHeader = request.headers.get("content-length");
  if (lengthHeader) {
    const n = Number.parseInt(lengthHeader, 10);
    if (Number.isFinite(n) && n > maxBytes) {
      throw new ClearingError(
        "clearing_payload_too_large",
        "Request body is too large",
        413,
      );
    }
  }

  let text: string;
  try {
    text = await request.text();
  } catch {
    throw new ClearingError(
      "clearing_invalid_request",
      "Invalid request body",
      400,
    );
  }

  if (text.length > maxBytes) {
    throw new ClearingError(
      "clearing_payload_too_large",
      "Request body is too large",
      413,
    );
  }

  if (!text.trim()) {
    // empty object allowed where handlers tolerate missing fields
    return {};
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ClearingError(
      "clearing_invalid_request",
      "Invalid JSON body",
      400,
    );
  }
}

export function clampClearingCursor(
  raw: string | null | undefined,
): string | null {
  if (raw == null || raw === "") return null;
  if (typeof raw !== "string") return null;
  if (raw.length > CLEARING_MAX_CURSOR_CHARS) return null;
  return raw;
}
