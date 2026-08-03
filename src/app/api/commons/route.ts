import { handleCommonsGet } from "@/lib/commons/route-handler";

export const runtime = "nodejs";

/**
 * Commons is DB-backed accounting, not live chain state.
 * no-store keeps MVP simple and avoids implying stale-but-cached commitments
 * are current after an admin change. Not blockchain realtime.
 */
export const dynamic = "force-dynamic";

/**
 * GET /api/commons
 *
 * Public authoritative Commons snapshot.
 * No Privy authentication — Commons is public product state.
 *
 * Ready (including empty commitments / unavailable history) → HTTP 200.
 * Failure to read current commitments → non-2xx.
 * Cache-Control: no-store (applied in handleCommonsGet).
 */
export async function GET() {
  return handleCommonsGet();
}
