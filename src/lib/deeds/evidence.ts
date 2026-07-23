import { z } from "zod";

import type {
  DeedEvidenceRequirements,
  DeedSubmissionEvidenceInput,
  EvidenceField,
  EvidenceFieldRequirement,
  EvidenceRequirementsParseResult,
  EvidenceValidationError,
  EvidenceValidationResult,
  NormalizedDeedEvidence,
} from "@/lib/deeds/types";

const fieldSchema = z
  .object({
    allowed: z.boolean(),
    required: z.boolean(),
  })
  .strict();

const requirementsSchema = z
  .object({
    text: fieldSchema,
    url: fieldSchema,
    image: fieldSchema,
    other: fieldSchema,
  })
  .strict();

/** Fail-closed default: nothing allowed/required. */
export const EMPTY_EVIDENCE_REQUIREMENTS: DeedEvidenceRequirements = {
  text: { allowed: false, required: false },
  url: { allowed: false, required: false },
  image: { allowed: false, required: false },
  other: { allowed: false, required: false },
};

function canonicalizeField(
  field: EvidenceFieldRequirement,
): EvidenceFieldRequirement {
  // required=true implies allowed=true
  if (field.required && !field.allowed) {
    return { allowed: true, required: true };
  }
  return field;
}

function canonicalizeRequirements(
  value: DeedEvidenceRequirements,
): DeedEvidenceRequirements {
  return {
    text: canonicalizeField(value.text),
    url: canonicalizeField(value.url),
    image: canonicalizeField(value.image),
    other: canonicalizeField(value.other),
  };
}

export function hasAnyAllowedEvidenceType(
  requirements: DeedEvidenceRequirements,
): boolean {
  return (
    requirements.text.allowed ||
    requirements.url.allowed ||
    requirements.image.allowed ||
    requirements.other.allowed
  );
}

/**
 * Parse untrusted evidence_requirements jsonb into a canonical structure.
 * Invalid input fails closed (no permissive defaults).
 */
export function parseEvidenceRequirements(
  raw: unknown,
): EvidenceRequirementsParseResult {
  const parsed = requirementsSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: "evidence_requirements is missing or malformed",
      value: EMPTY_EVIDENCE_REQUIREMENTS,
    };
  }

  const value = canonicalizeRequirements(parsed.data);
  if (!hasAnyAllowedEvidenceType(value)) {
    return {
      ok: false,
      error: "evidence_requirements must allow at least one evidence type",
      value: EMPTY_EVIDENCE_REQUIREMENTS,
    };
  }

  return { ok: true, value };
}

function blankToNull(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export function normalizeSubmissionEvidence(
  input: DeedSubmissionEvidenceInput,
): NormalizedDeedEvidence {
  return {
    text: blankToNull(input.text),
    url: blankToNull(input.url),
    imagePath: blankToNull(input.imagePath),
    other: blankToNull(input.other),
  };
}

export function isAbsoluteHttpUrl(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  return parsed.protocol === "http:" || parsed.protocol === "https:";
}

function pushError(
  errors: EvidenceValidationError[],
  code: EvidenceValidationError["code"],
  field?: EvidenceField | "evidence",
) {
  errors.push(field ? { code, field } : { code });
}

/**
 * Validate normalized evidence against canonical requirements.
 * Does not throw for ordinary user validation failures.
 */
export function validateSubmissionEvidence(
  requirements: DeedEvidenceRequirements,
  input: DeedSubmissionEvidenceInput,
  options?: { requirementsValid?: boolean },
): EvidenceValidationResult {
  const evidence = normalizeSubmissionEvidence(input);
  const errors: EvidenceValidationError[] = [];

  if (options?.requirementsValid === false) {
    pushError(errors, "INVALID_REQUIREMENTS");
    return { valid: false, errors, evidence };
  }

  const fields: {
    key: EvidenceField;
    value: string | null;
    missingCode: EvidenceValidationError["code"];
    notAllowedCode: EvidenceValidationError["code"];
  }[] = [
    {
      key: "text",
      value: evidence.text,
      missingCode: "REQUIRED_TEXT_MISSING",
      notAllowedCode: "TEXT_NOT_ALLOWED",
    },
    {
      key: "url",
      value: evidence.url,
      missingCode: "REQUIRED_URL_MISSING",
      notAllowedCode: "URL_NOT_ALLOWED",
    },
    {
      key: "image",
      value: evidence.imagePath,
      missingCode: "REQUIRED_IMAGE_MISSING",
      notAllowedCode: "IMAGE_NOT_ALLOWED",
    },
    {
      key: "other",
      value: evidence.other,
      missingCode: "REQUIRED_OTHER_MISSING",
      notAllowedCode: "OTHER_NOT_ALLOWED",
    },
  ];

  for (const field of fields) {
    const rule = requirements[field.key];
    if (field.value != null && !rule.allowed) {
      pushError(errors, field.notAllowedCode, field.key);
    }
    if (rule.required && field.value == null) {
      pushError(errors, field.missingCode, field.key);
    }
  }

  if (evidence.url != null && !isAbsoluteHttpUrl(evidence.url)) {
    pushError(errors, "INVALID_URL", "url");
  }

  const hasAny =
    evidence.text != null ||
    evidence.url != null ||
    evidence.imagePath != null ||
    evidence.other != null;

  if (!hasAny) {
    pushError(errors, "NO_EVIDENCE", "evidence");
  }

  return {
    valid: errors.length === 0,
    errors,
    evidence,
  };
}
