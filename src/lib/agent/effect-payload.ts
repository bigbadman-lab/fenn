import { STAGE12_X_REPLY_MAX_CHARS } from "@/lib/agent/judge-config";
import { stage12WallSourceExternalId } from "@/lib/wall/stage12-tool-contract";
import { WALL_BODY_MAX_CHARS } from "@/lib/wall/types";
import { P0_MANUAL_TRANSFER_AMOUNT_FORMATTED } from "@/lib/purse/constants";
import {
  isNormalizedEvmAddress,
  parseEvmAddress,
} from "@/lib/wallet/evm";

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

/**
 * P1A transfer_fenn payload after fail-closed validation.
 * Token/chain/key/calldata never accepted.
 */
export type ValidatedTransferFennPayload = {
  recipientAddress: string;
  amountFormatted: "1";
  /**
   * Explicit rail. Only `"p1a_test"` uses disposable-token test settlement.
   * Absent/official paths use official FENN only.
   */
  executionRail: "p1a_test" | "official";
};

/**
 * P1A.1 burn_fenn payload — no recipient (dead address is code-owned).
 */
export type ValidatedBurnFennPayload = {
  amountFormatted: "1";
  executionRail: "p1a_test" | "official";
};

/** Strict allowed value enabling disposable-token rail. */
export const TRANSFER_FENN_P1A_TEST_RAIL = "p1a_test" as const;

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

/**
 * Fail-closed validation for transfer_fenn at the Stage 12.6 boundary.
 * Rejects token/chain/calldata and any amount other than exactly "1".
 */
export function validateTransferFennEffectPayload(
  payload: unknown,
): ValidatedTransferFennPayload {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("invalid_transfer_payload");
  }
  const p = payload as Record<string, unknown>;

  // Hard rejections — never accept model/operator supply of these fields.
  if ("tokenAddress" in p && p.tokenAddress != null && p.tokenAddress !== "") {
    throw new Error("transfer_token_forbidden");
  }
  if ("token" in p && p.token != null && p.token !== "") {
    throw new Error("transfer_token_forbidden");
  }
  if ("chainId" in p && p.chainId != null && p.chainId !== "") {
    throw new Error("transfer_chain_forbidden");
  }
  if ("chain" in p && p.chain != null && p.chain !== "") {
    throw new Error("transfer_chain_forbidden");
  }
  if ("calldata" in p && p.calldata != null && p.calldata !== "") {
    throw new Error("transfer_calldata_forbidden");
  }
  if ("data" in p && p.data != null && p.data !== "") {
    throw new Error("transfer_calldata_forbidden");
  }
  if ("privateKey" in p || "secret" in p) {
    throw new Error("transfer_secret_forbidden");
  }

  const amountRaw =
    typeof p.amountFormatted === "string"
      ? p.amountFormatted
      : typeof p.amount === "string"
        ? p.amount
        : "";
  if (amountRaw.trim() !== P0_MANUAL_TRANSFER_AMOUNT_FORMATTED) {
    throw new Error("transfer_amount_not_fixed");
  }

  const recipientRaw =
    typeof p.recipientAddress === "string"
      ? p.recipientAddress
      : typeof p.recipient === "string"
        ? p.recipient
        : "";

  let recipientAddress: string;
  try {
    recipientAddress = parseEvmAddress(recipientRaw);
  } catch {
    throw new Error("transfer_invalid_recipient");
  }
  if (!isNormalizedEvmAddress(recipientAddress)) {
    throw new Error("transfer_invalid_recipient");
  }

  const railRaw =
    typeof p.executionRail === "string" ? p.executionRail.trim() : "";
  let executionRail: "p1a_test" | "official";
  if (railRaw === "" || railRaw === "official") {
    executionRail = "official";
  } else if (railRaw === TRANSFER_FENN_P1A_TEST_RAIL) {
    executionRail = "p1a_test";
  } else {
    throw new Error("transfer_execution_rail_invalid");
  }

  return {
    recipientAddress,
    amountFormatted: P0_MANUAL_TRANSFER_AMOUNT_FORMATTED,
    executionRail,
  };
}

function parseExecutionRail(
  p: Record<string, unknown>,
  invalidCode: string,
): "p1a_test" | "official" {
  const railRaw =
    typeof p.executionRail === "string" ? p.executionRail.trim() : "";
  if (railRaw === "" || railRaw === "official") {
    return "official";
  }
  if (railRaw === TRANSFER_FENN_P1A_TEST_RAIL) {
    return "p1a_test";
  }
  throw new Error(invalidCode);
}

/**
 * Fail-closed validation for burn_fenn at the Stage 12.6 boundary.
 * Destination is the canonical dead address in server code only — never payload.
 */
export function validateBurnFennEffectPayload(
  payload: unknown,
): ValidatedBurnFennPayload {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("invalid_burn_payload");
  }
  const p = payload as Record<string, unknown>;

  if ("recipientAddress" in p && p.recipientAddress != null && p.recipientAddress !== "") {
    throw new Error("burn_recipient_forbidden");
  }
  if ("recipient" in p && p.recipient != null && p.recipient !== "") {
    throw new Error("burn_recipient_forbidden");
  }
  if ("to" in p && p.to != null && p.to !== "") {
    throw new Error("burn_recipient_forbidden");
  }
  if ("burnAddress" in p && p.burnAddress != null && p.burnAddress !== "") {
    throw new Error("burn_address_override_forbidden");
  }
  if ("deadAddress" in p && p.deadAddress != null && p.deadAddress !== "") {
    throw new Error("burn_address_override_forbidden");
  }
  if ("tokenAddress" in p && p.tokenAddress != null && p.tokenAddress !== "") {
    throw new Error("burn_token_forbidden");
  }
  if ("token" in p && p.token != null && p.token !== "") {
    throw new Error("burn_token_forbidden");
  }
  if ("chainId" in p && p.chainId != null && p.chainId !== "") {
    throw new Error("burn_chain_forbidden");
  }
  if ("chain" in p && p.chain != null && p.chain !== "") {
    throw new Error("burn_chain_forbidden");
  }
  if ("calldata" in p && p.calldata != null && p.calldata !== "") {
    throw new Error("burn_calldata_forbidden");
  }
  if ("data" in p && p.data != null && p.data !== "") {
    throw new Error("burn_calldata_forbidden");
  }
  if ("privateKey" in p || "secret" in p) {
    throw new Error("burn_secret_forbidden");
  }

  const amountRaw =
    typeof p.amountFormatted === "string"
      ? p.amountFormatted
      : typeof p.amount === "string"
        ? p.amount
        : "";
  if (amountRaw.trim() !== P0_MANUAL_TRANSFER_AMOUNT_FORMATTED) {
    throw new Error("burn_amount_not_fixed");
  }

  const executionRail = parseExecutionRail(p, "burn_execution_rail_invalid");

  return {
    amountFormatted: P0_MANUAL_TRANSFER_AMOUNT_FORMATTED,
    executionRail,
  };
}
