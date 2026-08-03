/** Editorial Room — categories and package shape (platform-agnostic). */

export const EDITORIAL_CATEGORIES = [
  "world_transmission",
  "lore",
  "robinhood_echo",
  "ascii",
  "invitation",
  "founder_note",
] as const;

export type EditorialCategory = (typeof EDITORIAL_CATEGORIES)[number];

/** Exact daily package quotas — total 24. */
export const EDITORIAL_CATEGORY_QUOTAS: Readonly<
  Record<EditorialCategory, number>
> = {
  world_transmission: 6,
  lore: 4,
  robinhood_echo: 4,
  ascii: 4,
  invitation: 3,
  founder_note: 3,
};

export const EDITORIAL_PACKAGE_SIZE = 24;

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

/** Expand quotas into ordered slot categories (0..23). */
export function orderedCategorySlots(): EditorialCategory[] {
  const slots: EditorialCategory[] = [];
  for (const category of EDITORIAL_CATEGORIES) {
    const n = EDITORIAL_CATEGORY_QUOTAS[category];
    for (let i = 0; i < n; i += 1) slots.push(category);
  }
  return slots;
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
