/** Client-safe Desk Fire DTOs — no wallets, no Privy IDs. */

export type DeskFireMemberState = "present" | "sitting";

export type DeskFireMember = {
  profileId: string;
  displayName: string;
  outlawNumberLabel: string;
  sigil: {
    asciiBody: string;
    a11yLabel: string;
  } | null;
  state: DeskFireMemberState;
  handRaised: boolean;
  /** ISO last_seen_at for operational freshness. */
  lastSeenAt: string;
  /** ISO sitting_since when seated; null when present only. */
  sittingSince: string | null;
  /** Short human waiting label when seated. */
  waitingLabel: string | null;
};

export type DeskFireActiveGathering = {
  id: string;
  title: string;
  handCount: number;
  endsAt: string;
};

export type DeskFireSnapshot = {
  generatedAt: string;
  activeCount: number;
  sittingCount: number;
  warmCount: number;
  members: DeskFireMember[];
  activeGathering: DeskFireActiveGathering | null;
};
