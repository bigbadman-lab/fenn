import type { SafeGreenwoodSigil } from "@/lib/greenwood/sigil/types";

/** Member-safe Fire presence entry — no wallets or profile IDs. */
export type FirePresenceMember = {
  /** Stable public label for list keys (Outlaw number form). */
  outlawLabel: string;
  /** Display name: alias when set, otherwise outlawLabel. */
  displayName: string;
  sigil: SafeGreenwoodSigil | null;
  sitting: boolean;
  /** True when this entry is the authenticated viewer. */
  isSelf: boolean;
};

export type FirePresenceSelfState = {
  present: boolean;
  sitting: boolean;
};

export type FirePresenceSnapshot = {
  self: FirePresenceSelfState;
  activeCount: number;
  members: FirePresenceMember[];
};

export type GreenwoodPresenceRpcRow = {
  profile_id: string;
  last_seen_at: string;
  sitting: boolean;
  sitting_since: string | null;
};
