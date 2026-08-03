import {
  EDITORIAL_CATEGORY_QUOTAS,
  EDITORIAL_PACKAGE_SIZE,
  orderedCategorySlots,
  type EditorialCategory,
} from "@/lib/editorial/categories";
import { EditorialError } from "@/lib/editorial/errors";
import type {
  EditorialDraftTransmission,
  EditorialWorldContext,
} from "@/lib/editorial/types";

function normalizeBody(body: string): string {
  return body.trim().replace(/\s+/g, " ").toLowerCase();
}

function openingSentence(body: string): string {
  const trimmed = body.trim().replace(/\s+/g, " ");
  const match = trimmed.match(/^.{1,80}?[.!?\n]/);
  return (match?.[0] ?? trimmed.slice(0, 40)).toLowerCase();
}

function nearKey(body: string): string {
  return normalizeBody(body).slice(0, 48);
}

/**
 * Validate a full 24-transmission package against quotas, uniqueness, and facts.
 */
export function validateEditorialPackage(
  transmissions: EditorialDraftTransmission[],
  world: EditorialWorldContext,
): void {
  if (transmissions.length !== EDITORIAL_PACKAGE_SIZE) {
    throw new EditorialError(
      "editorial_validation_failed",
      `Expected ${EDITORIAL_PACKAGE_SIZE} transmissions, got ${transmissions.length}`,
      422,
    );
  }

  const expectedSlots = orderedCategorySlots();
  for (let i = 0; i < expectedSlots.length; i += 1) {
    if (transmissions[i]!.category !== expectedSlots[i]) {
      throw new EditorialError(
        "editorial_validation_failed",
        `Slot ${i} expected ${expectedSlots[i]}, got ${transmissions[i]!.category}`,
        422,
      );
    }
  }

  const counts = Object.fromEntries(
    Object.keys(EDITORIAL_CATEGORY_QUOTAS).map((k) => [k, 0]),
  ) as Record<EditorialCategory, number>;
  for (const t of transmissions) {
    counts[t.category] += 1;
  }
  for (const category of Object.keys(EDITORIAL_CATEGORY_QUOTAS) as EditorialCategory[]) {
    if (counts[category] !== EDITORIAL_CATEGORY_QUOTAS[category]) {
      throw new EditorialError(
        "editorial_validation_failed",
        `Category ${category} count ${counts[category]} !== ${EDITORIAL_CATEGORY_QUOTAS[category]}`,
        422,
      );
    }
  }

  const bodies = new Set<string>();
  const nears = new Set<string>();
  const openings = new Set<string>();
  const asciiBodies = new Set<string>();

  for (const t of transmissions) {
    if (!t.body.trim()) {
      throw new EditorialError(
        "editorial_validation_failed",
        "Empty body",
        422,
      );
    }
    if (!t.title.trim()) {
      throw new EditorialError(
        "editorial_validation_failed",
        "Empty title",
        422,
      );
    }

    const norm = normalizeBody(t.body);
    if (bodies.has(norm)) {
      throw new EditorialError(
        "editorial_validation_failed",
        "Duplicate transmission body",
        422,
      );
    }
    bodies.add(norm);

    const nk = nearKey(t.body);
    if (nears.has(nk)) {
      throw new EditorialError(
        "editorial_validation_failed",
        "Near-duplicate transmission body",
        422,
      );
    }
    nears.add(nk);

    const open = openingSentence(t.body);
    if (openings.has(open)) {
      throw new EditorialError(
        "editorial_validation_failed",
        "Repeated opening sentence",
        422,
      );
    }
    openings.add(open);

    if (t.category === "ascii") {
      if (asciiBodies.has(norm)) {
        throw new EditorialError(
          "editorial_validation_failed",
          "Repeated ASCII",
          422,
        );
      }
      asciiBodies.add(norm);
    }

    const allowed = new Set(world.signalKeys);
    for (const signal of t.sourceSignals) {
      if (!allowed.has(signal)) {
        throw new EditorialError(
          "editorial_validation_failed",
          `Unknown source signal: ${signal}`,
          422,
        );
      }
    }

    assertNoInventedStats(t.body, world);
  }
}

export function validateSingleTransmission(
  draft: EditorialDraftTransmission,
  expectedCategory: EditorialCategory,
  world: EditorialWorldContext,
  avoidBodies: string[],
): void {
  if (draft.category !== expectedCategory) {
    throw new EditorialError(
      "editorial_validation_failed",
      `Expected category ${expectedCategory}, got ${draft.category}`,
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
    if (!allowed.has(signal)) {
      throw new EditorialError(
        "editorial_validation_failed",
        `Unknown source signal: ${signal}`,
        422,
      );
    }
  }

  assertNoInventedStats(draft.body, world);
}

/**
 * Soft factual guard: reject positive counts when trusted snapshot is zero.
 */
export function assertNoInventedStats(
  body: string,
  world: EditorialWorldContext,
): void {
  const checks: Array<{ re: RegExp; whenZero: () => boolean; label: string }> = [
    {
      re: /\b(\d+)\s+outlaws?\b/i,
      whenZero: () => world.newOutlaws === 0,
      label: "outlaws",
    },
    {
      re: /\b(\d+)\s+deeds?\b/i,
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
      re: /\b(\d+)\s+(marks?|inscriptions?)\b/i,
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

  // Ban dollar prices and common hype tokens.
  if (/\$\s*\d/.test(body) || /\b(to the moon|wen lambo|gm\b|GN\b)/i.test(body)) {
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
}
