import { handleTreasuryGet } from "@/lib/treasury/route-handler";

export const runtime = "nodejs";

/**
 * Live Treasury holdings change onchain; do not statically cache this route.
 * Stage 9.4 must not claim second-by-second realtime without stronger guarantees.
 * Cache-Control: no-store (applied in handleTreasuryGet).
 */
export const dynamic = "force-dynamic";

/**
 * GET /api/treasury
 *
 * Public authoritative Treasury snapshot.
 * No Privy authentication — Treasury is public product state.
 *
 * Domain states (unconfigured / ready / unavailable) return HTTP 200.
 * Unexpected internal failures return non-2xx without leaking RPC/provider details.
 */
export async function GET() {
  return handleTreasuryGet();
}
