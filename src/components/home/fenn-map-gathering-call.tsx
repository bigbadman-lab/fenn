"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { usePagePulse } from "@/hooks/use-page-pulse";
import { formatRemainingDurationLabel } from "@/lib/greenwood/gatherings/duration";
import type { PublicHomeGatheringCall } from "@/lib/greenwood/gatherings/public-home-signal-types";
import { WORLD_PULSE_HOME_GATHERING_MS } from "@/lib/world-pulse/intervals";

type Props = {
  /** Desk preview — no fetch. */
  mode?: "live" | "preview";
  previewDurationMinutes?: number | null;
  className?: string;
};

type Body =
  | { ok: true; signal: PublicHomeGatheringCall }
  | { ok?: false; error?: string };

/**
 * Restrained map-adjacent World Call signal.
 * Isolates refresh from full homepage ISR.
 */
export function FennMapGatheringCall({
  mode = "live",
  previewDurationMinutes = null,
  className,
}: Props) {
  const [signal, setSignal] = useState<PublicHomeGatheringCall | null>(
    mode === "preview"
      ? {
          active: true,
          state: "active",
          startsAt: new Date().toISOString(),
          endsAt: new Date().toISOString(),
          message: "GATHERING CALLED AT THE GREENWOOD",
          href: "/greenwood?crossing=1",
          serverNow: new Date().toISOString(),
        }
      : null,
  );
  const [, setTick] = useState(0);

  const refresh = useCallback(async () => {
    if (mode === "preview") return;
    try {
      const response = await fetch("/api/home/gathering-call", {
        cache: "no-store",
      });
      const body = (await response.json()) as Body;
      if (!response.ok || !body.ok || !body.signal) {
        setSignal({ active: false, serverNow: new Date().toISOString() });
        return;
      }
      setSignal(body.signal);
    } catch {
      // Presentation-only: do not break the map if the signal fails.
      setSignal((prev) =>
        prev?.active
          ? prev
          : { active: false, serverNow: new Date().toISOString() },
      );
    }
  }, [mode]);

  usePagePulse({
    intervalMs: WORLD_PULSE_HOME_GATHERING_MS,
    onPulse: () => {
      void refresh();
    },
    enabled: mode === "live",
    refreshOnVisible: true,
  });

  useEffect(() => {
    if (mode !== "live") return;
    const timer = window.setTimeout(() => {
      void refresh();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [mode, refresh]);

  useEffect(() => {
    if (mode === "preview") return;
    if (!signal?.active) return;
    const id = window.setInterval(() => {
      setTick((n) => n + 1);
      const endsMs = Date.parse(signal.endsAt);
      if (Number.isFinite(endsMs) && endsMs <= Date.now()) {
        setSignal({
          active: false,
          serverNow: new Date().toISOString(),
        });
        void refresh();
      }
    }, 15_000);
    return () => window.clearInterval(id);
  }, [mode, signal, refresh]);

  if (mode === "preview") {
    return (
      <div
        className={
          className
            ? `fenn-map-world-call fenn-map-world-call--preview ${className}`
            : "fenn-map-world-call fenn-map-world-call--preview"
        }
        aria-label="Homepage map preview"
        data-mode="preview"
      >
        <p className="fenn-map-world-call__eyebrow muted">HOMEPAGE MAP</p>
        <p className="fenn-map-world-call__ember" aria-hidden>
          *
        </p>
        <p className="fenn-map-world-call__message">
          GATHERING CALLED AT THE GREENWOOD
        </p>
        <p className="fenn-map-world-call__remain muted">
          Begins when you press Begin Gathering
          {previewDurationMinutes != null && previewDurationMinutes > 0
            ? ` · Lasts for ${previewDurationMinutes} minutes`
            : ""}
        </p>
        <p className="muted fenn-map-world-call__note">
          Public visitors see this generic call. Full title and message stay
          inside the Greenwood.
        </p>
      </div>
    );
  }

  if (!signal?.active) return null;

  const nowMs = Date.now();
  const remainMs = Math.max(0, Date.parse(signal.endsAt) - nowMs);
  if (remainMs <= 0) return null;

  const remainLabel = formatRemainingDurationLabel(remainMs).toUpperCase();

  return (
    <div
      className={
        className
          ? `fenn-map-world-call ${className}`
          : "fenn-map-world-call"
      }
      aria-label="Gathering called at the Greenwood"
      data-mode="live"
    >
      <p className="fenn-map-world-call__ember" aria-hidden>
        *
      </p>
      <p className="fenn-map-world-call__message">{signal.message}</p>
      <p className="fenn-map-world-call__remain">
        {remainLabel} REMAIN
      </p>
      <Link href={signal.href} className="fenn-map-world-call__link">
        [ enter the greenwood ]
      </Link>
    </div>
  );
}
