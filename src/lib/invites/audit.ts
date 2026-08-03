import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin";

/**
 * System-path audit (Outlaw Invite). actor_type = system.
 * Failures are non-fatal for callers that catch.
 */
export async function writeInviteAuditLog(
  admin: SupabaseClient | undefined,
  input: {
    action: string;
    entityType: string;
    entityId: string;
    afterState?: Record<string, unknown> | null;
    reason?: string | null;
  },
): Promise<void> {
  const db = admin ?? createAdminClient();
  const { error } = await db.from("admin_audit_log").insert({
    actor_id: "outlaw_invite",
    actor_type: "system",
    action: input.action,
    entity_type: input.entityType,
    entity_id: input.entityId,
    before_state: null,
    after_state: input.afterState ?? null,
    reason: input.reason ?? null,
  });

  if (error) {
    throw new Error(`Failed to write invite audit log: ${error.message}`);
  }
}
