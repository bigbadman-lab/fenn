/**
 * Postgres-backed global lease for the X agent cron.
 * Never use an in-memory mutex — processes do not share memory.
 */

import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { randomUUID } from "node:crypto";

type AdminLike = {
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
};

export type AcquireRuntimeLeaseResult =
  | { acquired: true; holderId: string; leaseKey: string }
  | { acquired: false; holderId: string; leaseKey: string; reason: "busy" };

export type RuntimeLeaseDeps = {
  admin?: AdminLike;
  /** Injected for tests. */
  newHolderId?: () => string;
};

function asBool(data: unknown): boolean {
  if (typeof data === "boolean") return data;
  if (Array.isArray(data) && data.length === 1) {
    return asBool(data[0]);
  }
  if (data && typeof data === "object" && "try_acquire_ops_runtime_lease" in data) {
    return asBool(
      (data as { try_acquire_ops_runtime_lease: unknown })
        .try_acquire_ops_runtime_lease,
    );
  }
  return false;
}

export function createRuntimeLeaseHolderId(): string {
  return `${randomUUID()}:${process.pid}`;
}

/**
 * Try to acquire the global runtime lease. Returns busy when another hold is active.
 */
export async function tryAcquireOpsRuntimeLease(
  options: {
    leaseKey: string;
    ttlSeconds: number;
    holderId?: string;
  },
  deps: RuntimeLeaseDeps = {},
): Promise<AcquireRuntimeLeaseResult> {
  const admin = deps.admin ?? (createAdminClient() as unknown as AdminLike);
  const holderId =
    options.holderId ??
    (deps.newHolderId ? deps.newHolderId() : createRuntimeLeaseHolderId());
  const leaseKey = options.leaseKey.trim();

  const { data, error } = await admin.rpc("try_acquire_ops_runtime_lease", {
    p_lease_key: leaseKey,
    p_holder_id: holderId,
    p_ttl_seconds: Math.max(1, Math.floor(options.ttlSeconds)),
  });

  if (error) {
    throw new Error(`ops_runtime_lease_acquire_failed: ${error.message}`);
  }

  if (asBool(data)) {
    return { acquired: true, holderId, leaseKey };
  }

  return { acquired: false, holderId, leaseKey, reason: "busy" };
}

/**
 * Release only when this holder still owns the lease.
 */
export async function releaseOpsRuntimeLease(
  options: { leaseKey: string; holderId: string },
  deps: RuntimeLeaseDeps = {},
): Promise<boolean> {
  const admin = deps.admin ?? (createAdminClient() as unknown as AdminLike);
  const { data, error } = await admin.rpc("release_ops_runtime_lease", {
    p_lease_key: options.leaseKey.trim(),
    p_holder_id: options.holderId,
  });

  if (error) {
    throw new Error(`ops_runtime_lease_release_failed: ${error.message}`);
  }

  return asBool(data);
}
