/** Homepage live ticker — public derived heartbeat items only. */

export const LIVE_TICKER_MAX_ITEMS = 10;
export const LIVE_TICKER_WALL_BODY_MAX_CHARS = 48;
export const LIVE_TICKER_TEXT_MAX_CHARS = 96;

export type LiveTickerType =
  | "deed"
  | "book"
  | "wall"
  | "leaf"
  | "gathering";

export type LiveTickerItem = {
  id: string;
  type: LiveTickerType;
  occurredAt: string;
  label: string;
  text: string;
  href?: string;
};

export type LiveTickerResponse = {
  ok: true;
  items: LiveTickerItem[];
};
