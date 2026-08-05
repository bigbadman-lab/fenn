"use client";

import {
  CLEARING_WOOD_NOTICES_HEADING,
  CLEARING_WOOD_NOTICES_LEAD,
} from "@/lib/clearing/market-display";
import type { SafeMarketWatchFeedItem } from "@/lib/clearing/dto";
import {
  formatClearingAbsoluteTime,
  formatClearingRelativeTime,
} from "@/lib/clearing/relative-time";
import { useEffect, useState } from "react";

type Props = {
  event: SafeMarketWatchFeedItem;
};

/**
 * System world event in The Clearing — observational, not a chat bubble.
 * Heading is shared for future system kinds.
 */
export function MarketWatchFeedItem({ event }: Props) {
  const [relative, setRelative] = useState<string | null>(null);

  useEffect(() => {
    const tick = () => {
      setRelative(formatClearingRelativeTime(event.occurredAt));
    };
    tick();
    const id = window.setInterval(tick, 60_000);
    return () => window.clearInterval(id);
  }, [event.occurredAt]);

  const absolute = formatClearingAbsoluteTime(event.occurredAt);
  const timeShown = relative ?? "…";

  return (
    <section
      className="clearing-wood"
      aria-labelledby={`wood-notices-${event.id}`}
      data-feed-kind="market_watch"
    >
      <div className="clearing-wood__rule" aria-hidden="true" />
      <header className="clearing-wood__head">
        <h3 className="clearing-wood__title" id={`wood-notices-${event.id}`}>
          {CLEARING_WOOD_NOTICES_HEADING}
        </h3>
        <time
          className="clearing-wood__time muted"
          dateTime={event.occurredAt}
          title={absolute}
        >
          <span className="visually-hidden">Noticed </span>
          {timeShown}
        </time>
      </header>
      <p className="clearing-wood__lead">{CLEARING_WOOD_NOTICES_LEAD}</p>
      <p className="clearing-wood__amount">
        with {event.amountLabel}
        <span className="visually-hidden">.</span>
      </p>
      {event.transactionUrl ? (
        <p className="clearing-wood__action">
          <a
            className="btn-text clearing-wood__tx"
            href={event.transactionUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`View transaction for ${event.amountLabel}`}
          >
            [ VIEW TRANSACTION ]
          </a>
        </p>
      ) : null}
      <div className="clearing-wood__rule" aria-hidden="true" />
    </section>
  );
}
