"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { usePagePulse } from "@/hooks/use-page-pulse";
import { formatTickerClock } from "@/lib/live-ticker/format";
import type { LiveTickerItem } from "@/lib/live-ticker/types";
import { WORLD_PULSE_LIVE_TICKER_MS } from "@/lib/world-pulse/intervals";

type Body =
  | { ok: true; items: LiveTickerItem[] }
  | { ok?: false; error?: string };

const NEW_SIGNAL_MS = 4_500;
const MOBILE_CYCLE_MS = 5_000;

function ItemBody({
  item,
  hideClock = false,
}: {
  item: LiveTickerItem;
  hideClock?: boolean;
}) {
  const clock = formatTickerClock(item.occurredAt);
  const inner = (
    <>
      {hideClock ? null : (
        <>
          <span className="home-live-ticker__time">[{clock}]</span>{" "}
        </>
      )}
      <span className="home-live-ticker__item-text">{item.text}</span>
    </>
  );
  if (item.href) {
    return (
      <Link href={item.href} className="home-live-ticker__link">
        {inner}
        <span className="home-live-ticker__arrow" aria-hidden>
          {" "}
          →
        </span>
      </Link>
    );
  }
  return <span className="home-live-ticker__item-plain">{inner}</span>;
}

/**
 * Homepage machine-signal strip.
 * Polls public /api/home/live-ticker; isolated from homepage ISR.
 */
export function HomeLiveTicker() {
  const [items, setItems] = useState<LiveTickerItem[] | null>(null);
  const [liveLabel, setLiveLabel] = useState<"LIVE" | "NEW SIGNAL" | "LISTENING">(
    "LISTENING",
  );
  const [mobileIndex, setMobileIndex] = useState(0);
  const initialIdsRef = useRef<string | null>(null);
  const lastTopIdRef = useRef<string | null>(null);
  const newSignalTimer = useRef<number | null>(null);
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const response = await fetch("/api/home/live-ticker", {
        cache: "no-store",
      });
      const body = (await response.json()) as Body;
      if (!response.ok || !body || body.ok !== true || !Array.isArray(body.items)) {
        setItems((prev) => prev ?? []);
        return;
      }
      const next = body.items;
      setItems(next);

      if (next.length === 0) {
        setLiveLabel("LISTENING");
        lastTopIdRef.current = null;
        return;
      }

      const topId = next[0]!.id;
      if (initialIdsRef.current === null) {
        // First successful load — baseline, never NEW SIGNAL
        initialIdsRef.current = topId;
        lastTopIdRef.current = topId;
        setLiveLabel("LIVE");
        return;
      }

      if (lastTopIdRef.current && topId !== lastTopIdRef.current) {
        setLiveLabel("NEW SIGNAL");
        if (newSignalTimer.current != null) {
          window.clearTimeout(newSignalTimer.current);
        }
        newSignalTimer.current = window.setTimeout(() => {
          setLiveLabel("LIVE");
          newSignalTimer.current = null;
        }, NEW_SIGNAL_MS);
      } else {
        setLiveLabel((prev) => (prev === "NEW SIGNAL" ? prev : "LIVE"));
      }
      lastTopIdRef.current = topId;
    } catch {
      setItems((prev) => prev ?? []);
    } finally {
      inFlight.current = false;
    }
  }, []);

  usePagePulse({
    intervalMs: WORLD_PULSE_LIVE_TICKER_MS,
    onPulse: () => {
      void refresh();
    },
    enabled: true,
    refreshOnVisible: true,
  });

  useEffect(() => {
    const t = window.setTimeout(() => {
      void refresh();
    }, 0);
    return () => {
      window.clearTimeout(t);
      if (newSignalTimer.current != null) {
        window.clearTimeout(newSignalTimer.current);
      }
    };
  }, [refresh]);

  // Mobile single-item rotate
  useEffect(() => {
    if (!items || items.length <= 1) {
      setMobileIndex(0);
      return;
    }
    const id = window.setInterval(() => {
      setMobileIndex((i) => (i + 1) % items.length);
    }, MOBILE_CYCLE_MS);
    return () => window.clearInterval(id);
  }, [items]);

  const list = items ?? [];
  const quiet = list.length === 0;
  const status =
    quiet && items !== null
      ? "LISTENING"
      : liveLabel === "NEW SIGNAL"
        ? "NEW SIGNAL"
        : items === null
          ? "LIVE"
          : liveLabel === "LISTENING"
            ? "LISTENING"
            : "LIVE";

  const mobileItem =
    list.length > 0 ? list[mobileIndex % list.length]! : null;

  // Duplicated track for continuous scroll impression
  const trackItems = list.length > 0 ? [...list, ...list] : [];

  return (
    <div
      className="home-live-ticker"
      role="status"
      aria-live="polite"
      aria-label="Live in the wood"
    >
      <div className="home-live-ticker__bar">
        <span
          className={
            status === "NEW SIGNAL"
              ? "home-live-ticker__status home-live-ticker__status--new"
              : "home-live-ticker__status"
          }
        >
          <span className="home-live-ticker__dot" aria-hidden>
            ●
          </span>{" "}
          {status === "LISTENING"
            ? "LISTENING"
            : status === "NEW SIGNAL"
              ? "NEW SIGNAL"
              : "LIVE"}
        </span>

        {quiet ? null : (
          <>
            <div className="home-live-ticker__desktop" aria-hidden={false}>
              <div className="home-live-ticker__viewport">
                <div className="home-live-ticker__track">
                  {trackItems.map((item, i) => (
                    <span
                      key={`${item.id}-${i}`}
                      className="home-live-ticker__seg"
                    >
                      <ItemBody item={item} />
                      <span className="home-live-ticker__sep" aria-hidden>
                        {" "}
                        ···{" "}
                      </span>
                    </span>
                  ))}
                </div>
              </div>
            </div>

            <div className="home-live-ticker__mobile">
              {mobileItem ? (
                <div className="home-live-ticker__mobile-item" key={mobileItem.id}>
                  <div className="home-live-ticker__mobile-meta">
                    <span className="home-live-ticker__mobile-label">
                      {mobileItem.label}
                    </span>
                    <span className="home-live-ticker__time">
                      {formatTickerClock(mobileItem.occurredAt)}
                    </span>
                  </div>
                  <div className="home-live-ticker__mobile-text">
                    <ItemBody item={mobileItem} hideClock />
                  </div>
                </div>
              ) : null}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
