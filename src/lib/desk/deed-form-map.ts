import type { DeedEvidenceRequirements, DeedReward } from "@/lib/deeds/types";

export type RewardFormMode = "fixed" | "range" | "none";

export type EvidenceFormState = DeedEvidenceRequirements;

export const DEFAULT_EVIDENCE_FORM: EvidenceFormState = {
  text: { allowed: true, required: false },
  url: { allowed: false, required: false },
  image: { allowed: false, required: false },
  other: { allowed: false, required: false },
};

export function suggestSlugFromTitle(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function rewardModeFromReward(reward: DeedReward): RewardFormMode {
  return reward.type;
}

export function rewardPayloadFromForm(
  mode: RewardFormMode,
  fixedAmount: string,
  minAmount: string,
  maxAmount: string,
):
  | { ok: true; reward: DeedReward }
  | { ok: false; error: string } {
  if (mode === "none") {
    return { ok: true, reward: { type: "none" } };
  }
  if (mode === "fixed") {
    const amount = Number.parseInt(fixedAmount, 10);
    if (!Number.isInteger(amount) || amount < 0) {
      return { ok: false, error: "Fixed reward must be a non-negative integer." };
    }
    return { ok: true, reward: { type: "fixed", amount } };
  }
  const min = Number.parseInt(minAmount, 10);
  const max = Number.parseInt(maxAmount, 10);
  if (!Number.isInteger(min) || !Number.isInteger(max) || min < 0 || max < 0) {
    return {
      ok: false,
      error: "Range reward must use non-negative integers.",
    };
  }
  if (max < min) {
    return { ok: false, error: "Range maximum must be ≥ minimum." };
  }
  return { ok: true, reward: { type: "range", min, max } };
}

export function setEvidenceAllowed(
  current: EvidenceFormState,
  field: keyof EvidenceFormState,
  allowed: boolean,
): EvidenceFormState {
  if (!allowed) {
    return {
      ...current,
      [field]: { allowed: false, required: false },
    };
  }
  return {
    ...current,
    [field]: { ...current[field], allowed: true },
  };
}

export function setEvidenceRequired(
  current: EvidenceFormState,
  field: keyof EvidenceFormState,
  required: boolean,
): EvidenceFormState {
  if (required) {
    return {
      ...current,
      [field]: { allowed: true, required: true },
    };
  }
  return {
    ...current,
    [field]: { ...current[field], required: false },
  };
}

export function hasAnyAllowedEvidence(requirements: EvidenceFormState): boolean {
  return (
    requirements.text.allowed ||
    requirements.url.allowed ||
    requirements.image.allowed ||
    requirements.other.allowed
  );
}

export function parseOptionalMaxCompletions(
  raw: string,
): { ok: true; value: number | null } | { ok: false; error: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: true, value: null };
  const n = Number.parseInt(trimmed, 10);
  if (!Number.isInteger(n) || n <= 0) {
    return {
      ok: false,
      error: "Maximum completions must be empty or a positive integer.",
    };
  }
  return { ok: true, value: n };
}

/**
 * Convert a datetime-local wall-clock value to UTC ISO for the API.
 *
 * Semantics (explicit contract):
 * - Desk enters local browser wall-clock (`YYYY-MM-DDTHH:mm`)
 * - We construct a local Date and persist its absolute instant as ISO UTC
 * - Empty/whitespace → null (cleared field), never an invalid empty string
 *
 * Component construction avoids Date.parse timezone ambiguity for
 * timezone-less datetime strings.
 */
export function localDatetimeToIso(local: string): string | null {
  const trimmed = local.trim();
  if (!trimmed) return null;
  const match = trimmed.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/,
  );
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6] ?? "0");
  if (
    ![year, month, day, hour, minute, second].every((n) => Number.isFinite(n))
  ) {
    return null;
  }
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    return null;
  }
  // Local wall-clock → absolute Instant (toISOString is always UTC).
  const d = new Date(year, month - 1, day, hour, minute, second, 0);
  if (
    d.getFullYear() !== year ||
    d.getMonth() !== month - 1 ||
    d.getDate() !== day ||
    d.getHours() !== hour ||
    d.getMinutes() !== minute ||
    d.getSeconds() !== second
  ) {
    // Invalid calendar date (e.g. Feb 31) collapsed by the Date constructor.
    return null;
  }
  return d.toISOString();
}

/** Convert UTC ISO from the API back to datetime-local (browser local wall-clock). */
export function isoToLocalDatetime(iso: string | null | undefined): string {
  if (iso == null) return "";
  const trimmed = String(iso).trim();
  if (!trimmed) return "";
  const d = new Date(trimmed);
  if (!Number.isFinite(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
