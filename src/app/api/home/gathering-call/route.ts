import { getPublicHomeGatheringCall } from "@/lib/greenwood/gatherings/public-home-signal";

export const dynamic = "force-dynamic";

/**
 * Public homepage Gathering map signal.
 * Public-safe fields only — never the member Fire payload.
 */
export async function GET() {
  const signal = await getPublicHomeGatheringCall();
  return Response.json(
    { ok: true, signal },
    {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
