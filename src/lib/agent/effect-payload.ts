import { STAGE12_X_REPLY_MAX_CHARS } from "@/lib/agent/judge-config";
import { stage12WallSourceExternalId } from "@/lib/wall/stage12-tool-contract";
import { WALL_BODY_MAX_CHARS } from "@/lib/wall/types";

export type ValidatedReplyPayload = {
  replyToXPostId: string;
  text: string;
};

export type ValidatedWallPayload = {
  body: string;
  sourceType: "x_agent";
  sourceExternalId: string;
  /** Optional Stage 3 Chronicler memory link (application-owned). */
  chroniclerFactMemoryId: string | null;
};

function isDigitSnowflake(value: string): boolean {
  return /^\d+$/.test(value.trim());
}

function hasNulOrDangerousControls(text: string): boolean {
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code === 127) return true;
    if (code < 32 && code !== 9 && code !== 10 && code !== 13) return true;
  }
  return false;
}

/**
 * Re-validate Stage 12.5 reply payload at the execution boundary.
 * Uses application-owned fields only; rejects tampering.
 */
export function validateReplyEffectPayload(
  payload: unknown,
  expectedXPostId: string,
): ValidatedReplyPayload {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("invalid_reply_payload");
  }
  const p = payload as Record<string, unknown>;
  const replyTo =
    typeof p.replyToXPostId === "string" ? p.replyToXPostId.trim() : "";
  const text = typeof p.text === "string" ? p.text : "";

  if (!isDigitSnowflake(replyTo)) {
    throw new Error("invalid_reply_target");
  }
  if (replyTo !== expectedXPostId.trim()) {
    throw new Error("reply_target_mismatch");
  }
  if (text.trim().length === 0) {
    throw new Error("empty_reply_text");
  }
  if (text.length > STAGE12_X_REPLY_MAX_CHARS) {
    throw new Error("reply_text_too_long");
  }
  if (hasNulOrDangerousControls(text)) {
    throw new Error("reply_text_invalid_controls");
  }

  return { replyToXPostId: replyTo, text };
}

/**
 * Re-validate Stage 12.5 Wall payload at the execution boundary.
 * Provenance must match application-owned Stage 12 contract.
 */
export function validateWallEffectPayload(
  payload: unknown,
  expectedXPostId: string,
): ValidatedWallPayload {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("invalid_wall_payload");
  }
  const p = payload as Record<string, unknown>;
  const body = typeof p.body === "string" ? p.body : "";
  const sourceType = typeof p.sourceType === "string" ? p.sourceType : "";
  const sourceExternalId =
    typeof p.sourceExternalId === "string" ? p.sourceExternalId.trim() : "";

  const expectedExternalId = stage12WallSourceExternalId(expectedXPostId);

  if (sourceType !== "x_agent") {
    throw new Error("wall_source_type_tampered");
  }
  if (sourceExternalId !== expectedExternalId) {
    throw new Error("wall_source_external_id_tampered");
  }
  if (body.length === 0 || body.trim().length === 0) {
    throw new Error("empty_wall_body");
  }
  if (body.length > WALL_BODY_MAX_CHARS) {
    throw new Error("wall_body_too_long");
  }
  if (hasNulOrDangerousControls(body)) {
    throw new Error("wall_body_invalid_controls");
  }

  return {
    body,
    sourceType: "x_agent",
    sourceExternalId: expectedExternalId,
    chroniclerFactMemoryId:
      typeof p.chroniclerFactMemoryId === "string" &&
      p.chroniclerFactMemoryId.trim().length > 0
        ? p.chroniclerFactMemoryId.trim()
        : null,
  };
}
