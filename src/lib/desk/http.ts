/**
 * Shared Desk API response headers.
 * Layout/shell auth is not an API security boundary — every route must
 * call requireFennDeskAccess independently.
 */
export const DESK_NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store",
} as const;

export function deskJson(
  body: unknown,
  init?: { status?: number },
): Response {
  return Response.json(body, {
    status: init?.status ?? 200,
    headers: DESK_NO_STORE_HEADERS,
  });
}
