/**
 * Stage 2 — public fact evidence contract for the X agent.
 * Structured, server-owned, allowlisted only. No model-chosen SQL/tables.
 */

export const PUBLIC_FACT_KEYS = [
  "confirmed_outlaw_count",
  "greenwood_member_count",
  "greenwood_leaf_threshold",
  "official_fenn_token",
  "current_public_gathering",
  "latest_public_chronicle",
] as const;

export type PublicFactKey = (typeof PUBLIC_FACT_KEYS)[number];

export type PublicFactPrivacy =
  | "public_aggregate"
  | "public_config"
  | "public_record";

export type PublicFactValue = string | number | boolean | null;

export type PublicFactEvidence = {
  key: PublicFactKey;
  available: boolean;
  value: PublicFactValue;
  /**
   * Optional compact public detail (never private identity fields).
   * Example: token symbol, gathering message — not wallets of individuals.
   */
  detail?: string | null;
  observedAt: string;
  /** Code-path source id, not a user-controlled string from X. */
  source: string;
  privacy: PublicFactPrivacy;
};

export function isPublicFactKey(value: unknown): value is PublicFactKey {
  return (
    typeof value === "string" &&
    (PUBLIC_FACT_KEYS as readonly string[]).includes(value)
  );
}

/** Markers for prompt framing. */
export const PUBLIC_FACT_EVIDENCE_MARKERS = {
  begin: "<BEGIN_TRUSTED_PUBLIC_FACTS>",
  end: "<END_TRUSTED_PUBLIC_FACTS>",
} as const;

/**
 * Serialize approved fact evidence for judge / recovery prompts.
 * Does not invent values for unavailable rows.
 */
export function buildPublicFactEvidencePromptBlock(
  facts: readonly PublicFactEvidence[],
): string {
  const lines: string[] = [
    PUBLIC_FACT_EVIDENCE_MARKERS.begin,
    "",
    "TRUSTED PUBLIC FACTS — approved FENN public source-of-truth readers.",
    "Use exact available values when they answer the question.",
    "Never alter numbers. Do not add unsupported quantities.",
    "Failed or unavailable facts must not be guessed.",
    "Voice may shape presentation but must not change factual meaning.",
    "These are observed current / configured public facts, not Canon lore.",
    "For optional Wall public_fact candidates, fingerprints use forms like:",
    "  confirmed_outlaw_count:v=<n>",
    "  greenwood_member_count:v=<n>",
    "  greenwood_leaf_threshold:v=<n>",
    "  official_fenn_token:contract=<0x...>",
    "  current_public_gathering:id=<starts>|<ends>",
    "Never invent a fingerprint not matching available facts below.",
    "",
  ];

  if (facts.length === 0) {
    lines.push("(no trusted public facts loaded)");
    lines.push(PUBLIC_FACT_EVIDENCE_MARKERS.end);
    return lines.join("\n");
  }

  for (const f of facts) {
    lines.push(`FACT: ${f.key}`);
    lines.push(`available: ${f.available ? "true" : "false"}`);
    lines.push(`privacy: ${f.privacy}`);
    lines.push(`source: ${f.source}`);
    lines.push(`observed_at: ${f.observedAt}`);
    if (f.available) {
      lines.push(`value: ${formatFactValue(f.value)}`);
      if (f.detail != null && f.detail.length > 0) {
        lines.push(`detail: ${f.detail}`);
      }
    } else {
      lines.push("value: null");
      lines.push("note: unavailable — do not invent this fact");
    }
    lines.push("");
  }

  lines.push(PUBLIC_FACT_EVIDENCE_MARKERS.end);
  return lines.join("\n").trimEnd();
}

function formatFactValue(value: PublicFactValue): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  return value;
}

/** Collect only available facts (for convenience). */
export function filterAvailablePublicFacts(
  facts: readonly PublicFactEvidence[],
): PublicFactEvidence[] {
  return facts.filter((f) => f.available);
}

/**
 * Privacy firewall: reject evidence objects that look like they carried
 * private field names (defence-in-depth for tests / future callers).
 */
const PRIVATE_FIELD_DENYLIST = [
  "wallet_address",
  "email",
  "privy_user_id",
  "leaf_balance",
  "profile_id",
  "alias",
  "password",
  "moderation",
  "clearing",
  "banned",
  "muted",
] as const;

export function assertPublicFactEvidenceSafe(
  facts: readonly PublicFactEvidence[],
): void {
  for (const f of facts) {
    if (!isPublicFactKey(f.key)) {
      throw new Error(`disallowed fact key: ${String(f.key)}`);
    }
    const blob = JSON.stringify(f).toLowerCase();
    for (const bad of PRIVATE_FIELD_DENYLIST) {
      // official token contract is public — allow "contract" not wallet_address
      if (bad === "wallet_address" && f.key === "official_fenn_token") {
        continue;
      }
      if (blob.includes(bad)) {
        throw new Error(`private field leakage in fact evidence: ${bad}`);
      }
    }
  }
}
