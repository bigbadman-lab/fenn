import { buildHomeLiveTicker } from "@/lib/live-ticker/build-home-live-ticker";

export const dynamic = "force-dynamic";

/**
 * Public homepage live ticker feed.
 * Derived from trusted public readers — no auth, no secrets, no persistence.
 */
export async function GET() {
  try {
    const items = await buildHomeLiveTicker();
    return Response.json(
      { ok: true, items },
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch {
    return Response.json(
      { ok: true, items: [] },
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  }
}
