/**
 * Whether the personal Camp LEAF status/counter should mount.
 *
 * Uses Privy session readiness only — not leaf balance. Authenticated
 * Outlaws with 0 LEAF still see their status; guests never do.
 *
 * Default hidden until Privy is ready AND the visitor is authenticated,
 * so SSR / first paint never flash personal LEAF chrome for guests.
 */
export type CampLeafReadoutVisibilityInput = {
  privyReady: boolean;
  authenticated: boolean;
};

export function shouldShowCampLeafReadout(
  input: CampLeafReadoutVisibilityInput,
): boolean {
  return Boolean(input.privyReady && input.authenticated);
}
