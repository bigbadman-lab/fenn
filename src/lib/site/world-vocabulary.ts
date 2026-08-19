/**
 * User-facing place and identity names for the VELL world.
 * Routes, DB columns, and internal audience keys stay legacy (outlaw/greenwood).
 */

export const NAMED_DISPLAY = {
  /** Permanent registered member. */
  singular: "Named",
  plural: "Named",
  registerTitle: "THE REGISTER",
  claimTitle: "CLAIM A NAME",
  claimCta: "[ CLAIM A NAME ]",
  hubLink: "[ the named ]",
  pageTitle: "NAMED",
  registerPageTitle: "THE REGISTER",
  memberPrefix: "NAMED",
  memberLinkLabel: (number: string) => `[ named ${number} ]`,
  ledYouHere: "A NAMED MEMBER LED YOU HERE",
  ledYouToRoad: (label: string) => `${label} LED YOU TO THE ROAD`,
  becoming: "CLAIMING A NAME",
  formOpening: "WAIT HERE — THE REGISTER FORM IS OPENING…",
  continueToHub: "[ CONTINUE TO YOUR PROFILE ]",
} as const;

export const CANOPY_DISPLAY = {
  title: "THE CANOPY",
  short: "Canopy",
  the: "the Canopy",
  mapLabel: "the canopy",
  mapLinkLabel: "[ the canopy ]",
  walkLink: "[ walk to the canopy ]",
  goLink: "[ go to the canopy ]",
  walkToLink: "[ WALK TO THE CANOPY ]",
  openTitle: "THE CANOPY IS OPEN",
  opens: "THE CANOPY OPENS",
  hasOpened: "THE CANOPY HAS OPENED",
  gateOpens: "THE GATE OPENS.",
  knowsYou: "THE CANOPY KNOWS YOU.",
  mark: "CANOPY",
  subtitle: "The oldest part of VELL.",
  remembers: "The Canopy remembers.",
  crossed: "you crossed into the Canopy.",
  nowOpens: "The Canopy now opens.",
} as const;

/** Homepage registration anchor — legacy id, stable href. */
export const REGISTER_ANCHOR_ID = "outlaw-register";

export const REGISTER_ANCHOR_HREF = `/#${REGISTER_ANCHOR_ID}`;

export const CANOPY_PATH = "/greenwood?crossing=1";

export const MEMBER_HUB_PATH = "/outlaw";

/** Five-digit member number (legacy outlaw_number column). */
export function formatNamedNumber(outlawNumber: number): string {
  return String(outlawNumber).padStart(5, "0");
}

/** Display label e.g. NAMED 00123 */
export function formatNamedLabel(outlawNumber: number): string {
  return `${NAMED_DISPLAY.memberPrefix} ${formatNamedNumber(outlawNumber)}`;
}

/** Accept legacy OUTLAW N invite params and new NAMED N. */
export function isLegacyOrNamedInviteFrom(from: string): boolean {
  return /^(OUTLAW|NAMED)\s+\d{1,8}$/i.test(from.trim());
}

export function normalizeInviteFromLabel(from: string): string {
  const trimmed = from.trim();
  if (/^OUTLAW\s+(\d{1,8})$/i.test(trimmed)) {
    const n = trimmed.match(/^OUTLAW\s+(\d{1,8})$/i)![1]!;
    return `${NAMED_DISPLAY.memberPrefix} ${n.padStart(5, "0")}`;
  }
  if (/^NAMED\s+(\d{1,8})$/i.test(trimmed)) {
    return trimmed.toUpperCase();
  }
  return trimmed.toUpperCase();
}
