/**
 * Model-facing economic intention types (Stage P1B / P1C).
 * These are advice to authority — never executable payloads as-is.
 *
 * P1C: model proposes magnitude via proposedAmount (decimal string).
 * Model never sets recipient address, token, chain, rail, or burn destination.
 */

import { parseEconomicProposedAmount } from "@/lib/agent/economic-amount";

export const ECONOMIC_ACTION_TYPES = [
  "NONE",
  "transfer_fenn",
  "burn_fenn",
] as const;

export type EconomicActionTypeName = (typeof ECONOMIC_ACTION_TYPES)[number];

/** Only trusted source the model may claim for transfer recipients. */
export const ECONOMIC_RECIPIENT_SOURCES = [
  "trusted_profile_wallet",
] as const;

export type EconomicRecipientSource =
  (typeof ECONOMIC_RECIPIENT_SOURCES)[number];

export const ECONOMIC_REASON_MAX_CHARS = 280;

/** Model-emitted economic intention (pre-authority). */
export type ModelEconomicAction =
  | { type: "NONE" }
  | {
      type: "transfer_fenn";
      proposedAmount: string;
      reason: string;
      recipientSource: EconomicRecipientSource;
    }
  | {
      type: "burn_fenn";
      proposedAmount: string;
      reason: string;
    };

/** Normalized / persisted economic intent (final judge → authority). */
export type FinalEconomicIntent =
  | { type: "NONE" }
  | {
      type: "transfer_fenn";
      proposedAmount: string;
      reason: string;
      recipientSource: EconomicRecipientSource;
    }
  | {
      type: "burn_fenn";
      proposedAmount: string;
      reason: string;
    };

/**
 * Forbidden control fields from the model.
 * proposedAmount is the only quantity field allowed (P1C).
 * amount / amountFormatted remain forbidden — those are execution fields.
 */
const FORBIDDEN_MODEL_ECONOMIC_KEYS = [
  "amount",
  "amountFormatted",
  "recipientAddress",
  "recipient",
  "to",
  "token",
  "tokenAddress",
  "chain",
  "chainId",
  "calldata",
  "data",
  "burnAddress",
  "deadAddress",
  "executionRail",
  "privateKey",
  "secret",
] as const;

/**
 * Parse model economicAction. Rejects financial control fields.
 * Malformed input → NONE (fail closed on spending; speech separate).
 * Invalid amount on transfer/burn throws (caller maps to NONE).
 */
export function normalizeModelEconomicAction(
  raw: unknown,
): FinalEconomicIntent {
  if (raw == null || raw === "NONE" || raw === "none") {
    return { type: "NONE" };
  }
  if (typeof raw === "string" && raw.trim().toUpperCase() === "NONE") {
    return { type: "NONE" };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { type: "NONE" };
  }
  const o = raw as Record<string, unknown>;
  for (const key of FORBIDDEN_MODEL_ECONOMIC_KEYS) {
    if (key in o && o[key] != null && o[key] !== "") {
      throw new Error(`economic_forbidden_field:${key}`);
    }
  }

  const typeRaw = typeof o.type === "string" ? o.type.trim() : "";
  if (typeRaw === "NONE" || typeRaw === "") {
    return { type: "NONE" };
  }

  const reason =
    typeof o.reason === "string"
      ? o.reason.trim().slice(0, ECONOMIC_REASON_MAX_CHARS)
      : "";

  if (typeRaw === "transfer_fenn") {
    const source =
      typeof o.recipientSource === "string" ? o.recipientSource.trim() : "";
    if (source !== "trusted_profile_wallet") {
      throw new Error("economic_invalid_recipient_source");
    }
    if (!reason) {
      throw new Error("economic_reason_required");
    }
    const proposedAmount = parseEconomicProposedAmount(o.proposedAmount);
    return {
      type: "transfer_fenn",
      proposedAmount,
      reason,
      recipientSource: "trusted_profile_wallet",
    };
  }

  if (typeRaw === "burn_fenn") {
    if (!reason) {
      throw new Error("economic_reason_required");
    }
    const proposedAmount = parseEconomicProposedAmount(o.proposedAmount);
    return { type: "burn_fenn", proposedAmount, reason };
  }

  throw new Error("economic_invalid_type");
}

/** Persist shape — includes proposed amount, never addresses/keys. */
export function economicIntentToJson(
  intent: FinalEconomicIntent,
): Record<string, unknown> {
  if (intent.type === "NONE") {
    return { type: "NONE" };
  }
  if (intent.type === "transfer_fenn") {
    return {
      type: "transfer_fenn",
      proposedAmount: intent.proposedAmount,
      reason: intent.reason,
      recipientSource: intent.recipientSource,
    };
  }
  return {
    type: "burn_fenn",
    proposedAmount: intent.proposedAmount,
    reason: intent.reason,
  };
}

export function economicIntentFromJson(
  raw: unknown,
): FinalEconomicIntent {
  try {
    return normalizeModelEconomicAction(raw);
  } catch {
    return { type: "NONE" };
  }
}
