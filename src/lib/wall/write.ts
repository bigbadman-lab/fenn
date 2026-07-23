import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { WallError } from "@/lib/wall/errors";
import { toPublicWallEntry } from "@/lib/wall/read";
import type {
  WallSourceType,
  WriteFennWallEntryInput,
  WriteFennWallEntryResult,
} from "@/lib/wall/types";
import {
  WALL_BODY_MAX_CHARS,
  WALL_SOURCE_EXTERNAL_ID_MAX_CHARS,
  WALL_SOURCE_TYPES,
} from "@/lib/wall/types";

type WallEntryRow = {
  id: string;
  body: string;
  created_at: string;
  source_type: string;
  source_external_id: string | null;
};

async function defaultAdmin(): Promise<SupabaseClient> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return createAdminClient();
}

function isUniqueViolation(error: { code?: string; message?: string }): boolean {
  return (
    error.code === "23505" ||
    Boolean(error.message?.toLowerCase().includes("duplicate key"))
  );
}

function isWallSourceType(value: string): value is WallSourceType {
  return (WALL_SOURCE_TYPES as readonly string[]).includes(value);
}

/**
 * Validate write input.
 * Emptiness uses trim(); stored body keeps intentional whitespace/newlines.
 */
export function validateWriteFennWallEntryInput(
  input: WriteFennWallEntryInput,
): {
  body: string;
  sourceType: WallSourceType;
  sourceExternalId: string | null;
} {
  if (typeof input.body !== "string") {
    throw new WallError(
      "wall_invalid_body",
      "Wall body must be a string",
      400,
    );
  }

  if (input.body.trim().length === 0) {
    throw new WallError(
      "wall_invalid_body",
      "Wall body must not be empty",
      400,
    );
  }

  if (input.body.length > WALL_BODY_MAX_CHARS) {
    throw new WallError(
      "wall_invalid_body",
      `Wall body must be at most ${WALL_BODY_MAX_CHARS} characters`,
      400,
    );
  }

  if (!isWallSourceType(input.sourceType)) {
    throw new WallError(
      "wall_invalid_source",
      "Invalid Wall source type",
      400,
    );
  }

  let sourceExternalId: string | null = null;
  if (input.sourceExternalId != null) {
    if (typeof input.sourceExternalId !== "string") {
      throw new WallError(
        "wall_invalid_source",
        "Wall sourceExternalId must be a string",
        400,
      );
    }
    const trimmed = input.sourceExternalId.trim();
    if (trimmed.length === 0) {
      throw new WallError(
        "wall_invalid_source",
        "Wall sourceExternalId must not be blank",
        400,
      );
    }
    if (trimmed.length > WALL_SOURCE_EXTERNAL_ID_MAX_CHARS) {
      throw new WallError(
        "wall_invalid_source",
        `Wall sourceExternalId must be at most ${WALL_SOURCE_EXTERNAL_ID_MAX_CHARS} characters`,
        400,
      );
    }
    sourceExternalId = trimmed;
  }

  return {
    body: input.body,
    sourceType: input.sourceType,
    sourceExternalId,
  };
}

async function findByProvenance(
  admin: SupabaseClient,
  sourceType: WallSourceType,
  sourceExternalId: string,
): Promise<WallEntryRow | null> {
  const { data, error } = await admin
    .from("wall_entries")
    .select("id, body, created_at, source_type, source_external_id")
    .eq("source_type", sourceType)
    .eq("source_external_id", sourceExternalId)
    .maybeSingle();

  if (error) {
    throw new WallError(
      "wall_read_failed",
      "Failed to look up Wall provenance",
      500,
    );
  }

  return (data as WallEntryRow | null) ?? null;
}

function resolveIdempotentExisting(
  existing: WallEntryRow,
  body: string,
): WriteFennWallEntryResult {
  if (existing.body !== body) {
    throw new WallError(
      "wall_idempotency_conflict",
      "Wall provenance already used with a different body",
      409,
    );
  }
  return {
    created: false,
    entry: toPublicWallEntry(existing),
  };
}

/**
 * Trusted FENN Wall write — service-role / server-only.
 * Callers never supply id, author, or createdAt.
 * External provenance retries are idempotent and never overwrite body.
 */
export async function writeFennWallEntry(
  input: WriteFennWallEntryInput,
  admin?: SupabaseClient,
): Promise<WriteFennWallEntryResult> {
  const db = admin ?? (await defaultAdmin());
  const validated = validateWriteFennWallEntryInput(input);

  if (validated.sourceExternalId != null) {
    const existing = await findByProvenance(
      db,
      validated.sourceType,
      validated.sourceExternalId,
    );
    if (existing) {
      return resolveIdempotentExisting(existing, validated.body);
    }
  }

  const { data, error } = await db
    .from("wall_entries")
    .insert({
      body: validated.body,
      source_type: validated.sourceType,
      source_external_id: validated.sourceExternalId,
    })
    .select("id, body, created_at, source_type, source_external_id")
    .single();

  if (error) {
    if (isUniqueViolation(error) && validated.sourceExternalId != null) {
      const raced = await findByProvenance(
        db,
        validated.sourceType,
        validated.sourceExternalId,
      );
      if (raced) {
        return resolveIdempotentExisting(raced, validated.body);
      }
    }
    throw new WallError(
      "wall_write_failed",
      "Failed to write Wall entry",
      500,
    );
  }

  return {
    created: true,
    entry: toPublicWallEntry(data as WallEntryRow),
  };
}
