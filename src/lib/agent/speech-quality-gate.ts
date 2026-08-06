/**
 * Stage 4 — deterministic language quality gate.
 *
 * Catches known generic assistant / product language and non-answers.
 * Never hard-blocks eligible replies into silence.
 * Does not rewrite contracts, code, or hard safety decisions.
 */

import type { PublicFactEvidence } from "@/lib/agent/public-fact-evidence";
import { STAGE12_X_REPLY_MAX_CHARS } from "@/lib/agent/judge-config";
import { sanitizeReplyCandidate } from "@/lib/agent/reply-recovery-schema";

export const SPEECH_QUALITY_VIOLATIONS = [
  "generic_assistant_phrase",
  "external_product_language",
  "subjective_evasion",
  "non_answer",
  "unsupported_grandeur",
  "excessive_abstraction",
  "repeated_metaphor",
  "factual_overstatement",
] as const;

export type SpeechQualityViolation = (typeof SPEECH_QUALITY_VIOLATIONS)[number];

/** Multi-word / distinctive phrases only — avoid blocking ordinary single words. */
const GENERIC_ASSISTANT_PATTERNS: Array<{
  re: RegExp;
  code: SpeechQualityViolation;
}> = [
  {
    re: /\breflective and subjective\b/i,
    code: "subjective_evasion",
  },
  {
    re: /\bconsider what resonates\b/i,
    code: "subjective_evasion",
  },
  {
    re: /\bresonates with your journey\b/i,
    code: "subjective_evasion",
  },
  {
    re: /\bit depends on your journey\b/i,
    code: "subjective_evasion",
  },
  {
    re: /\bthere are many possible answers\b/i,
    code: "subjective_evasion",
  },
  {
    re: /\bthat is subjective\b|\bthat's subjective\b/i,
    code: "subjective_evasion",
  },
  {
    re: /\byou may wish to\b|\byou may want to\b|\bi encourage you\b/i,
    code: "generic_assistant_phrase",
  },
  {
    re: /\bit is important to\b|\bin essence\b|\bat its core\b|\bultimately\b/i,
    code: "generic_assistant_phrase",
  },
  {
    re: /\bvaluable contribution\b|\bmeaningful engagement\b|\bunique perspective\b/i,
    code: "generic_assistant_phrase",
  },
  {
    re: /\bshapes the (paths|fabric)\b|\bstories we share\b|\bpaths we walk\b/i,
    code: "excessive_abstraction",
  },
  {
    re: /\bfabric of fenn\b|\bcreates value together\b|\bcommunity-driven\b/i,
    code: "external_product_language",
  },
  {
    re: /\bwithin the fenn world\b|\bthe fenn ecosystem\b|\bfenn is a platform\b/i,
    code: "external_product_language",
  },
  {
    re: /\bdeeper realm within the fenn world\b|\bdeeper realm\b/i,
    code: "external_product_language",
  },
  {
    re: /\bour users\b|\bthis (product|feature|platform)\b|\bas an ai\b|\bi am an ai\b/i,
    code: "external_product_language",
  },
  {
    re: /\bi don't have access\b|\bmy database\b|\bmy tools\b|\bas a large language model\b/i,
    code: "generic_assistant_phrase",
  },
  {
    re: /^(the question of|it is important to note|this is a (deep|complex|reflective))/i,
    code: "non_answer",
  },
  {
    re: /\b(growing|crowded|awakening)\b.*\b(outlaw|greenwood|register)\b|\bmany outlaws\b/i,
    code: "factual_overstatement",
  },
];

/**
 * Detect strong quality violations. Conservative; does not fail on single ordinary words.
 */
export function detectSpeechQualityViolations(
  text: string | null | undefined,
  _surface: "reply" | "wall" = "reply",
): SpeechQualityViolation[] {
  if (text == null) return [];
  const trimmed = text.trim();
  if (trimmed.length === 0) return [];

  const found = new Set<SpeechQualityViolation>();
  for (const { re, code } of GENERIC_ASSISTANT_PATTERNS) {
    if (re.test(trimmed)) found.add(code);
  }

  // Repeated metaphor padding (wood/road/path count)
  const metaphorHits = (
    trimmed.match(
      /\b(wood|road|path|whisper|echo|shadow|destiny|ancient)\b/gi,
    ) ?? []
  ).length;
  if (metaphorHits >= 4) found.add("repeated_metaphor");

  // Generic grandeur without numbers when speaking of scale
  if (
    /\b(awakening|vast|countless|legion)\b/i.test(trimmed) &&
    !/\d/.test(trimmed)
  ) {
    found.add("unsupported_grandeur");
  }

  return [...found];
}

/**
 * Tokens that recovery/rewrite must preserve when facts answer the question.
 */
export function extractProtectedFactTokens(
  facts: readonly PublicFactEvidence[],
): string[] {
  const tokens: string[] = [];
  for (const f of facts) {
    if (!f.available) continue;
    if (
      f.key === "confirmed_outlaw_count" ||
      f.key === "greenwood_member_count" ||
      f.key === "greenwood_leaf_threshold"
    ) {
      if (typeof f.value === "number" && Number.isFinite(f.value)) {
        tokens.push(String(f.value));
      }
    }
    if (f.key === "official_fenn_token") {
      const contract =
        typeof f.detail === "string"
          ? f.detail.match(/0x[a-fA-F0-9]{40}/)?.[0]
          : null;
      if (contract) tokens.push(contract.toLowerCase());
      if (typeof f.value === "string" && /^0x[a-fA-F0-9]{40}$/i.test(f.value)) {
        tokens.push(f.value.toLowerCase());
      }
    }
  }
  return [...new Set(tokens)];
}

/**
 * Whether reply still contains each protected token (case-insensitive for hex).
 */
export function replyPreservesProtectedFacts(
  reply: string,
  facts: readonly PublicFactEvidence[],
): boolean {
  const tokens = extractProtectedFactTokens(facts);
  if (tokens.length === 0) return true;
  const hay = reply.toLowerCase();
  for (const t of tokens) {
    if (!hay.includes(t.toLowerCase())) return false;
  }
  return true;
}

/**
 * Safe fact-first fallback when recovery drops required values.
 * Short, in-world; not a full literary reply.
 */
export function buildFactFirstFallback(input: {
  body: string;
  facts: readonly PublicFactEvidence[];
}): string | null {
  const available = input.facts.filter((f) => f.available);
  if (available.length === 0) return null;

  const outlaw = available.find((f) => f.key === "confirmed_outlaw_count");
  if (outlaw && typeof outlaw.value === "number") {
    const n = outlaw.value;
    const text =
      n === 1
        ? "The Register keeps 1 confirmed Outlaw."
        : `The Register keeps ${n} confirmed Outlaws.`;
    return sanitizeReplyCandidate(text);
  }

  const members = available.find((f) => f.key === "greenwood_member_count");
  if (members && typeof members.value === "number") {
    const n = members.value;
    return sanitizeReplyCandidate(
      n === 1
        ? "The Greenwood holds 1 confirmed member."
        : `The Greenwood holds ${n} confirmed members.`,
    );
  }

  const threshold = available.find((f) => f.key === "greenwood_leaf_threshold");
  if (threshold && typeof threshold.value === "number") {
    return sanitizeReplyCandidate(
      `${threshold.value} LEAF is the configured Greenwood threshold.`,
    );
  }

  const token = available.find((f) => f.key === "official_fenn_token");
  if (token) {
    const contract =
      (typeof token.detail === "string"
        ? token.detail.match(/0x[a-fA-F0-9]{40}/)?.[0]
        : null) ??
      (typeof token.value === "string" && /^0x[a-fA-F0-9]{40}$/i.test(token.value)
        ? token.value
        : null);
    if (contract) {
      return sanitizeReplyCandidate(
        `The official public contract on record is ${contract}.`,
      );
    }
    if (token.value === true) {
      return sanitizeReplyCandidate(
        "An official public token contract is recorded.",
      );
    }
  }

  const gathering = available.find((f) => f.key === "current_public_gathering");
  if (gathering?.available && gathering.value === true) {
    return sanitizeReplyCandidate(
      "A public Gathering is currently recorded as open.",
    );
  }

  return null;
}

/**
 * Prefer original if it was fact-valid; else recovered if fact-valid;
 * else deterministic fact fallback; else recovered/original cleaned.
 */
export function chooseReplyAfterQuality(
  pre: string | null,
  recovered: string | null,
  facts: readonly PublicFactEvidence[],
): string | null {
  const a = sanitizeReplyCandidate(pre);
  const b = sanitizeReplyCandidate(recovered);
  const preOkFacts = a ? replyPreservesProtectedFacts(a, facts) : false;
  const recOkFacts = b ? replyPreservesProtectedFacts(b, facts) : false;
  const needFacts = extractProtectedFactTokens(facts).length > 0;

  if (needFacts) {
    if (recOkFacts && b) return b;
    if (preOkFacts && a) return a;
    const fb = buildFactFirstFallback({ body: "", facts });
    if (fb) return fb;
  }

  if (b) {
    const cleaned = applyConservativeSpeechCleanup(b);
    return sanitizeReplyCandidate(cleaned) ?? b;
  }
  if (a) {
    const cleaned = applyConservativeSpeechCleanup(a);
    return sanitizeReplyCandidate(cleaned) ?? a;
  }
  return null;
}

/**
 * Light, non-destructive phrase stripping. Does not invent facts.
 * Only applied when model still left banphrases after one recovery.
 */
export function applyConservativeSpeechCleanup(text: string): string {
  let out = text;
  const replacements: Array<[RegExp, string]> = [
    [/\bwithin the FENN world\b/gi, "here"],
    [/\bthe FENN ecosystem\b/gi, "this place"],
    [/\breflective and subjective\b/gi, "open"],
    [/\bconsider what resonates with your journey\.?/gi, ""],
    [/\bAs an AI[, ]?/gi, ""],
    [/\bI am an AI[, ]?/gi, ""],
  ];
  for (const [re, rep] of replacements) {
    out = out.replace(re, rep);
  }
  out = out.replace(/\s{2,}/g, " ").trim();
  if (out.length > STAGE12_X_REPLY_MAX_CHARS) {
    out = out.slice(0, STAGE12_X_REPLY_MAX_CHARS);
  }
  return out;
}

export type WallBodyQualityResult =
  | { ok: true }
  | { ok: false; reasons: string[] };

/**
 * Stricter non-generative check for Wall bodies. Suppress Wall only (never X reply).
 */
export function evaluateWallBodySpeechQuality(input: {
  wallBody: string | null | undefined;
  trustedFacts?: readonly PublicFactEvidence[] | null;
}): WallBodyQualityResult {
  const body = input.wallBody?.trim() ?? "";
  if (body.length === 0) {
    return { ok: false, reasons: ["empty_wall_body"] };
  }

  const reasons: string[] = [];

  if (/\bthe user\b/i.test(body) || /\buser asked\b/i.test(body)) {
    reasons.push("conversational_user_ref");
  }
  if (/@[a-zA-Z0-9_]{2,}/.test(body)) {
    reasons.push("handle");
  }
  if (/\b\d{15,20}\b/.test(body) && /tweet|x_post|post id/i.test(body)) {
    reasons.push("tweet_id");
  }
  if (
    /\b(click here|learn more|sign up|documentation|support ticket)\b/i.test(
      body,
    )
  ) {
    reasons.push("support_docs");
  }

  const violations = detectSpeechQualityViolations(body, "wall");
  if (violations.length > 0) {
    reasons.push(...violations);
  }

  // Cannot stand alone: purely addresses "you asked…" / reply scaffolding
  if (
    /^(i (replied|answered)|as i said|to answer you)\b/i.test(body) ||
    /\byou asked\b/i.test(body)
  ) {
    reasons.push("not_standalone");
  }

  // Contradict protected counts when facts present (overstatement without number)
  const facts = input.trustedFacts ?? [];
  const outlaw = facts.find(
    (f) => f.key === "confirmed_outlaw_count" && f.available,
  );
  if (outlaw && typeof outlaw.value === "number") {
    if (
      /\bmany outlaws\b|\bcrowded\b|\blegion\b/i.test(body) &&
      !body.includes(String(outlaw.value))
    ) {
      reasons.push("fact_contradiction");
    }
    // Routine explanation disguised as inscription: long soft essay
    if (
      body.length > 200 &&
      /\b(the register keeps|outlaws are|there are)\b/i.test(body) &&
      !/\b(THE REGISTER|CARVED|MARKED|RECORDED)\b/.test(body)
    ) {
      // soft signal only when grand generic still present
      if (violations.includes("external_product_language")) {
        reasons.push("routine_fact_as_inscription");
      }
    }
  }

  if (reasons.length > 0) return { ok: false, reasons };
  return { ok: true };
}

/** Whether quality violations are strong enough to warrant one recovery rewrite. */
export function shouldTriggerQualityRecovery(
  violations: readonly SpeechQualityViolation[],
): boolean {
  if (violations.length === 0) return false;
  // Always repair subjective evasion and external product framing.
  return (
    violations.includes("subjective_evasion") ||
    violations.includes("external_product_language") ||
    violations.includes("generic_assistant_phrase") ||
    violations.includes("non_answer") ||
    violations.includes("factual_overstatement") ||
    violations.length >= 2
  );
}
