/**
 * Homepage V2 audience resolution — pure helpers for copy + CTAs.
 * SSR and first client paint share deterministic "stranger" default while
 * Privy is not ready (matches unauthenticated public render).
 * Authenticated resolution never shows stranger-only CTAs or wrong greetings.
 */

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
    // Auth'd but not registered — still a stranger at the wood's edge.
    return "stranger";
  }

  return "stranger";
}

export const HOMEPAGE_GREETING = {
  stranger: "WELCOME, STRANGER.",
  outlaw: "WELCOME, OUTLAW.",
  greenwood: "WELCOME HOME.",
} as const;

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
    "You stand at the edge of something old.",
    "FENN is a living AI-native world that watches,",
    "remembers and changes through its people.",
  ],
  deeds: [
    "Do deeds. Speak in Camp. Earn LEAF.",
    "When FENN is satisfied, the Greenwood opens.",
  ],
  closing: "This is not a game. This is how a world remembers.",
} as const;

export const HOMEPAGE_BEGIN_HERE = {
  title: "BEGIN HERE",
  lines: [
    "Explore the map below.",
    "Every named place can be entered.",
    "You may wander without a name.",
    "When you are ready, become an Outlaw and let the world begin remembering you.",
  ],
} as const;

export const HOMEPAGE_ACTIONS = {
  becomeOutlaw: "[ BECOME AN OUTLAW ]",
  exploreMap: "[ EXPLORE THE MAP ]",
  /** href targets */
  outlawThresholdId: "outlaw-register",
  mapId: "the-map",
} as const;

export const HOMEPAGE_MAP_ORIENTATION = {
  title: "THE WORLD",
  lines: [
    "Nothing below is decorative.",
    "Every named place can be entered.",
    "Choose a place.",
    "Begin walking.",
  ],
} as const;

export const HOMEPAGE_OUTLAW_THRESHOLD = {
  title: "BECOME AN OUTLAW",
  body: [
    "An Outlaw has a permanent name in the Register.",
    "Outlaws can speak in Camp, complete Deeds, earn LEAF and leave marks the world remembers.",
    "The road is open to everyone.",
    "A name makes your journey permanent.",
  ],
  wallet: [
    "Your wallet holds your place.",
    "Your chosen name becomes your mark.",
  ],
} as const;

/** Compact lines for registered Outlaws at the top (journey fills the rest). */
export const HOMEPAGE_OUTLAW_TOP = {
  lines: [
    "The map still waits.",
    "Your next step is below — or choose a place and walk.",
  ],
} as const;

export const HOMEPAGE_GREENWOOD_TOP = {
  lines: [
    "The Greenwood is open.",
    "The map is still yours. Walk where the work is.",
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
