import type { LeaveWallMarkResult } from "@/lib/wall/types";

type ApiEnvelope = {
  ok?: boolean;
  result?: LeaveWallMarkResult;
  marks?: Record<string, boolean>;
  error?: string;
  code?: string;
};

export type WallMarkClientError = {
  code: string;
  message: string;
  httpStatus: number;
};

export type LeaveWallMarkFetchResult =
  | { ok: true; result: LeaveWallMarkResult }
  | { ok: false; error: WallMarkClientError };

export type WallMarksStatusFetchResult =
  | { ok: true; marks: Record<string, boolean> }
  | { ok: false; error: WallMarkClientError };

function asError(
  httpStatus: number,
  body: ApiEnvelope | null,
  fallbackCode: string,
  fallbackMessage: string,
): WallMarkClientError {
  return {
    httpStatus,
    code: body?.code ?? fallbackCode,
    message: body?.error ?? fallbackMessage,
  };
}

/**
 * Authenticated POST /api/wall/[entryId]/mark with an empty body.
 * Never sends profileId from the client.
 */
export async function postLeaveWallMark(
  entryId: string,
  headers: HeadersInit,
): Promise<LeaveWallMarkFetchResult> {
  const response = await fetch(
    `/api/wall/${encodeURIComponent(entryId)}/mark`,
    {
      method: "POST",
      headers,
      cache: "no-store",
    },
  );

  let body: ApiEnvelope | null = null;
  try {
    body = (await response.json()) as ApiEnvelope;
  } catch {
    body = null;
  }

  if (!response.ok || !body?.ok || !body.result) {
    return {
      ok: false,
      error: asError(
        response.status,
        body,
        "wall_mark_failed",
        "Failed to leave Wall mark",
      ),
    };
  }

  return { ok: true, result: body.result };
}

/**
 * Authenticated GET /api/wall/marks?entries=...
 * Returns only the current Outlaw's mark booleans.
 */
export async function fetchWallMarksStatus(
  entryIds: string[],
  headers: HeadersInit,
): Promise<WallMarksStatusFetchResult> {
  if (entryIds.length === 0) {
    return { ok: true, marks: {} };
  }

  const params = new URLSearchParams({
    entries: entryIds.join(","),
  });
  const response = await fetch(`/api/wall/marks?${params.toString()}`, {
    headers,
    cache: "no-store",
  });

  let body: ApiEnvelope | null = null;
  try {
    body = (await response.json()) as ApiEnvelope;
  } catch {
    body = null;
  }

  if (!response.ok || !body?.ok || !body.marks) {
    return {
      ok: false,
      error: asError(
        response.status,
        body,
        "wall_mark_failed",
        "Failed to load Wall mark status",
      ),
    };
  }

  return { ok: true, marks: body.marks };
}
