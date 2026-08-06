/**
 * Stage 2 — bounded live capability routing for public X judgements.
 * Application-owned; no model SQL. Heuristics supplement model needsLiveState.
 */

import type { Stage12ResponseMode } from "@/lib/agent/response-mode";
import {
  STAGE124_LIVE_CAPABILITIES,
  STAGE124_LIVE_CAPABILITY_MAX,
  type Stage124LiveCapability,
} from "@/lib/agent/stage124-live-capabilities";

const STAGE124_SET = new Set<string>(STAGE124_LIVE_CAPABILITIES);

/**
 * Priority when trimming above STAGE124_LIVE_CAPABILITY_MAX.
 * Direct answer / register facts before broad history.
 */
export const STAGE124_CAPABILITY_PRIORITY: readonly Stage124LiveCapability[] = [
  "register",
  "greenwood",
  "token",
  "gatherings",
  "treasury",
  "commons",
  "deeds",
  "wall",
  "chronicle",
] as const;

/** Map body heuristics → Stage 124 capabilities for approved public facts. */
export function inferStage124CapabilitiesFromBody(
  body: string,
): Stage124LiveCapability[] {
  const text = body.trim().toLowerCase();
  if (!text) return [];

  const found: Stage124LiveCapability[] = [];

  const push = (c: Stage124LiveCapability) => {
    if (!found.includes(c)) found.push(c);
  };

  // Register counts
  if (
    /\boutlaws?\b/.test(text) ||
    /\bregister\b/.test(text) ||
    (/\bhow many\b/.test(text) &&
      /\b(outlaw|greenwood|member)/.test(text)) ||
    /\bare there many\b/.test(text) ||
    (/\bgreenwood\b/.test(text) &&
      /\b(how many|members?|count)\b/.test(text))
  ) {
    // "What is an Outlaw?" is canon, not register
    if (
      !(
        /\bwhat is\b/.test(text) &&
        !/\bhow many|are there|count\b/.test(text)
      )
    ) {
      push("register");
    }
  }

  // LEAF threshold (config) — not personal leaf
  if (
    (/\bleaf\b/.test(text) || /\bthreshold\b/.test(text)) &&
    (/\bgreenwood\b/.test(text) ||
      /\bhow many\b/.test(text) ||
      /\bneed\b/.test(text) ||
      /\brequired\b/.test(text) ||
      /\badmission\b/.test(text) ||
      /\benter\b/.test(text))
  ) {
    push("greenwood");
  }

  // Token / launch
  if (
    /\b(token|\$fenn|contract|launched|launch|chain)\b/.test(text) &&
    !/\bleaf\b/.test(text)
  ) {
    push("token");
  }

  // Gatherings
  if (/\bgathering/.test(text) || /\bworld call\b/.test(text)) {
    push("gatherings");
  }

  // Chronicle / book (public latest)
  if (
    /\bchronicle\b/.test(text) ||
    (/\bbook\b/.test(text) && /\b(latest|recent|today|wrote|write)\b/.test(text))
  ) {
    push("chronicle");
  }

  // Classic live domains
  if (/\btreasury\b/.test(text)) push("treasury");
  if (/\bcommons\b/.test(text)) push("commons");
  if (/\bdeeds?\b/.test(text) && !/\bwhat is a deed\b/.test(text)) {
    if (/\b(open|active|current|status|reward|window)\b/.test(text)) {
      push("deeds");
    }
  }
  if (
    /\bwall\b/.test(text) &&
    /\b(latest|recent|inscript|what is written)\b/.test(text)
  ) {
    push("wall");
  }

  return prioritizeAndCap(found);
}

/**
 * Whether creation / judgement modes should avoid live tools by default.
 */
export function shouldRequestLiveStateForMode(
  mode: Stage12ResponseMode,
): boolean {
  return mode === "fact";
}

/**
 * Merge model-requested caps with optional body inference; filter to executable.
 */
export function resolveExecutableLiveCapabilities(input: {
  requested: readonly string[];
  body?: string;
  responseMode?: Stage12ResponseMode | null;
  /** When true (copy-forward empty request), infer from body for fact questions. */
  inferFromBodyIfEmpty?: boolean;
}): Stage124LiveCapability[] {
  const allowed: Stage124LiveCapability[] = [];
  for (const raw of input.requested) {
    if (typeof raw === "string" && STAGE124_SET.has(raw)) {
      const c = raw as Stage124LiveCapability;
      if (!allowed.includes(c)) allowed.push(c);
    }
  }

  const mode = input.responseMode;
  const body = input.body ?? "";

  // Creation / judgement should not pile on live reads unless model already asked
  // (and model was guided not to for those modes).
  if (mode === "creation" || mode === "judgement") {
    return prioritizeAndCap(allowed);
  }

  if (
    allowed.length === 0 &&
    input.inferFromBodyIfEmpty &&
    body.trim().length > 0
  ) {
    return inferStage124CapabilitiesFromBody(body);
  }

  // Augment fact-like empty space: if model requested nothing but body implies fact
  if (mode === "fact" && allowed.length === 0 && body) {
    return inferStage124CapabilitiesFromBody(body);
  }

  return prioritizeAndCap(allowed);
}

export function prioritizeAndCap(
  capabilities: readonly Stage124LiveCapability[],
): Stage124LiveCapability[] {
  const unique = [...new Set(capabilities)].filter((c) =>
    STAGE124_SET.has(c),
  );
  unique.sort((a, b) => {
    const ia = STAGE124_CAPABILITY_PRIORITY.indexOf(a);
    const ib = STAGE124_CAPABILITY_PRIORITY.indexOf(b);
    const pa = ia === -1 ? 99 : ia;
    const pb = ib === -1 ? 99 : ib;
    return pa - pb;
  });
  return unique.slice(0, STAGE124_LIVE_CAPABILITY_MAX);
}

/**
 * Copy-forward safety: quantitative draft about approved domains without evidence.
 * Keeps bounds tight — not a general NLI system.
 */
export function draftAssertsUnsupportedPublicQuantity(input: {
  body: string;
  replyText: string | null;
  loadedCapabilities: readonly string[];
  availableFactKeys: readonly string[];
}): boolean {
  const reply = (input.replyText ?? "").toLowerCase();
  const body = input.body.toLowerCase();
  if (!reply.trim()) return false;

  const hasRegister =
    input.loadedCapabilities.includes("register") ||
    input.availableFactKeys.includes("confirmed_outlaw_count");
  const hasThreshold =
    input.loadedCapabilities.includes("greenwood") ||
    input.availableFactKeys.includes("greenwood_leaf_threshold");
  const hasToken =
    input.loadedCapabilities.includes("token") ||
    input.availableFactKeys.includes("official_fenn_token");
  const hasGathering =
    input.loadedCapabilities.includes("gatherings") ||
    input.availableFactKeys.includes("current_public_gathering");

  // Outlaw quantity without register evidence
  const outlawFactQ =
    /\boutlaws?\b/.test(body) ||
    /\bare there many\b/.test(body) ||
    (/\bhow many\b/.test(body) && /\boutlaw/.test(body));
  if (outlawFactQ && !hasRegister) {
    if (
      /\bmany outlaws?\b/.test(reply) ||
      /\b(hundreds|thousands|dozens|countless|numerous)\b.*\boutlaw/.test(
        reply,
      ) ||
      /\b\d+\s+outlaws?\b/.test(reply) ||
      /\boutlaws?\b.*\b(many|numerous|plenty)\b/.test(reply) ||
      /\byes, there are many\b/.test(reply)
    ) {
      return true;
    }
  }

  // Threshold numbers without evidence
  if (
    (/\bleaf\b/.test(body) || /\bthreshold\b/.test(body)) &&
    !hasThreshold &&
    /\b\d+\s*(leaf|leaves)?\b/i.test(reply) &&
    /\b(need|require|threshold)\b/.test(reply)
  ) {
    return true;
  }

  // Token launched assertion without evidence
  if (
    /\b(token|contract|launch)\b/.test(body) &&
    !hasToken &&
    /\b(has launched|is live|contract is|0x[a-f0-9]{10,})\b/.test(reply)
  ) {
    return true;
  }

  // Gathering open without evidence
  if (
    /\bgathering/.test(body) &&
    !hasGathering &&
    /\b(is open|is active|currently open|now open)\b/.test(reply)
  ) {
    return true;
  }

  return false;
}
