import { ClearingMessageItem } from "@/components/clearing/clearing-message-item";
import type { SafeClearingMessage } from "@/lib/clearing/dto";
import { isClearingMessageItem } from "@/lib/clearing/feed-client";

type Props = {
  item: unknown;
};

/**
 * Feed item boundary — only messages render in 1.0B.
 * Future kinds (market_watch, notice, …) fail closed here.
 */
export function ClearingFeedItem({ item }: Props) {
  if (!isClearingMessageItem(item)) return null;
  return <ClearingMessageItem message={item} />;
}
