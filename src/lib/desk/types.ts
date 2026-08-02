/** Client-safe Keeper projection for The Desk shell. Never includes wallets. */
export type SafeDeskKeeper = {
  displayName: string;
  outlawNumberLabel: string;
  sigil: {
    asciiBody: string;
    a11yLabel: string;
  } | null;
};
