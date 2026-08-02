/** Client-safe Desk overview DTOs (no wallets, no secrets). */

export type DeskAttentionCategory =
  | "needs_attention"
  | "happening_now"
  | "soon"
  | "quiet";

export type DeskSignalAvailability = "ok" | "unavailable";

export type DeskAttentionSignal = {
  id: string;
  category: DeskAttentionCategory;
  /** Plain operational line for the Keeper. */
  message: string;
  count: number | null;
  href: string | null;
  availability: DeskSignalAvailability;
};

export type DeskOverviewSnapshot = {
  generatedAt: string;
  signals: DeskAttentionSignal[];
  /** True when every attempted source finished without subsystem failure. */
  allSourcesOk: boolean;
};
