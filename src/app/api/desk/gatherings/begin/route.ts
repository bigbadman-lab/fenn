import { requireFennDeskAccess } from "@/lib/desk/auth";
import {
  deskBeginGathering,
  parseBeginGatheringBody,
} from "@/lib/desk/begin-gathering";
import { deskJson } from "@/lib/desk/http";
import { mapDeskGatheringError } from "@/lib/desk/route-errors";

export const dynamic = "force-dynamic";

/**
 * Begin a Gathering immediately with server-authoritative timestamps.
 * Client supplies duration + copy — never trusted start/end clocks.
 */
export async function POST(request: Request) {
  try {
    const identity = await requireFennDeskAccess(request);
    const body = await request.json();
    const input = parseBeginGatheringBody(body);
    const gathering = await deskBeginGathering(input, identity.actorId);
    return deskJson({ ok: true, gathering }, { status: 201 });
  } catch (error) {
    return mapDeskGatheringError(error, "POST /api/desk/gatherings/begin");
  }
}
