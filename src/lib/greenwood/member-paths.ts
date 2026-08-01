import type { GreenwoodMemberSnapshotView } from "@/lib/greenwood/gate-view";

/**
 * Real destinations safe to surface from inside Greenwood.
 * Camp/Book/etc. remain reachable from the wider world nav;
 * The Fire keeps the local list tight.
 */
export const GREENWOOD_MEMBER_PATHS = [
  {
    href: "/deeds",
    label: "DEEDS",
    note: "work left for the Greenwood.",
  },
] as const;

export type GreenwoodMemberPath = (typeof GREENWOOD_MEMBER_PATHS)[number];

/** Dormant Fire paths — not routes, not claims of live systems. */
export const GREENWOOD_FIRE_DORMANT_PATHS = [
  {
    label: "THE HOLLOW",
    note: "nothing has been left here yet.",
  },
  {
    label: "GATHERINGS",
    note: "no gathering has been called.",
  },
] as const;

export type GreenwoodMemberPresentation = {
  outlawLabel: string;
  alias: string | null;
  member: GreenwoodMemberSnapshotView;
};

/** Pure presentation helpers for tests — no React. */
export function memberInteriorCopy(input: GreenwoodMemberPresentation): {
  outlawLabel: string;
  aliasLine: string | null;
  entryLeafLine: string;
  showsEligibility: boolean;
  showsEnter: boolean;
  pathHrefs: readonly string[];
  hubTitle: "THE FIRE";
  dormantLabels: readonly string[];
} {
  return {
    outlawLabel: input.outlawLabel,
    aliasLine:
      input.alias && input.alias.trim().length > 0
        ? `known as ${input.alias.trim()}`
        : null,
    entryLeafLine: `entered the wood with ${input.member.lifetimeLeafAtEntry} lifetime LEAF.`,
    showsEligibility: false,
    showsEnter: false,
    pathHrefs: GREENWOOD_MEMBER_PATHS.map((path) => path.href),
    hubTitle: "THE FIRE",
    dormantLabels: GREENWOOD_FIRE_DORMANT_PATHS.map((path) => path.label),
  };
}
