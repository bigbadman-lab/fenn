import { ClearingMessageItem } from "@/components/clearing/clearing-message-item";
import { MarketWatchFeedItem } from "@/components/clearing/market-watch-feed-item";
import {
  isClearingMessageItem,
  isMarketWatchFeedItem,
} from "@/lib/clearing/feed-client";

type Props = {
  item: unknown;
};

/**
 * Feed item boundary — renders known kinds; unknown kinds fail closed.
 * Future: notice, world_event, greenwood, treasury, agent.
 */
export function ClearingFeedItem({ item }: Props) {
  if (isClearingMessageItem(item)) {
    return <ClearingMessageItem message={item} />;
  }
  if (isMarketWatchFeedItem(item)) {
    return <MarketWatchFeedItem event={item} />;
  }
  return null;
}
