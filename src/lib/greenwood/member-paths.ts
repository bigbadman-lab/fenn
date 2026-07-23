import type { GreenwoodMemberSnapshotView } from "@/lib/greenwood/gate-view";

/** Existing FENN destinations safe to surface from inside Greenwood. */
export const GREENWOOD_MEMBER_PATHS = [
  {
    href: "/camp",
    label: "CAMP",
    note: "voices by the fire.",
  },
  {
    href: "/deeds",
    label: "DEEDS",
    note: "work left in the world.",
  },
  {
    href: "/book",
    label: "THE BOOK",
    note: "what has been written.",
  },
  {
    href: "/oak",
    label: "THE OAK",
    note: "older than the road.",
  },
  {
    href: "/ledger",
    label: "THE LEDGER",
    note: "what has been recorded.",
  },
  {
    href: "/commons",
    label: "THE COMMONS",
    note: "accounts of what may move.",
  },
] as const;

export type GreenwoodMemberPath = (typeof GREENWOOD_MEMBER_PATHS)[number];

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
  };
}
