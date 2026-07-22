export const CONTRIBUTION_TYPES = [
  "finding things",
  "making things",
  "saying things",
  "breaking things",
  "fixing things",
  "none of the above",
] as const;

export type ContributionType = (typeof CONTRIBUTION_TYPES)[number];

export const GREENWOOD_TERMS_VERSION = "greenwood-terms-v1";
