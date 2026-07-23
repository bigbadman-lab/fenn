/**
 * FENN Canon — repository editorial source of truth.
 * Runtime persistence: fenn_memories(layer=canon) via trusted sync.
 */

/** Future retrieval scopes. Most world Canon is public. */
export const FENN_CANON_VISIBILITIES = ["public", "camp", "internal"] as const;

export type FennCanonVisibility = (typeof FENN_CANON_VISIBILITIES)[number];

/**
 * Stable Canon document key: fenn.<segment>(.<segment>)*
 * Segments: lowercase alphanumeric + hyphen.
 */
export const FENN_CANON_KEY_PATTERN =
  /^fenn\.[a-z0-9]+(?:\.[a-z0-9-]+)*$/;

export type FennCanonDocument = {
  /** Stable machine identity — never a runtime UUID. */
  key: string;
  title: string;
  /** Plain text / ASCII. Preserved whitespace and newlines. */
  content: string;
  visibility: FennCanonVisibility;
};

export function assertValidCanonKey(key: string): void {
  if (!FENN_CANON_KEY_PATTERN.test(key)) {
    throw new Error(`Invalid Canon key: ${key}`);
  }
}
