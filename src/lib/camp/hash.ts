import { createHash } from "node:crypto";

import type { CampCharacterSlug } from "@/lib/camp/types";

const CLIENT_MESSAGE_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isCampClientMessageId(value: string): boolean {
  return CLIENT_MESSAGE_ID_RE.test(value.trim());
}

function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/**
 * Deterministic request hashes for (session, clientMessageId).
 * User and assistant rows share the same attempt identity via distinct prefixes.
 */
export function campRequestHashes(input: {
  profileId: string;
  sessionId: string;
  clientMessageId: string;
}): { userHash: string; assistantHash: string } {
  const id = input.clientMessageId.trim();
  const base = `camp:v1:${input.profileId}:${input.sessionId}:${id}`;
  return {
    userHash: sha256Hex(`${base}:user`),
    assistantHash: sha256Hex(`${base}:assistant`),
  };
}

export function isCampCharacterSlugParam(
  value: string,
): value is CampCharacterSlug {
  return value === "fenn" || value === "wren" || value === "rook";
}
