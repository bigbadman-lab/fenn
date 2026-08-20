import "server-only";

import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { writeAdminAuditLog } from "@/lib/admin/audit";
import { createAdminClient } from "@/lib/supabase/admin";
import { WallError } from "@/lib/wall/errors";
import type { PublicWallEntry } from "@/lib/wall/types";
import { WALL_BODY_MAX_CHARS } from "@/lib/wall/types";
import { writeFennWallEntry } from "@/lib/wall/write";

export type DeskWallInscribeResult = {
  created: boolean;
  entry: PublicWallEntry;
  wallPath: string;
};

/**
 * Plain-text hygiene for Desk → Wall inscriptions.
 * Same constraints as deed share-to-wall; throws WallError for mapDeskError.
 */
export function validateDeskWallInscriptionBody(body: string): string {
  if (typeof body !== "string") {
    throw new WallError("wall_invalid_body", "body must be a string", 422);
  }
  const trimmed = body.trim();
  if (trimmed.length === 0) {
    throw new WallError("wall_invalid_body", "body is required", 422);
  }
  if (trimmed.length > WALL_BODY_MAX_CHARS) {
    throw new WallError(
      "wall_invalid_body",
      `body must be at most ${WALL_BODY_MAX_CHARS} characters`,
      422,
    );
  }
  if (/[<>]/.test(trimmed)) {
    throw new WallError(
      "wall_invalid_body",
      "body must not contain HTML markup",
      422,
    );
  }
  for (let i = 0; i < trimmed.length; i += 1) {
    const code = trimmed.charCodeAt(i);
    if (
      code === 0x7f ||
      (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d)
    ) {
      throw new WallError(
        "wall_invalid_body",
        "body contains invalid control characters",
        422,
      );
    }
  }
  return trimmed;
}

export function deskManualWallSourceExternalId(id = randomUUID()): string {
  return `desk:manual:${id}`;
}

/**
 * Keeper-authored Wall inscription. Appears publicly as VELL writing.
 * Uses trusted writeFennWallEntry only — never client/direct table inserts.
 */
export async function deskInscribeWall(input: {
  body: string;
  actorId: string;
  admin?: SupabaseClient;
}): Promise<DeskWallInscribeResult> {
  const body = validateDeskWallInscriptionBody(input.body);
  const db = input.admin ?? createAdminClient();
  const sourceExternalId = deskManualWallSourceExternalId();

  const result = await writeFennWallEntry(
    {
      body,
      sourceType: "system",
      sourceExternalId,
    },
    db,
  );

  await writeAdminAuditLog(db, {
    actorId: input.actorId,
    action: "desk_wall_inscribe",
    entityType: "wall_entry",
    entityId: result.entry.id,
    afterState: {
      created: result.created,
      sourceType: "system",
      sourceExternalId,
      bodyLength: body.length,
    },
  });

  return {
    created: result.created,
    entry: result.entry,
    wallPath: "/wall",
  };
}
