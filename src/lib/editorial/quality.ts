/**
 * Deterministic Editorial quality gate (no model).
 * Distinguishes hard structural failures from quality failures (recovery-eligible).
 */

import {
  EDITORIAL_MODE_QUOTAS,
  EDITORIAL_PACKAGE_SIZE,
  orderedModeSlots,
  type EditorialMode,
  categoryForMode,
} from "@/lib/editorial/categories";
import { EditorialError } from "@/lib/editorial/errors";
import type {
  EditorialDraftTransmission,
  EditorialWorldContext,
} from "@/lib/editorial/types";
import { isEditorialMetaSignal } from "@/lib/editorial/types";

export type EditorialQualityFailure = {
  index: number;
  reasons: string[];
};

export type EditorialQualityAssessment = {
  /** Structural failures must fail the run (even after recovery). */
  structuralErrors: string[];
  /** Per-slot quality failures — eligible for one repair. */
  qualityFailures: EditorialQualityFailure[];
};

const BANNED_MARKETING: RegExp[] = [
  /\bexciting update\b/i,
  /\brevolutionary\b/i,
  /\bcutting[- ]edge\b/i,
  /\bcommunity[- ]driven\b/i,
  /\bweb3 project\b/i,
  /\bai[- ]powered\b/i,
  /\bdon'?t miss out\b/i,
  /\bjoin our community\b/i,
  /\bwe'?re thrilled\b/i,
  /\bwe are thrilled\b/i,
  /\bwe'?re excited\b/i,
  /\bwe are excited\b/i,
  /\bbig things are coming\b/i,
  /\bsomething big is coming\b/i,
  /\bwe'?re just getting started\b/i,
  /\bwe are just getting started\b/i,
  /\bgame[- ]changer\b/i,
  /\bour (platform|ecosystem|users|customers)\b/i,
  /\bfenn (is a |as a )?(platform|ecosystem|product)\b/i,
  /\bthe future belongs to\b/i,
  /\bbuilders build\b/i,
  /\bhistory is (being )?written\b/i,
  /\bthe revolution\b/i,
  /\bthe next era\b/i,
  /\bmost people don'?t understand\b/i,
  /\beveryone is watching\b/i,
  /\bto the moon\b/i,
  /\bwen lamo\b/i,
  /\bwen lambo\b/i,
];

const GENERIC_CRYPTO: RegExp[] = [
  /\b(?:gm|gn)\b/i,
  /#\w{2,}/,
  /\$\s*\d/,
  /\bhype\b/i,
  /\bnfa\b|\bdyor\b/i,
];

const FENN_NOUNS = [
  "wood",
  "road",
  "crown",
  "greenwood",
  "outlaw",
  "outlaws",
  "remembers",
  "watches",
  "waits",
] as const;

export function normalizeBody(body: string): string {
  return body.trim().replace(/\s+/g, " ").toLowerCase();
}

export function openingPhrase(body: string): string {
  const trimmed = body.trim().replace(/\s+/g, " ");
  const match = trimmed.match(/^.{1,48}?[.!?\n]/);
  return (match?.[0] ?? trimmed.slice(0, 32)).toLowerCase().trim();
}

export function nearKey(body: string): string {
  return normalizeBody(body).slice(0, 48);
}

export function detectBannedMarketing(body: string): string | null {
  for (const re of BANNED_MARKETING) {
    if (re.test(body)) return re.source;
  }
  return null;
}

export function detectGenericCrypto(body: string): string | null {
  for (const re of GENERIC_CRYPTO) {
    if (re.test(body)) return re.source;
  }
  return null;
}

/**
 * Lightweight structural ASCII detector.
 * Accepts multi-line visual layout and/or terminal/glyph density.
 * Rejects ordinary prose paragraphs for ASCII mode.
 */
export function looksLikeAsciiStructure(body: string): boolean {
  const raw = body.replace(/\r\n/g, "\n").trim();
  if (!raw) return false;

  const lines = raw.split("\n").map((l) => l.trimEnd());
  const nonEmpty = lines.filter((l) => l.trim().length > 0);
  const structural = raw.match(/[\\/|_+\-><\[\]{}()*=#:@~^`.]/g) ?? [];
  const multiLine = nonEmpty.length >= 2;

  // Dense structural glyphs alone can pass (one-line status/diagrams).
  if (structural.length >= 6) return true;

  if (multiLine && structural.length >= 3) return true;

  // Terminal stack / indented block without many glyphs still OK.
  if (
    multiLine &&
    nonEmpty.length >= 3 &&
    nonEmpty.some((l) => /^\s{2,}/.test(l) || /^[>\\|/\-+*]/.test(l.trim()))
  ) {
    return true;
  }

  // bracket / arrow mini-diagrams
  if (
    multiLine &&
    nonEmpty.some((l) => /[\[\]<>|\\/]/.test(l)) &&
    structural.length >= 2
  ) {
    return true;
  }

  return false;
}

const LORE_MOTIF_PATTERNS: RegExp[] = [
  /\bthe wood remembers\b/i,
  /\bthe road waits\b/i,
  /\bthe crown watches\b/i,
  /\bthe trees know\b/i,
  /\bsomething stirs\b/i,
];

/**
 * Soft factual guard: reject positive day-activity claims when trusted snapshot is zero.
 */
export function assertNoInventedStats(
  body: string,
  world: EditorialWorldContext,
): void {
  const checks: Array<{ re: RegExp; whenZero: () => boolean; label: string }> = [
    {
      re: /\b(\d+)\s+new\s+outlaws?\b/i,
      whenZero: () => world.newOutlaws === 0,
      label: "new outlaws",
    },
    {
      re: /\b(\d+)\s+outlaws?\s+(arrived|joined|entered)\b/i,
      whenZero: () => world.newOutlaws === 0,
      label: "outlaws arriving",
    },
    {
      re: /\b(\d+)\s+(new\s+)?deeds?\b/i,
      whenZero: () =>
        world.deedSubmissionsApproved === 0 && world.deedsCreated === 0,
      label: "deeds",
    },
    {
      re: /\b(\d+)\s+(greenwood\s+)?arrivals?\b/i,
      whenZero: () => world.greenwoodAdmissions === 0,
      label: "arrivals",
    },
    {
      re: /\b(\d+)\s+(new\s+)?(marks?|inscriptions?)\b/i,
      whenZero: () => world.wallInscriptions === 0,
      label: "wall marks",
    },
  ];

  for (const check of checks) {
    if (!check.whenZero()) continue;
    const m = body.match(check.re);
    if (m) {
      const n = Number(m[1]);
      if (Number.isFinite(n) && n > 0) {
        throw new EditorialError(
          "editorial_validation_failed",
          `Invented statistic for ${check.label}`,
          422,
        );
      }
    }
  }

  if (/\$\s*\d/.test(body) || /\b(to the moon|wen lambo|\bgm\b|\bgn\b)/i.test(body)) {
    throw new EditorialError(
      "editorial_validation_failed",
      "Forbidden price or cliché language",
      422,
    );
  }

  if (/#\w{2,}/.test(body)) {
    throw new EditorialError(
      "editorial_validation_failed",
      "Hashtags are not allowed",
      422,
    );
  }

  // Unsupported contract address: if a 0x address appears, it must match official.
  const addresses = body.match(/0x[a-fA-F0-9]{40}/g) ?? [];
  if (addresses.length > 0) {
    const official = world.officialContractAddress?.toLowerCase() ?? null;
    for (const addr of addresses) {
      if (!official || addr.toLowerCase() !== official) {
        throw new EditorialError(
          "editorial_validation_failed",
          "Unsupported or invented contract address",
          422,
        );
      }
    }
  }
}

function inventedStatsReason(
  body: string,
  world: EditorialWorldContext,
): string | null {
  try {
    assertNoInventedStats(body, world);
    return null;
  } catch (e) {
    if (e instanceof EditorialError) return e.message;
    return "Invented statistics";
  }
}

function countNounHits(bodies: string[], noun: string): number {
  const re = new RegExp(`\\b${noun}\\b`, "gi");
  let n = 0;
  for (const b of bodies) {
    const m = b.match(re);
    if (m) n += m.length;
  }
  return n;
}

/**
 * Assess package: structural errors + per-slot quality failures.
 */
export function assessEditorialPackage(
  transmissions: EditorialDraftTransmission[],
  world: EditorialWorldContext,
): EditorialQualityAssessment {
  const structuralErrors: string[] = [];
  const qualityFailures: EditorialQualityFailure[] = [];
  const reasonsByIndex = new Map<number, string[]>();

  const pushQ = (index: number, reason: string) => {
    const list = reasonsByIndex.get(index) ?? [];
    list.push(reason);
    reasonsByIndex.set(index, list);
  };

  if (transmissions.length !== EDITORIAL_PACKAGE_SIZE) {
    structuralErrors.push(
      `Expected ${EDITORIAL_PACKAGE_SIZE} transmissions, got ${transmissions.length}`,
    );
  }

  const expectedModes = orderedModeSlots();
  const modeCounts = Object.fromEntries(
    Object.keys(EDITORIAL_MODE_QUOTAS).map((k) => [k, 0]),
  ) as Record<EditorialMode, number>;

  for (let i = 0; i < Math.min(transmissions.length, expectedModes.length); i += 1) {
    const t = transmissions[i]!;
    const expectedMode = expectedModes[i]!;
    if (t.mode !== expectedMode) {
      structuralErrors.push(
        `Slot ${i} expected mode ${expectedMode}, got ${t.mode}`,
      );
    }
    if (t.category !== categoryForMode(t.mode)) {
      structuralErrors.push(
        `Slot ${i} category ${t.category} does not match mode ${t.mode}`,
      );
    }
    modeCounts[t.mode] = (modeCounts[t.mode] ?? 0) + 1;
  }

  for (const mode of Object.keys(EDITORIAL_MODE_QUOTAS) as EditorialMode[]) {
    if (modeCounts[mode] !== EDITORIAL_MODE_QUOTAS[mode] && transmissions.length === EDITORIAL_PACKAGE_SIZE) {
      // Only flag if length is correct; slot order already covers mismatches.
    }
  }

  const bodies = new Map<string, number>();
  const nears = new Map<string, number>();
  const openings = new Map<string, number>();
  const allBodies = transmissions.map((t) => t.body);

  for (let i = 0; i < transmissions.length; i += 1) {
    const t = transmissions[i]!;
    if (!t.body.trim()) {
      structuralErrors.push(`Slot ${i}: empty body`);
    }
    if (!t.title.trim()) {
      structuralErrors.push(`Slot ${i}: empty title`);
    }

    const norm = normalizeBody(t.body);
    if (bodies.has(norm)) {
      structuralErrors.push(`Slot ${i}: exact duplicate of slot ${bodies.get(norm)}`);
    } else {
      bodies.set(norm, i);
    }

    const nk = nearKey(t.body);
    if (nears.has(nk)) {
      pushQ(i, `Near-duplicate of slot ${nears.get(nk)}`);
    } else {
      nears.set(nk, i);
    }

    const open = openingPhrase(t.body);
    if (openings.has(open)) {
      pushQ(i, `Repeated opening phrase: "${open.slice(0, 40)}"`);
    } else {
      openings.set(open, i);
    }

    const invented = inventedStatsReason(t.body, world);
    if (invented) {
      structuralErrors.push(`Slot ${i}: ${invented}`);
    }

    const marketing = detectBannedMarketing(t.body);
    if (marketing) {
      pushQ(i, `Banned marketing language`);
    }

    const crypto = detectGenericCrypto(t.body);
    if (crypto) {
      pushQ(i, `Generic crypto/cliché language`);
    }

    const allowed = new Set(world.signalKeys);
    for (const signal of t.sourceSignals) {
      if (isEditorialMetaSignal(signal)) continue;
      if (!allowed.has(signal)) {
        structuralErrors.push(`Slot ${i}: unknown source signal: ${signal}`);
      }
    }

    // CURRENT should not claim grounded when nothing factual referenced.
    if (
      t.mode === "current" &&
      t.grounded &&
      t.sourceSignals.filter((s) => !isEditorialMetaSignal(s)).length === 0
    ) {
      pushQ(i, "CURRENT marked grounded without source signals");
    }

    // ASCII slots must look structurally different from ordinary prose.
    if (t.mode === "ascii" && !looksLikeAsciiStructure(t.body)) {
      pushQ(i, "ASCII mode lacks visual/terminal structure");
    }
  }

  // LORE diversity: near-dupes among lore slots, repeated stock motifs.
  const loreIndices = transmissions
    .map((t, i) => (t.mode === "world_lore" ? i : -1))
    .filter((i) => i >= 0);
  const loreNear = new Map<string, number>();
  const motifHits = new Map<string, number[]>();
  for (const i of loreIndices) {
    const body = transmissions[i]!.body;
    const nk = nearKey(body);
    if (loreNear.has(nk)) {
      pushQ(i, `Lore near-duplicate of slot ${loreNear.get(nk)}`);
    } else {
      loreNear.set(nk, i);
    }
    for (const motif of LORE_MOTIF_PATTERNS) {
      if (motif.test(body)) {
        const key = motif.source;
        const list = motifHits.get(key) ?? [];
        list.push(i);
        motifHits.set(key, list);
      }
    }
  }
  for (const [, indices] of motifHits) {
    if (indices.length >= 2) {
      for (const i of indices.slice(1)) {
        pushQ(i, "Repeated stock lore motif across WORLD/LORE slots");
      }
    }
  }

  // Package-level noun overuse → mark heavily contributing slots.
  // Threshold raised for 30-slot packages; still soft quality only.
  for (const noun of FENN_NOUNS) {
    const total = countNounHits(allBodies, noun);
    if (total >= 14) {
      const scores = allBodies.map((b, i) => ({
        i,
        n: (b.match(new RegExp(`\\b${noun}\\b`, "gi")) ?? []).length,
      }));
      scores.sort((a, b) => b.n - a.n);
      for (const s of scores.slice(0, 3)) {
        if (s.n > 0) pushQ(s.i, `Excessive use of "${noun}" across package`);
      }
    }
  }

  for (const [index, reasons] of reasonsByIndex) {
    qualityFailures.push({ index, reasons });
  }
  qualityFailures.sort((a, b) => a.index - b.index);

  return { structuralErrors, qualityFailures };
}

/**
 * Validate full package — throws on structural or quality failures.
 * Use assess + recovery path for softer handling.
 */
export function validateEditorialPackage(
  transmissions: EditorialDraftTransmission[],
  world: EditorialWorldContext,
): void {
  const assessment = assessEditorialPackage(transmissions, world);
  if (assessment.structuralErrors.length > 0) {
    throw new EditorialError(
      "editorial_validation_failed",
      assessment.structuralErrors[0]!,
      422,
    );
  }
  if (assessment.qualityFailures.length > 0) {
    throw new EditorialError(
      "editorial_validation_failed",
      assessment.qualityFailures[0]!.reasons[0] ?? "Quality failure",
      422,
    );
  }
}

/** Structural-only validation (for post-recovery acceptance). */
export function validateEditorialPackageStructure(
  transmissions: EditorialDraftTransmission[],
  world: EditorialWorldContext,
): void {
  const assessment = assessEditorialPackage(transmissions, world);
  if (assessment.structuralErrors.length > 0) {
    throw new EditorialError(
      "editorial_validation_failed",
      assessment.structuralErrors[0]!,
      422,
    );
  }
}

export function validateSingleTransmission(
  draft: EditorialDraftTransmission,
  expectedMode: EditorialMode,
  world: EditorialWorldContext,
  avoidBodies: string[],
  options?: {
    officialContractAddress?: string | null;
  },
): void {
  if (draft.mode !== expectedMode) {
    throw new EditorialError(
      "editorial_validation_failed",
      `Expected mode ${expectedMode}, got ${draft.mode}`,
      422,
    );
  }
  if (draft.category !== categoryForMode(expectedMode)) {
    throw new EditorialError(
      "editorial_validation_failed",
      `Category mismatch for mode ${expectedMode}`,
      422,
    );
  }
  if (!draft.body.trim() || !draft.title.trim()) {
    throw new EditorialError(
      "editorial_validation_failed",
      "Empty title or body",
      422,
    );
  }

  const avoidNorms = new Set(avoidBodies.map((b) => normalizeBody(b)));
  if (avoidNorms.has(normalizeBody(draft.body))) {
    throw new EditorialError(
      "editorial_validation_failed",
      "Regeneration matched a previous draft",
      422,
    );
  }

  const allowed = new Set(world.signalKeys);
  for (const signal of draft.sourceSignals) {
    if (isEditorialMetaSignal(signal)) continue;
    if (!allowed.has(signal)) {
      throw new EditorialError(
        "editorial_validation_failed",
        `Unknown source signal: ${signal}`,
        422,
      );
    }
  }

  assertNoInventedStats(draft.body, world);

  const marketing = detectBannedMarketing(draft.body);
  if (marketing) {
    throw new EditorialError(
      "editorial_validation_failed",
      "Banned marketing language",
      422,
    );
  }

  if (options?.officialContractAddress !== undefined) {
    assertNoConflictingOfficialContract(
      draft.body,
      options.officialContractAddress,
    );
  }

  if (expectedMode === "ascii" && !looksLikeAsciiStructure(draft.body)) {
    throw new EditorialError(
      "editorial_validation_failed",
      "ASCII mode lacks visual/terminal structure",
      422,
    );
  }
}

const EVM_ADDRESS_RE = /\b0x[a-fA-F0-9]{40}\b/g;

/**
 * When protected official FENN contract is known, no conflicting 0x address
 * may appear in a transmission body as a competing identity.
 */
export function assertNoConflictingOfficialContract(
  body: string,
  officialContractAddress: string | null | undefined,
): void {
  if (!officialContractAddress) return;
  const expected = officialContractAddress.trim().toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(expected)) return;

  const found = body.match(EVM_ADDRESS_RE) ?? [];
  for (const raw of found) {
    if (raw.toLowerCase() !== expected) {
      throw new EditorialError(
        "editorial_validation_failed",
        "Transmission claims a contract address that conflicts with protected official FENN",
        422,
      );
    }
  }
}

/**
 * Soft quality reasons that may trigger one single-transmission recovery.
 * Marketing / invented stats / bad signals remain hard fails via validateSingle.
 */
export function softQualityReasonsForSingle(
  draft: EditorialDraftTransmission,
): string[] {
  const reasons: string[] = [];
  const crypto = detectGenericCrypto(draft.body);
  if (crypto) {
    reasons.push("Generic crypto/cliché language");
  }
  if (
    draft.mode === "direct" &&
    draft.grounded &&
    draft.sourceSignals.filter((s) => !isEditorialMetaSignal(s)).length === 0
  ) {
    // not hard-fail; optional soft
  }
  return reasons;
}

/** Test fixture helpers */
export const EDITORIAL_BAD_FIXTURES = [
  "The future belongs to those who build.",
  "Something big is coming.",
  "The wood remembers.",
  "The wood remembers those who arrive.",
  "We are excited to announce the next phase of our ecosystem.",
] as const;

export const EDITORIAL_GOOD_FIXTURES = [
  "Four names entered the Register before noon.",
  "The Ledger does not reward attention.\nIt records contribution.",
  "FENN has been speaking outside the wood again.",
  "Most tokens ask what you bought.\nGreenwood asks what you did.",
] as const;
