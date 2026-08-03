"use client";

import { useEffect, useRef } from "react";

export type UsePagePulseOptions = {
  /** Interval between pulses while the tab is visible. */
  intervalMs: number;
  /** Called on each pulse. Should be stable or wrapped by the caller. */
  onPulse: () => void;
  /** When false, no timers/listeners. Default true. */
  enabled?: boolean;
  /** Refresh promptly when the tab becomes visible again. Default true. */
  refreshOnVisible?: boolean;
};

/**
 * Tiny page pulse: interval while visible, skip while hidden,
 * optional immediate pulse on visibility regain.
 * Cleans up on unmount. Safe under React Strict Mode.
 * Avoids stacking pulses while a previous pulse has only just started
 * (router.refresh is fire-and-forget).
 */
export function usePagePulse({
  intervalMs,
  onPulse,
  enabled = true,
  refreshOnVisible = true,
}: UsePagePulseOptions): void {
  const onPulseRef = useRef(onPulse);

  useEffect(() => {
    onPulseRef.current = onPulse;
  }, [onPulse]);

  useEffect(() => {
    if (!enabled) return;
    if (!Number.isFinite(intervalMs) || intervalMs < 1_000) return;

    let cancelled = false;
    let intervalId: number | null = null;
    let settleTimer: number | null = null;
    let pulsing = false;

    // Hold the guard briefly so interval + visibility do not double-fire.
    // Cap so a long Commons (60s) interval does not block genuine later pulses.
    const settleMs = Math.min(2_000, Math.max(250, Math.floor(intervalMs / 30)));

    const clear = () => {
      if (intervalId != null) {
        window.clearInterval(intervalId);
        intervalId = null;
      }
    };

    const clearSettle = () => {
      if (settleTimer != null) {
        window.clearTimeout(settleTimer);
        settleTimer = null;
      }
    };

    const pulse = () => {
      if (cancelled) return;
      if (typeof document !== "undefined" && document.hidden) return;
      if (pulsing) return;
      pulsing = true;
      try {
        onPulseRef.current();
      } finally {
        clearSettle();
        settleTimer = window.setTimeout(() => {
          pulsing = false;
          settleTimer = null;
        }, settleMs);
      }
    };

    const startInterval = () => {
      clear();
      if (cancelled || document.hidden) return;
      intervalId = window.setInterval(pulse, intervalMs);
    };

    const onVisibility = () => {
      if (cancelled) return;
      if (document.hidden) {
        clear();
        return;
      }
      if (refreshOnVisible) {
        pulse();
      }
      startInterval();
    };

    if (!document.hidden) {
      startInterval();
    }

    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      clear();
      clearSettle();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled, intervalMs, refreshOnVisible]);
}
