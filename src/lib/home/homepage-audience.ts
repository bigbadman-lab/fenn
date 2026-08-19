/**
 * Homepage V2 audience resolution — pure helpers for copy + CTAs.
 * SSR and first client paint share deterministic "stranger" default while
 * Privy is not ready (matches unauthenticated public render).
 * Authenticated resolution never shows stranger-only CTAs or wrong greetings.
 */

import {
  CANOPY_DISPLAY,
  NAMED_DISPLAY,
  REGISTER_ANCHOR_ID,
} from "@/lib/site/world-vocabulary";

export type HomepageAudience =
  | "stranger"
  | "pending"
  | "outlaw"
  | "greenwood";

export type HomepageAudienceInput = {
  privyReady: boolean;
  authLoading: boolean;
  profileResolved: boolean;
  authenticated: boolean;
  registered: boolean;
  greenwoodMember: boolean;
};

/**
 * Resolve who the homepage is speaking to.
 * - !privyReady → stranger (SSR + first paint; public path)
 * - authenticated but still loading profile → pending (no wrong greeting words)
 * - registered + greenwoodEntered → greenwood
 * - registered → outlaw
 * - otherwise stranger
 */
export function resolveHomepageAudience(
  input: HomepageAudienceInput,
): HomepageAudience {
  if (!input.privyReady) {
    return "stranger";
  }

  if (input.authenticated) {
    if (input.authLoading || !input.profileResolved) {
      return "pending";
    }
    if (input.registered && input.greenwoodMember) {
      return "greenwood";
    }
    if (input.registered) {
      return "outlaw";
    }
    return "stranger";
  }

  return "stranger";
}

export const HOMEPAGE_GREETING = {
  stranger: "YOU ARRIVE UNNAMED.",
  outlaw: "THE REGISTER KNOWS YOU.",
  greenwood: "THE CANOPY IS OPEN.",
} as const;

export const HOMEPAGE_PENDING_LINE =
  "the gate is still deciding who you are…" as const;

export function homepageGreetingTitle(
  audience: HomepageAudience,
): string | null {
  if (audience === "pending") return null;
  if (audience === "greenwood") return HOMEPAGE_GREETING.greenwood;
  if (audience === "outlaw") return HOMEPAGE_GREETING.outlaw;
  return HOMEPAGE_GREETING.stranger;
}

/** Anonymous / not-yet-named orientation prose under the title. */
export const HOMEPAGE_STRANGER_LINES = {
  lead: [
    "VELL is a living world — watched, remembered, and reshaped by the people inside it.",
    "You may wander without a name.",
    "When you are ready, claim one and let the world begin remembering you.",
  ],
  deeds: [
    "Do deeds. Speak in Camp. Earn LEAF.",
    `When VELL is satisfied, ${CANOPY_DISPLAY.the} opens.`,
    "What VELL commits to move is named in the Commons.",
  ],
  closing: "Nothing here is decoration. What you do here stays.",
} as const;

export const HOMEPAGE_BEGIN_HERE = {
  title: "FIRST STEPS",
  lines: [
    "Use the map below as a compass.",
    "Every named place can be entered.",
    "Walk without registering if you wish.",
    `When you want permanence, ${NAMED_DISPLAY.claimTitle.toLowerCase()} and enter ${NAMED_DISPLAY.registerTitle}.`,
  ],
} as const;

export const HOMEPAGE_ACTIONS = {
  becomeOutlaw: NAMED_DISPLAY.claimCta,
  exploreMap: "[ EXPLORE THE MAP ]",
  /** href targets */
  outlawThresholdId: REGISTER_ANCHOR_ID,
  mapId: "the-map",
} as const;

export const HOMEPAGE_MAP_ORIENTATION = {
  title: "THE MAP",
  lines: [
    "Each label is a door.",
    "Every named place can be entered.",
    "Pick a direction.",
    "Keep walking.",
  ],
} as const;

export const HOMEPAGE_MAP_EPILOGUE = {
  line: "What gathers in the treasury must eventually move.",
  aside: "vell keeps watch from the canopy.",
} as const;

export const HOMEPAGE_OUTLAW_THRESHOLD = {
  title: NAMED_DISPLAY.claimTitle,
  body: [
    `A ${NAMED_DISPLAY.singular} has a permanent name in ${NAMED_DISPLAY.registerTitle}.`,
    `${NAMED_DISPLAY.plural} can speak in Camp, complete Deeds, earn LEAF and leave marks the world remembers.`,
    "The road is open to everyone.",
    "A name makes your journey permanent.",
  ],
  wallet: [
    "Your wallet holds your place.",
    "Your chosen name becomes your mark.",
  ],
} as const;

/** Compact lines for registered members at the top (journey fills the rest). */
export const HOMEPAGE_OUTLAW_TOP = {
  lines: [
    "Your journey continues below.",
    "Or pick a place on the map and go.",
  ],
} as const;

export const HOMEPAGE_GREENWOOD_TOP = {
  lines: [
    `${CANOPY_DISPLAY.title} is open to you.`,
    "The map still belongs to you — walk toward the work.",
  ],
} as const;

export function shouldShowBecomeOutlawCta(audience: HomepageAudience): boolean {
  return audience === "stranger";
}

export function shouldShowExploreMapCta(audience: HomepageAudience): boolean {
  return audience === "stranger" || audience === "outlaw" || audience === "greenwood";
}

export function shouldShowBeginHere(audience: HomepageAudience): boolean {
  return audience === "stranger";
}

export function shouldShowOutlawThresholdIntro(
  audience: HomepageAudience,
): boolean {
  return audience === "stranger" || audience === "pending";
}
