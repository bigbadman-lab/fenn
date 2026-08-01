import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Append-only admin_audit_log write for trusted server paths.
 * Actor identity must already be resolved via requireFennAdmin.
 */
export async function writeAdminAuditLog(
  admin: SupabaseClient,
  input: {
    actorId: string;
    action: string;
    entityType: string;
    entityId: string;
    beforeState?: Record<string, unknown> | null;
    afterState?: Record<string, unknown> | null;
    reason?: string | null;
  },
): Promise<void> {
  const { error } = await admin.from("admin_audit_log").insert({
    actor_id: input.actorId,
    actor_type: "admin",
    action: input.action,
    entity_type: input.entityType,
    entity_id: input.entityId,
    before_state: input.beforeState ?? null,
    after_state: input.afterState ?? null,
    reason: input.reason ?? null,
  });

  if (error) {
    throw new Error(`Failed to write admin audit log: ${error.message}`);
  }
}
