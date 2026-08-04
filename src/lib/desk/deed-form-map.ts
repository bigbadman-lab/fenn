import type { DeedEvidenceRequirements, DeedReward } from "@/lib/deeds/types";

export type RewardFormMode = "fixed" | "range" | "none";

export type EvidenceFormState = DeedEvidenceRequirements;

/** Default simplified new-deed evidence: screenshot required. */
export const DEFAULT_EVIDENCE_FORM: EvidenceFormState = {
  text: { allowed: false, required: false },
  url: { allowed: false, required: false },
  image: { allowed: true, required: true },
  other: { allowed: false, required: false },
};

/**
 * Backend always requires at least one allowed evidence type.
 * "No evidence" in the Keeper UI maps to optional written note only —
 * not zero-proof submissions (which the domain forbids).
 */
export const NO_EVIDENCE_PAYLOAD: EvidenceFormState = {
  text: { allowed: true, required: false },
  url: { allowed: false, required: false },
  image: { allowed: false, required: false },
  other: { allowed: false, required: false },
};

export type SimpleEvidenceKeys = "screenshot" | "link" | "written";

export type CapChoice = "unlimited" | "first10" | "custom";

export type PrimaryRewardChoice = "none" | "fixed";

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

function fieldOff(): { allowed: boolean; required: boolean } {
  return { allowed: false, required: false };
}

function fieldRequired(): { allowed: boolean; required: boolean } {
  return { allowed: true, required: true };
}

function isOff(field: { allowed: boolean; required: boolean }): boolean {
  return !field.allowed && !field.required;
}

function isRequiredOn(field: { allowed: boolean; required: boolean }): boolean {
  return field.allowed && field.required;
}

function isOptionalOnly(
  field: { allowed: boolean; required: boolean },
): boolean {
  return field.allowed && !field.required;
}

/** True when evidence matches a simple primary-toggle shape (not Advanced). */
export function isSimpleEvidenceConfig(
  evidence: EvidenceFormState,
): boolean {
  if (evidence.other.allowed || evidence.other.required) return false;

  if (
    isOptionalOnly(evidence.text) &&
    isOff(evidence.url) &&
    isOff(evidence.image) &&
    isOff(evidence.other)
  ) {
    return true; // "No evidence" backend mapping
  }

  for (const key of ["text", "url", "image"] as const) {
    const f = evidence[key];
    if (!(isOff(f) || isRequiredOn(f))) return false;
  }
  return hasAnyAllowedEvidence(evidence);
}

export function isNoEvidenceSelection(evidence: EvidenceFormState): boolean {
  return (
    isOptionalOnly(evidence.text) &&
    isOff(evidence.url) &&
    isOff(evidence.image) &&
    isOff(evidence.other)
  );
}

export function simpleEvidenceFromForm(
  evidence: EvidenceFormState,
): Record<SimpleEvidenceKeys, boolean> & { none: boolean } {
  if (!isSimpleEvidenceConfig(evidence)) {
    return { screenshot: false, link: false, written: false, none: false };
  }
  if (isNoEvidenceSelection(evidence)) {
    return { screenshot: false, link: false, written: false, none: true };
  }
  return {
    screenshot: evidence.image.allowed && evidence.image.required,
    link: evidence.url.allowed && evidence.url.required,
    written: evidence.text.allowed && evidence.text.required,
    none: false,
  };
}

export function evidenceFromSimpleSelection(selection: {
  screenshot: boolean;
  link: boolean;
  written: boolean;
  none: boolean;
}): EvidenceFormState {
  if (selection.none) {
    return { ...NO_EVIDENCE_PAYLOAD };
  }
  return {
    text: selection.written ? fieldRequired() : fieldOff(),
    url: selection.link ? fieldRequired() : fieldOff(),
    image: selection.screenshot ? fieldRequired() : fieldOff(),
    other: fieldOff(),
  };
}

export function toggleSimpleEvidence(
  current: EvidenceFormState,
  key: SimpleEvidenceKeys | "none",
): EvidenceFormState {
  if (!isSimpleEvidenceConfig(current)) {
    // Preserve complex config: don't clobber via simple toggles.
    return current;
  }
  const sel = simpleEvidenceFromForm(current);
  if (key === "none") {
    return evidenceFromSimpleSelection({
      screenshot: false,
      link: false,
      written: false,
      none: true,
    });
  }
  const next = {
    screenshot: key === "screenshot" ? !sel.screenshot : sel.screenshot,
    link: key === "link" ? !sel.link : sel.link,
    written: key === "written" ? !sel.written : sel.written,
    none: false,
  };
  if (!next.screenshot && !next.link && !next.written) {
    return evidenceFromSimpleSelection({
      screenshot: false,
      link: false,
      written: false,
      none: true,
    });
  }
  return evidenceFromSimpleSelection(next);
}

export function capChoiceFromMaxCompletions(
  maxCompletions: string,
): CapChoice {
  const trimmed = maxCompletions.trim();
  if (!trimmed) return "unlimited";
  if (trimmed === "10") return "first10";
  return "custom";
}

export function maxCompletionsFromCapChoice(
  choice: CapChoice,
  customValue: string,
): string {
  if (choice === "unlimited") return "";
  if (choice === "first10") return "10";
  return customValue;
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
      error: "Completion limit must be empty or a positive integer.",
    };
  }
  return { ok: true, value: n };
}

/**
 * Prefer opening Advanced when existing data needs non-default controls.
 */
export function shouldExpandAdvancedInitially(input: {
  rewardMode: RewardFormMode;
  externalRewardNote: string;
  sponsorName: string;
  startsAtLocal: string;
  endsAtLocal: string;
  accessScope: string;
  isPublic: boolean;
  isRepeatable: boolean;
  category: string;
  evidence: EvidenceFormState;
  slugManuallyNotable?: boolean;
}): boolean {
  if (input.rewardMode === "range") return true;
  if (input.externalRewardNote.trim()) return true;
  if (input.sponsorName.trim()) return true;
  if (input.startsAtLocal.trim() || input.endsAtLocal.trim()) return true;
  if (input.accessScope !== "road") return true;
  if (!input.isPublic) return true;
  if (input.isRepeatable) return true;
  if (input.category.trim()) return true;
  if (!isSimpleEvidenceConfig(input.evidence)) return true;
  return false;
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
