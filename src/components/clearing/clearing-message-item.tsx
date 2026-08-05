"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import type { SafeClearingMessage } from "@/lib/clearing/dto";
import {
  formatClearingAbsoluteTime,
  formatClearingRelativeTime,
} from "@/lib/clearing/relative-time";

type Props = {
  message: SafeClearingMessage;
};

/**
 * Single human message — spoken into a shared place, not a chat bubble.
 */
export function ClearingMessageItem({ message }: Props) {
  const [relative, setRelative] = useState<string | null>(null);

  useEffect(() => {
    const tick = () => {
      setRelative(formatClearingRelativeTime(message.occurredAt));
    };
    tick();
    const id = window.setInterval(tick, 60_000);
    return () => window.clearInterval(id);
  }, [message.occurredAt]);

  const absolute = formatClearingAbsoluteTime(message.occurredAt);
  const timeShown = relative ?? "…";

  return (
    <article className="clearing-message" data-author-type={message.author.type}>
      <header className="clearing-message__head">
        <h3 className="clearing-message__author">
          <span className="visually-hidden">Spoken by </span>
          {message.author.label}
        </h3>
        <time
          className="clearing-message__time muted"
          dateTime={message.occurredAt}
          title={absolute}
        >
          <span className="visually-hidden"> at </span>
          {timeShown}
        </time>
      </header>
      <p className="clearing-message__body">{message.body}</p>
    </article>
  );
}
