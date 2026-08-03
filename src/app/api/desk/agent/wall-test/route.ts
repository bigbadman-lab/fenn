import { z } from "zod";

import { writeAdminAuditLog } from "@/lib/admin/audit";
import {
  DESK_WALL_TEST_VERSION,
  runDeskAgentWallTest,
} from "@/lib/agent/desk-wall-test";
import { requireFennDeskAccess } from "@/lib/desk/auth";
import { deskJson } from "@/lib/desk/http";
import { mapDeskError } from "@/lib/desk/route-errors";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bodySchema = z
  .object({
    /** Confirmation only — server owns the inscription and provenance. */
    confirm: z.literal(true),
  })
  .strict();

/**
 * Desk Wall-only agent effect test.
 * Creates / claims the reserved synthetic wall effect and writes via
 * writeFennWallEntry. Never posts to X. Never drains the open effect queue.
 */
export async function POST(request: Request) {
  try {
    const identity = await requireFennDeskAccess(request);
    const json = await request.json().catch(() => null);
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return deskJson(
        { ok: false, error: "confirm:true is required" },
        { status: 422 },
      );
    }

    const db = createAdminClient();

    await writeAdminAuditLog(db, {
      actorId: identity.actorId,
      action: "desk.agent.wall_test_requested",
      entityType: "x_perception_effects",
      entityId: `desk-wall-test:v${DESK_WALL_TEST_VERSION}`,
      afterState: {
        testVersion: DESK_WALL_TEST_VERSION,
        xAttempted: false,
      },
    });

    const result = await runDeskAgentWallTest({
      admin: db,
      actorId: identity.actorId,
    });

    if (!result.ok || result.status === "failed") {
      await writeAdminAuditLog(db, {
        actorId: identity.actorId,
        action: "desk.agent.wall_test_failed",
        entityType: "x_perception_effects",
        entityId: result.effectId ?? `desk-wall-test:v${DESK_WALL_TEST_VERSION}`,
        afterState: {
          testVersion: result.testVersion,
          status: result.status,
          errorCode: result.errorCode ?? "failed",
          xAttempted: false,
          durationMs: result.durationMs,
        },
      });
      return deskJson(
        {
          ok: false,
          status: "failed" as const,
          testVersion: result.testVersion,
          xAttempted: false as const,
        },
        { status: 500 },
      );
    }

    const auditAction =
      result.status === "already_present"
        ? "desk.agent.wall_test_idempotent"
        : "desk.agent.wall_test_completed";

    await writeAdminAuditLog(db, {
      actorId: identity.actorId,
      action: auditAction,
      entityType: "wall_entries",
      entityId: result.wallEntryId ?? `desk-wall-test:v${DESK_WALL_TEST_VERSION}`,
      afterState: {
        testVersion: result.testVersion,
        status: result.status,
        effectId: result.effectId ?? null,
        wallEntryId: result.wallEntryId ?? null,
        xAttempted: false,
        durationMs: result.durationMs,
      },
    });

    return deskJson({
      ok: true,
      status: result.status,
      wallEntryId: result.wallEntryId,
      effectId: result.effectId,
      testVersion: result.testVersion,
      xAttempted: false as const,
    });
  } catch (error) {
    return mapDeskError(error, "POST /api/desk/agent/wall-test");
  }
}
