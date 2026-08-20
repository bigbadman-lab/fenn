import {
  REGISTER_ANCHOR_HREF,
  REGISTER_ANCHOR_ID,
} from "@/lib/site/world-vocabulary";

export type RegisterLoginGuideAuth = {
  privyReady: boolean;
  authenticated: boolean;
  profileResolved: boolean;
  registered: boolean;
};

/** Settled Privy session that still needs a name in THE REGISTER. */
export function isAwaitingNameClaim(input: RegisterLoginGuideAuth): boolean {
  return (
    input.privyReady &&
    input.authenticated &&
    input.profileResolved &&
    !input.registered
  );
}

/**
 * Guide after a new authenticated session while unnamed.
 *
 * `prevAuthenticated`:
 * - `null` — first observation after Privy ready (session restore counts)
 * - `false` — explicit login edge
 * - `true` — already authenticated this shell life; do not re-nudge
 */
export function shouldGuideToRegisterAfterAuthChange(input: {
  prevAuthenticated: boolean | null;
  current: RegisterLoginGuideAuth;
}): boolean {
  if (!isAwaitingNameClaim(input.current)) return false;
  return input.prevAuthenticated !== true;
}

export const REGISTER_LOGIN_GUIDE_HREF = REGISTER_ANCHOR_HREF;
export const REGISTER_LOGIN_GUIDE_ID = REGISTER_ANCHOR_ID;

export function isHomePath(pathname: string): boolean {
  return pathname === "/" || pathname === "";
}
