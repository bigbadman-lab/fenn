/**
 * Stage 3 — Wall candidate schema parse/normalize (model output).
 * Invalid candidates become null; never wall-only.
 */

import { z } from "zod";

import {
  CHRONICLER_FACT_KEYS,
  CHRONICLER_REASONS,
  type WallCandidate,
} from "@/lib/agent/chronicler-types";
import type { PublicFactEvidence } from "@/lib/agent/public-fact-evidence";
import {
  buildChroniclerFingerprint,
  findTrustedFact,
} from "@/lib/agent/chronicler-significance";
import type { Stage12ResponseMode } from "@/lib/agent/response-mode";

/**
 * Explicit model Wall-candidate shapes (Stage 3).
 * Must stay OpenAI strict structured-output compatible — no z.unknown()/z.any().
 */
export const wallCandidateModelSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("public_fact"),
    factKey: z.enum(CHRONICLER_FACT_KEYS),
    factFingerprint: z.string().min(1).max(256),
    reason: z.enum(CHRONICLER_REASONS),
  }),
  z.object({
    kind: z.literal("declaration"),
    declarationKey: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[a-z0-9][a-z0-9_.-]{0,127}$/i),
    reason: z.enum(CHRONICLER_REASONS),
  }),
  z.object({
    kind: z.literal("historic_exchange"),
    reason: z.enum(CHRONICLER_REASONS),
  }),
]);

/**
 * Stage 12.3 / 12.4 response field: candidate or null (no wall).
 * Required+null preserves "optional wall" without empty JSON Schema from z.unknown().
 * Zod default null only applies client-side parse (fixtures); OpenAI still sees typed branches.
 */
export const stage12WallCandidateResponseFieldSchema =
  wallCandidateModelSchema.nullable().default(null);

const FORBIDDEN_CANDIDATE_SUBSTRINGS = [
  "select ",
  "insert ",
  "update ",
  "delete ",
  "from ",
  "wallet_address",
  "privy",
  "sourceExternalId",
  "source_external_id",
  "profile_id",
  "email",
] as const;

function blobSafe(value: unknown): boolean {
  const s = JSON.stringify(value).toLowerCase();
  for (const bad of FORBIDDEN_CANDIDATE_SUBSTRINGS) {
    if (s.includes(bad)) return false;
  }
  return true;
}

/**
 * Parse model wallCandidate. Returns null for missing/invalid (safe degrade).
 */
export function parseWallCandidateModelOutput(
  value: unknown,
): WallCandidate | null {
  if (value == null) return null;
  if (!blobSafe(value)) return null;
  const parsed = wallCandidateModelSchema.safeParse(value);
  if (!parsed.success) return null;
  return parsed.data;
}

/**
 * Normalize candidate against action, response mode, and trusted facts.
 * Never invents fingerprints. Null when invalid.
 */
export function normalizeWallCandidate(input: {
  raw: unknown;
  action: string;
  responseMode?: Stage12ResponseMode | null;
  trustedFacts?: readonly PublicFactEvidence[] | null;
}): WallCandidate | null {
  const candidate = parseWallCandidateModelOutput(input.raw);
  if (!candidate) return null;

  if (input.action !== "reply_and_write_to_wall") {
    return null;
  }

  if (candidate.kind === "public_fact") {
    // Reason for public facts must not be declaration/historic disguises alone;
    // significance evaluator will refine. Disallow constitutional/exceptional
    // on pure count facts.
    if (
      candidate.reason === "constitutional_declaration" ||
      candidate.reason === "exceptional_exchange"
    ) {
      return null;
    }
    const facts = input.trustedFacts ?? [];
    const evidence = findTrustedFact(facts, candidate.factKey);
    if (!evidence) return null;
    const expected = buildChroniclerFingerprint(evidence);
    if (!expected || expected !== candidate.factFingerprint.trim()) {
      return null;
    }
    return {
      kind: "public_fact",
      factKey: candidate.factKey,
      factFingerprint: expected,
      reason: candidate.reason,
    };
  }

  if (candidate.kind === "declaration") {
    if (candidate.reason !== "constitutional_declaration") return null;
    const mode = input.responseMode ?? "canon";
    if (mode !== "creation" && mode !== "canon" && mode !== "judgement") {
      return null;
    }
    // Never allow declaration to carry factkey-like disguise fields.
    return {
      kind: "declaration",
      declarationKey: candidate.declarationKey.trim().toLowerCase(),
      reason: "constitutional_declaration",
    };
  }

  // historic_exchange
  if (candidate.reason !== "exceptional_exchange") return null;
  // Do not allow historic_exchange when evidence clearly drives a fact answer
  // and mode is fact — force use of public_fact instead.
  if (input.responseMode === "fact" && (input.trustedFacts?.length ?? 0) > 0) {
    return null;
  }
  return {
    kind: "historic_exchange",
    reason: "exceptional_exchange",
  };
}

