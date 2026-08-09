/**
 * Whether the personal Camp LEAF status/counter should mount.
 *
 * Requires a resolved FENN Outlaw identity — not Privy session alone.
 * Guests, auth-unresolved visitors, and unregistered sessions must not see
 * LEAF: chrome (including placeholder 0 / checking).
 * Registered Outlaws with 0 LEAF still get their real balance.
 */
export type CampLeafReadoutVisibilityInput = {
  privyReady: boolean;
  authenticated: boolean;
  profileResolved: boolean;
  registered: boolean;
  hasProfile: boolean;
};

export function shouldShowCampLeafReadout(
  input: CampLeafReadoutVisibilityInput,
): boolean {
  return Boolean(
    input.privyReady &&
      input.authenticated &&
      input.profileResolved &&
      input.registered &&
      input.hasProfile,
  );
}
