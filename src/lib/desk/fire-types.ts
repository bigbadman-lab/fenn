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
  members: DeskFireMember[];
  activeGathering: DeskFireActiveGathering | null;
};
