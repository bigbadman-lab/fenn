/** Editorial Room — categories (DB), modes (composition), package shape. */

/** Stored in DB CHECK constraint — do not rename without migration. */
export const EDITORIAL_CATEGORIES = [
  "world_transmission",
  "lore",
  "robinhood_echo",
  "ascii",
  "invitation",
  "founder_note",
] as const;

export type EditorialCategory = (typeof EDITORIAL_CATEGORIES)[number];

/** Editorial intent — generation composition (not DB enum). */
export const EDITORIAL_MODES = [
  "current",
  "explanation",
  "outlaw",
  "leaf_deeds",
  "agent",
  "world_lore",
  "direct",
  "wild",
] as const;

export type EditorialMode = (typeof EDITORIAL_MODES)[number];

/** Exact daily package mode quotas — total 24. */
export const EDITORIAL_MODE_QUOTAS: Readonly<Record<EditorialMode, number>> = {
  current: 4,
  explanation: 4,
  outlaw: 3,
  leaf_deeds: 3,
  agent: 3,
  world_lore: 3,
  direct: 2,
  wild: 2,
};

/**
 * Map editorial mode → persisted category (CHECK-constrained column).
 * Counts must match EDITORIAL_CATEGORY_QUOTAS.
 */
export const EDITORIAL_MODE_TO_CATEGORY: Readonly<
  Record<EditorialMode, EditorialCategory>
> = {
  current: "world_transmission",
  explanation: "world_transmission",
  outlaw: "invitation",
  leaf_deeds: "world_transmission",
  agent: "robinhood_echo",
  world_lore: "lore",
  direct: "founder_note",
  wild: "ascii",
};

/** DB category quotas derived from mode → category mapping. */
export const EDITORIAL_CATEGORY_QUOTAS: Readonly<
  Record<EditorialCategory, number>
> = {
  world_transmission: 11, // current 4 + explanation 4 + leaf_deeds 3
  lore: 3,
  robinhood_echo: 3,
  ascii: 2,
  invitation: 3,
  founder_note: 2,
};

export const EDITORIAL_PACKAGE_SIZE = 24;

export const EDITORIAL_MODE_LABELS: Readonly<Record<EditorialMode, string>> = {
  current: "CURRENT",
  explanation: "EXPLANATION",
  outlaw: "OUTLAW",
  leaf_deeds: "LEAF",
  agent: "AGENT",
  world_lore: "LORE",
  direct: "DIRECT",
  wild: "WILD",
};

export const EDITORIAL_CATEGORY_LABELS: Readonly<
  Record<EditorialCategory, string>
> = {
  world_transmission: "WORLD TRANSMISSION",
  lore: "LORE",
  robinhood_echo: "ROBINHOOD ECHO",
  ascii: "ASCII",
  invitation: "INVITATION",
  founder_note: "FOUNDER NOTE",
};

export function isEditorialCategory(value: string): value is EditorialCategory {
  return (EDITORIAL_CATEGORIES as readonly string[]).includes(value);
}

export function isEditorialMode(value: string): value is EditorialMode {
  return (EDITORIAL_MODES as readonly string[]).includes(value);
}

export function categoryForMode(mode: EditorialMode): EditorialCategory {
  return EDITORIAL_MODE_TO_CATEGORY[mode];
}

/** Expand mode quotas into ordered slots 0..23. */
export function orderedModeSlots(): EditorialMode[] {
  const slots: EditorialMode[] = [];
  for (const mode of EDITORIAL_MODES) {
    const n = EDITORIAL_MODE_QUOTAS[mode];
    for (let i = 0; i < n; i += 1) slots.push(mode);
  }
  return slots;
}

/** Expand category quotas into ordered slots (derived from modes). */
export function orderedCategorySlots(): EditorialCategory[] {
  return orderedModeSlots().map(categoryForMode);
}

export type EditorialConfidence = "high" | "medium" | "low";
export type EditorialApprovalState = "draft" | "approved";

/**
 * Future destinations without changing core generation.
 * X is the current operator copy target only — never auto-posted.
 */
export type EditorialDestination =
  | "x"
  | "book"
  | "wall"
  | "telegram"
  | "discord"
  | "newsletter";
