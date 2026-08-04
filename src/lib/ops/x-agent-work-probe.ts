/**
 * Cheap queue probes — no OpenAI, no X HTTP. DB existence checks only.
 */

import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

type AdminLike = {
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
};

export type XAgentWorkProbe = {
  pendingPerceptions: boolean;
  pendingSight: boolean;
  pendingAuthority: boolean;
  pendingEffects: boolean;
  hasWork: boolean;
};

export type WorkProbeDeps = {
  admin?: AdminLike;
};

function asBool(value: unknown): boolean {
  return value === true;
}

function parseProbeRow(row: Record<string, unknown>): XAgentWorkProbe {
  const pendingPerceptions = asBool(row.pending_perceptions);
  const pendingSight = asBool(row.pending_sight);
  const pendingAuthority = asBool(row.pending_authority);
  const pendingEffects = asBool(row.pending_effects);
  const hasWork =
    asBool(row.has_work) ||
    pendingPerceptions ||
    pendingSight ||
    pendingAuthority ||
    pendingEffects;
  return {
    pendingPerceptions,
    pendingSight,
    pendingAuthority,
    pendingEffects,
    hasWork,
  };
}

/**
 * Probe whether any internal queue stage may have work.
 * Does not call OpenAI or X.
 */
export async function probeXAgentInternalWork(
  deps: WorkProbeDeps = {},
): Promise<XAgentWorkProbe> {
  const admin = deps.admin ?? (createAdminClient() as unknown as AdminLike);
  const { data, error } = await admin.rpc("probe_x_agent_internal_work");

  if (error) {
    throw new Error(`work_probe_failed: ${error.message}`);
  }

  if (Array.isArray(data) && data.length > 0 && data[0] && typeof data[0] === "object") {
    return parseProbeRow(data[0] as Record<string, unknown>);
  }

  if (data && typeof data === "object" && !Array.isArray(data)) {
    return parseProbeRow(data as Record<string, unknown>);
  }

  return {
    pendingPerceptions: false,
    pendingSight: false,
    pendingAuthority: false,
    pendingEffects: false,
    hasWork: false,
  };
}
