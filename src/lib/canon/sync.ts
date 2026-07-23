import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  listFennCanonDocuments,
  type FennCanonDocument,
  type FennCanonVisibility,
} from "@/content/canon";
import { CanonError } from "@/lib/canon/errors";

/** Trusted system actor for Canon ingestion — not a user moderation path. */
export const CANON_SYNC_ACTOR_ID = "system:canon-sync" as const;

export const CANON_METADATA_KEY = "canon_key" as const;

export type SyncFennCanonResult = {
  inserted: number;
  updated: number;
  unchanged: number;
  deactivated: number;
  activeKeys: string[];
};

type MemoryRow = {
  id: string;
  layer: string;
  title: string | null;
  content: string;
  is_active: boolean;
  visibility: string;
  metadata: Record<string, unknown> | null;
  source_candidate_id: string | null;
  source_message_id: string | null;
  source_profile_id: string | null;
  approved_at: string | null;
  approved_by_actor_id: string | null;
};

/** Public-safe Canon document shape — no provenance FKs. */
export type PublicCanonMemory = {
  id: string;
  key: string;
  title: string | null;
  content: string;
  visibility: FennCanonVisibility;
  isActive: boolean;
  approvedAt: string | null;
};

async function defaultAdmin(): Promise<SupabaseClient> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return createAdminClient();
}

function canonKeyFromMetadata(
  metadata: Record<string, unknown> | null,
): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  const key = metadata[CANON_METADATA_KEY];
  return typeof key === "string" && key.trim().length > 0 ? key.trim() : null;
}

function buildCanonMetadata(
  doc: FennCanonDocument,
  previous: Record<string, unknown> | null,
): Record<string, unknown> {
  return {
    ...(previous && typeof previous === "object" ? previous : {}),
    [CANON_METADATA_KEY]: doc.key,
    canon_synced_at: new Date().toISOString(),
  };
}

function isVisibility(value: string): value is FennCanonVisibility {
  return value === "public" || value === "camp" || value === "internal";
}

function toPublicCanonMemory(row: MemoryRow): PublicCanonMemory | null {
  const key = canonKeyFromMetadata(row.metadata);
  if (!key) return null;
  if (!isVisibility(row.visibility)) return null;
  return {
    id: row.id,
    key,
    title: row.title,
    content: row.content,
    visibility: row.visibility,
    isActive: row.is_active,
    approvedAt: row.approved_at,
  };
}

async function listCanonRows(admin: SupabaseClient): Promise<MemoryRow[]> {
  const { data, error } = await admin
    .from("fenn_memories")
    .select(
      "id, layer, title, content, is_active, visibility, metadata, source_candidate_id, source_message_id, source_profile_id, approved_at, approved_by_actor_id",
    )
    .eq("layer", "canon");

  if (error) {
    throw new CanonError(
      "canon_read_failed",
      "Failed to load Canon memories",
      500,
    );
  }
  return (data ?? []) as MemoryRow[];
}

/**
 * Synchronise repository Canon into fenn_memories(layer=canon).
 * Trusted server/ops only. Idempotent. Never hard-deletes removed docs.
 */
export async function syncFennCanon(
  admin?: SupabaseClient,
): Promise<SyncFennCanonResult> {
  const db = admin ?? (await defaultAdmin());
  const corpus = listFennCanonDocuments();
  const corpusKeys = new Set(corpus.map((doc) => doc.key));

  const existing = await listCanonRows(db);
  const byKey = new Map<string, MemoryRow>();
  for (const row of existing) {
    const key = canonKeyFromMetadata(row.metadata);
    if (key) byKey.set(key, row);
  }

  let inserted = 0;
  let updated = 0;
  let unchanged = 0;
  let deactivated = 0;

  for (const doc of corpus) {
    const found = byKey.get(doc.key);
    if (!found) {
      const { error } = await db.from("fenn_memories").insert({
        layer: "canon",
        title: doc.title,
        content: doc.content,
        visibility: doc.visibility,
        is_active: true,
        source_candidate_id: null,
        source_message_id: null,
        source_profile_id: null,
        approved_at: new Date().toISOString(),
        approved_by_actor_id: CANON_SYNC_ACTOR_ID,
        metadata: buildCanonMetadata(doc, null),
      });
      if (error) {
        throw new CanonError(
          "canon_sync_failed",
          `Failed to insert Canon ${doc.key}`,
          500,
        );
      }
      inserted += 1;
      continue;
    }

    const sameContent =
      found.title === doc.title &&
      found.content === doc.content &&
      found.visibility === doc.visibility &&
      found.is_active === true;

    if (sameContent) {
      unchanged += 1;
      continue;
    }

    const { error } = await db
      .from("fenn_memories")
      .update({
        title: doc.title,
        content: doc.content,
        visibility: doc.visibility,
        is_active: true,
        source_candidate_id: null,
        source_message_id: null,
        source_profile_id: null,
        approved_by_actor_id: CANON_SYNC_ACTOR_ID,
        approved_at: found.approved_at ?? new Date().toISOString(),
        metadata: buildCanonMetadata(doc, found.metadata),
      })
      .eq("id", found.id);

    if (error) {
      throw new CanonError(
        "canon_sync_failed",
        `Failed to update Canon ${doc.key}`,
        500,
      );
    }
    updated += 1;
  }

  for (const [key, row] of byKey) {
    if (corpusKeys.has(key)) continue;
    if (!row.is_active) continue;

    const { error } = await db
      .from("fenn_memories")
      .update({
        is_active: false,
        metadata: {
          ...(row.metadata && typeof row.metadata === "object"
            ? row.metadata
            : {}),
          canon_deactivated_at: new Date().toISOString(),
          canon_deactivated_by: CANON_SYNC_ACTOR_ID,
        },
      })
      .eq("id", row.id);

    if (error) {
      throw new CanonError(
        "canon_sync_failed",
        `Failed to deactivate Canon ${key}`,
        500,
      );
    }
    deactivated += 1;
  }

  return {
    inserted,
    updated,
    unchanged,
    deactivated,
    activeKeys: [...corpusKeys].sort(),
  };
}

/**
 * Privileged read of active Canon rows as public-safe DTOs.
 * For tests / future retrieval — never exposes provenance FKs.
 */
export async function listActiveCanonMemories(
  admin?: SupabaseClient,
): Promise<PublicCanonMemory[]> {
  const db = admin ?? (await defaultAdmin());
  const rows = await listCanonRows(db);
  return rows
    .filter((row) => row.is_active)
    .map(toPublicCanonMemory)
    .filter((row): row is PublicCanonMemory => row != null)
    .sort((a, b) => a.key.localeCompare(b.key));
}
