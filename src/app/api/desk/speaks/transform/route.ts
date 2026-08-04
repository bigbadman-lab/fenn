import { z } from "zod";

import { requireFennDeskAccess } from "@/lib/desk/auth";
import { deskJson } from "@/lib/desk/http";
import { mapDeskError } from "@/lib/desk/route-errors";
import {
  transformSpeakMessage,
} from "@/lib/desk/speaks-transform";
import { GREENWOOD_FIRE_MESSAGE_MAX_CHARS } from "@/lib/greenwood/fire-message";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z
  .object({
    message: z.string().max(GREENWOOD_FIRE_MESSAGE_MAX_CHARS),
  })
  .strict();

/**
 * POST /api/desk/speaks/transform
 * AI-assisted voice reshape only. Never publishes or writes fire messages.
 */
export async function POST(request: Request) {
  try {
    await requireFennDeskAccess(request);

    let json: unknown;
    try {
      json = await request.json();
    } catch {
      return deskJson(
        { ok: false, error: "Invalid request", code: "invalid_json" },
        { status: 400 },
      );
    }

    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return deskJson(
        { ok: false, error: "Invalid message body", code: "invalid_body" },
        { status: 400 },
      );
    }

    const result = await transformSpeakMessage(parsed.data.message);
    return deskJson({
      ok: true,
      transformedMessage: result.transformedMessage,
    });
  } catch (error) {
    return mapDeskError(error, "POST /api/desk/speaks/transform");
  }
}
