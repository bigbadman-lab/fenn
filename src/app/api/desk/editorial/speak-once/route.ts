import { z } from "zod";

import { requireFennDeskAccess } from "@/lib/desk/auth";
import { deskJson } from "@/lib/desk/http";
import { mapDeskError } from "@/lib/desk/route-errors";
import { speakOnceForKeeper } from "@/lib/editorial";
import { EDITORIAL_KEEPER_CONTEXT_MAX_CHARS } from "@/lib/editorial/types";

/** Single Keeper-directed transmission; model-bound. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const bodySchema = z.object({
  keeperContext: z
    .string()
    .trim()
    .min(1, "Keeper context is required")
    .max(EDITORIAL_KEEPER_CONTEXT_MAX_CHARS),
});

/**
 * Generate exactly one FENN transmission from Keeper situational context.
 * No package persistence. No automatic posting.
 */
export async function POST(request: Request) {
  try {
    await requireFennDeskAccess(request);
    const json = await request.json().catch(() => null);
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      const message =
        parsed.error.issues[0]?.message === "Required" ||
        parsed.error.issues[0]?.code === "invalid_type"
          ? "keeperContext is required"
          : parsed.error.issues[0]?.message ?? "Invalid request";
      return deskJson({ ok: false, error: message }, { status: 400 });
    }

    const result = await speakOnceForKeeper({
      keeperContext: parsed.data.keeperContext,
    });

    return deskJson({
      ok: true,
      transmission: {
        mode: result.transmission.mode,
        category: result.transmission.category,
        title: result.transmission.title,
        body: result.transmission.body,
        operatorRationale: result.transmission.operatorRationale,
        sourceSignals: result.transmission.sourceSignals,
        confidence: result.transmission.confidence,
        grounded: result.transmission.grounded,
      },
      recoveryUsed: result.recoveryUsed,
    });
  } catch (error) {
    return mapDeskError(error, "POST /api/desk/editorial/speak-once");
  }
}
